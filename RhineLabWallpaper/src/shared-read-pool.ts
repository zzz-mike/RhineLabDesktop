type Job<T> = {
  key: string;
  controller: AbortController;
  subscribers: Set<{
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
    cleanup: () => void;
  }>;
};
/** In-flight sharing only: no cached results. Cancellation belongs to each subscriber. */
export class SharedReadPool<T> {
  private jobs = new Map<string, Job<T>>();
  private queue: Job<T>[] = [];
  private running = 0;
  constructor(
    private read: (key: string, signal: AbortSignal) => Promise<T>,
    private concurrency = 4,
  ) {}
  invalidate() {
    this.jobs.clear();
  }
  get(key: string, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted)
      return Promise.reject(new DOMException("已取消", "AbortError"));
    let job = this.jobs.get(key);
    if (!job) {
      job = {
        key,
        controller: new AbortController(),
        subscribers: new Set(),
      };
      this.jobs.set(key, job);
      this.queue.push(job);
    }
    const current = job;
    const promise = new Promise<T>((resolve, reject) => {
      const subscriber = {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", abort),
      };
      const abort = () => {
        current.subscribers.delete(subscriber);
        subscriber.cleanup();
        reject(new DOMException("已取消", "AbortError"));
        if (!current.subscribers.size) {
          current.controller.abort();
          if (this.jobs.get(key) === current) this.jobs.delete(key);
          this.drain();
        }
      };
      current.subscribers.add(subscriber);
      signal?.addEventListener("abort", abort, { once: true });
    });
    this.drain();
    return promise;
  }
  private drain() {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      if (!job.subscribers.size) continue;
      this.running++;
      const settle = (failed: boolean, value: unknown) => {
        const subscribers = [...job.subscribers];
        job.subscribers.clear();
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        this.running--;
        for (const subscriber of subscribers) {
          subscriber.cleanup();
          if (failed) subscriber.reject(value);
          else subscriber.resolve(value as T);
        }
        this.drain();
      };
      Promise.resolve()
        .then(() => this.read(job.key, job.controller.signal))
        .then(
          (value) => settle(false, value),
          (error) => settle(true, error),
        );
    }
  }
}
