/** Memory-only adjacent pages. Two speculative reads globally leave foreground
 * capacity available in SharedReadPool; never start a background refresh loop. */
class PrefetchQueue {
  private running = 0;
  private queue: (() => void)[] = [];
  run<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const cancelled = () => {
        const index = this.queue.indexOf(start);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new DOMException("已取消", "AbortError"));
      };
      const start = () => {
        if (signal.aborted) { cancelled(); return; }
        this.running++;
        Promise.resolve().then(read).then(resolve, reject).finally(() => {
          signal.removeEventListener("abort", cancelled);
          this.running--;
          this.drain();
        });
      };
      if (signal.aborted) { cancelled(); return; }
      signal.addEventListener("abort", cancelled, { once: true });
      this.queue.push(start);
      this.drain();
    });
  }
  private drain() {
    while (this.running < 2 && this.queue.length) this.queue.shift()!();
  }
}
const speculativeReads = new PrefetchQueue();

export class AdjacentPageCache<T> {
  private scope = "";
  private generation = 0;
  private values = new Map<number, { value: T; at: number }>();
  private tasks = new Map<number, { abort: AbortController; task: Promise<T> }>();
  constructor(private now = Date.now, private ttl = 60000) {}
  configure(scope: string) {
    if (scope !== this.scope) { this.clear(); this.scope = scope; }
  }
  clear() {
    this.generation++;
    this.tasks.forEach(({ abort }) => abort.abort());
    this.tasks.clear();
    this.values.clear();
  }
  get size() { return this.values.size; }
  get(offset: number): T | undefined {
    const entry = this.values.get(offset);
    if (!entry) return;
    if (this.now() - entry.at < 0 || this.now() - entry.at >= this.ttl) {
      this.values.delete(offset); return;
    }
    return entry.value;
  }
  put(offset: number, value: T) {
    this.values.delete(offset);
    this.values.set(offset, { value, at: this.now() });
    while (this.values.size > 3) this.values.delete(this.values.keys().next().value!);
  }
  pending(offset: number) { return this.tasks.get(offset)?.task; }
  retain(offsets: number[]) {
    const keep = new Set(offsets);
    for (const offset of this.values.keys()) if (!keep.has(offset)) this.values.delete(offset);
    for (const [offset, pending] of this.tasks) if (!keep.has(offset)) {
      pending.abort.abort(); this.tasks.delete(offset);
    }
  }
  warm(offset: number, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const value = this.get(offset);
    if (value !== undefined) return Promise.resolve(value);
    const existing = this.pending(offset);
    if (existing) return existing;
    const generation = this.generation, abort = new AbortController();
    const task = speculativeReads.run(() => read(abort.signal), abort.signal).then(value => {
      if (generation === this.generation && !abort.signal.aborted) this.put(offset, value);
      return value;
    }).finally(() => {
      if (this.tasks.get(offset)?.task === task) this.tasks.delete(offset);
    });
    this.tasks.set(offset, { abort, task });
    return task;
  }
}

export function adjacentOffsets(offset: number, count: number, pageSize: number, total: number): number[] {
  const result: number[] = [];
  if (offset > 0) result.push(Math.max(0, offset - pageSize));
  if (count > 0 && offset + count < total) result.push(offset + count);
  return result;
}
