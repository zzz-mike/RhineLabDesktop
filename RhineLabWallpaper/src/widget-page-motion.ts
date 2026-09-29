/** Short compositor-only motion for one card. No animation loop when idle. */
export class WidgetPageMotion {
  private sequence = 0;
  private phase: "idle" | "drag" | "pending" | "settling" = "idle";
  private shift = 0;
  private direction = 1;
  private ghost?: HTMLElement;
  private animations: Animation[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private hint: HTMLElement;
  constructor(
    private viewport: HTMLElement,
    private body: HTMLElement,
  ) {
    this.hint = document.createElement("span");
    this.hint.className = "iw-page-hint";
    this.hint.setAttribute("role", "status");
    this.hint.hidden = true;
    viewport.append(this.hint);
  }
  private get reduced() {
    return (
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !!this.body.closest(".reduce-motion")
    );
  }
  private clear() {
    clearTimeout(this.timer);
    this.animations.forEach((a) => a.cancel());
    this.animations = [];
    this.ghost?.remove();
    this.ghost = undefined;
    this.hint.hidden = true;
    this.body.style.transform = "";
    this.viewport.removeAttribute("data-page-motion");
  }
  cancel() {
    ++this.sequence;
    this.clear();
    this.phase = "idle";
    this.shift = 0;
  }
  preview(distance: number, canTurn: boolean) {
    if (this.phase === "pending" || this.phase === "settling" || this.reduced)
      return;
    if (this.phase !== "drag") this.clear();
    this.phase = "drag";
    this.shift =
      -Math.sign(distance) *
      Math.min(canTurn ? 32 : 12, Math.abs(distance) * (canTurn ? 0.55 : 0.18));
    this.viewport.dataset.pageMotion = "drag";
    this.body.style.transform = `translate3d(${this.shift}px,0,0)`;
  }
  release() {
    if (this.phase === "drag") this.rebound();
  }
  boundary(direction: number) {
    this.rebound(
      direction < 0 ? "已是第一页" : "已是最后一页",
      -direction * 12,
    );
  }
  private rebound(message?: string, fallback = 0) {
    const shift = this.shift || fallback;
    const sequence = ++this.sequence;
    this.clear();
    this.shift = 0;
    this.phase = "settling";
    if (message) {
      this.hint.textContent = message;
      this.hint.hidden = false;
      this.timer = setTimeout(() => {
        this.hint.hidden = true;
      }, 950);
    }
    if (!this.reduced && shift && this.body.animate) {
      const motion = this.body.animate(
        [
          { transform: `translate3d(${shift}px,0,0)` },
          { transform: "translate3d(0,0,0)" },
        ],
        { duration: 220, easing: "cubic-bezier(.2,.75,.25,1)" },
      );
      this.animations.push(motion);
      void motion.finished
        .catch(() => {})
        .then(() => {
          if (sequence === this.sequence) {
            this.phase = "idle";
            this.animations = [];
          }
        });
    } else this.phase = "idle";
  }
  begin(direction: number): number {
    const shift = this.shift;
    this.cancel();
    const sequence = this.sequence;
    this.direction = direction;
    this.phase = "pending";
    this.viewport.dataset.pageMotion = "pending";
    if (!this.reduced) {
      this.shift = shift || -direction * 16;
      this.ghost = this.body.cloneNode(true) as HTMLElement;
      this.ghost.classList.add("iw-page-ghost");
      this.ghost.setAttribute("aria-hidden", "true");
      this.ghost.inert = true;
      this.ghost.removeAttribute("id");
      this.ghost
        .querySelectorAll("[id]")
        .forEach((e) => e.removeAttribute("id"));
      this.body.style.transform = `translate3d(${this.shift}px,0,0)`;
    }
    // Fast local replies do not flash a loading label; the drag itself responds immediately.
    this.timer = setTimeout(() => {
      if (this.sequence !== sequence || this.phase !== "pending") return;
      this.hint.textContent =
        direction > 0 ? "正在读取下一页…" : "正在读取上一页…";
      this.hint.hidden = false;
    }, 140);
    return sequence;
  }
  complete(sequence: number, success: boolean, failed = false) {
    if (sequence !== this.sequence || this.phase !== "pending") return;
    if (!success) {
      this.rebound(failed ? "读取失败，保留当前页" : undefined);
      return;
    }
    clearTimeout(this.timer);
    this.hint.hidden = true;
    if (this.reduced || !this.body.animate || !this.ghost) {
      this.cancel();
      return;
    }
    const ghost = this.ghost;
    this.phase = "settling";
    this.viewport.dataset.pageMotion = "settling";
    this.viewport.append(ghost);
    const width = this.viewport.clientWidth;
    this.body.style.transform = "";
    const options = { duration: 270, easing: "cubic-bezier(.2,.72,.2,1)" };
    const outgoing = ghost.animate(
      [
        { transform: `translate3d(${this.shift}px,0,0)`, opacity: 1 },
        {
          transform: `translate3d(${-this.direction * width}px,0,0)`,
          opacity: 0.45,
        },
      ],
      options,
    );
    const incoming = this.body.animate(
      [
        {
          transform: `translate3d(${this.direction * width}px,0,0)`,
          opacity: 0.65,
        },
        { transform: "translate3d(0,0,0)", opacity: 1 },
      ],
      options,
    );
    this.shift = 0;
    this.animations = [outgoing, incoming];
    void Promise.all(
      this.animations.map((a) => a.finished.catch(() => {})),
    ).then(() => {
      if (sequence === this.sequence) this.cancel();
    });
  }
}
