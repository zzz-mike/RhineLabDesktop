/** Capacity is based on the measured content area, never on a saved size label. */
export function capacity(
  width: number,
  height: number,
  limit: number,
  solar = false,
): {
  count: number;
  columns: number;
  density: "compact" | "comfortable" | "detailed";
} {
  const w = Number.isFinite(width) ? Math.max(0, width) : 0;
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  const max = Number.isFinite(limit)
    ? Math.max(1, Math.min(100, Math.floor(limit)))
    : 1;
  // Keep each text column readable; wider cards gain side-by-side entries.
  const columns = solar
    ? 1
    : Math.max(1, Math.min(3, max, Math.floor((w + 16) / 316)));
  const entryWidth = (w - (columns - 1) * 16) / columns;
  const density =
    entryWidth >= 520 && h >= 340
      ? "detailed"
      : entryWidth >= 340 && h >= 220
        ? "comfortable"
        : "compact";
  // Header/status/page controls have their own reserved space. Solar pages show one station.
  const row =
    entryWidth < 220
      ? 214
      : density === "detailed"
        ? 214
        : density === "comfortable"
          ? 188
          : 156;
  return {
    count: solar
      ? 1
      : Math.min(
          max,
          columns * Math.max(1, Math.floor((h - 16 + 12) / (row + 12))),
        ),
    columns,
    density,
  };
}

export interface SwipeResult {
  consume: boolean;
  step: -1 | 0 | 1;
}
/** Pure wheel recogniser: the caller isolates interactive targets and performs pagination.
 * Horizontal boundary gestures are still consumed; vertical wheel events remain native.
 */
export class SwipePager {
  private last = -Infinity;
  private x = 0;
  private y = 0;
  private lock: "x" | "y" | null = null;
  private fired = false;
  private committedAt = -Infinity;
  private committedDirection = 0;
  private previousDx = 0;
  private peak = 0;
  private decayed = false;
  private trough = Infinity;
  private rising = 0;
  get distance(): number {
    return this.lock === "x" ? this.x : 0;
  }
  get committed(): boolean {
    return this.fired;
  }
  reset(): void {
    this.last = -Infinity;
    this.x = this.y = 0;
    this.lock = null;
    this.fired = false;
    this.committedAt = -Infinity;
    this.committedDirection = 0;
    this.previousDx = this.peak = 0;
    this.decayed = false;
    this.trough = Infinity;
    this.rising = 0;
  }
  wheel(dx: number, dy: number, now: number, deltaMode = 0): SwipeResult {
    if (deltaMode !== 0 || ![dx, dy, now].every(Number.isFinite))
      return { consume: false, step: 0 };
    if (now - this.last > 180 || now < this.last) this.reset();
    // WheelEvent exposes no portable finger-up/momentum phase. A quiet gap
    // still ends a gesture, but a fresh impulse can interrupt a long inertia tail.
    const magnitude = Math.abs(dx),
      previous = Math.abs(this.previousDx);
    this.rising = magnitude > previous + 0.5 ? this.rising + 1 : 0;
    if (this.fired && now - this.committedAt >= 120) {
      const horizontal = magnitude > Math.abs(dy) * 1.25;
      const reversed =
        horizontal && magnitude >= 8 && dx * this.committedDirection < 0;
      const freshImpulse =
        horizontal &&
        this.decayed &&
        magnitude >= 10 &&
        ((magnitude >= previous * 1.8 && magnitude - previous >= 6) ||
          (this.rising >= 2 &&
            magnitude >= this.trough * 2.5 &&
            magnitude - this.trough >= 6));
      const vertical = Math.abs(dy) >= 12 && Math.abs(dy) > magnitude * 1.5;
      if (reversed || freshImpulse || vertical) this.reset();
    }
    this.last = now;
    this.peak = Math.max(this.peak, magnitude);
    if (this.fired) {
      this.trough = Math.min(this.trough, magnitude);
      if (magnitude < this.peak * 0.6) this.decayed = true;
    }
    this.previousDx = dx;
    this.x += dx;
    this.y += dy;
    if (!this.lock) {
      if (Math.abs(this.x) >= 10 && Math.abs(this.x) > Math.abs(this.y) * 1.25)
        this.lock = "x";
      else if (
        Math.abs(this.y) >= 10 &&
        Math.abs(this.y) > Math.abs(this.x) * 1.25
      )
        this.lock = "y";
    }
    const consume =
      this.lock === "x" || (!this.lock && Math.abs(dx) > Math.abs(dy) * 1.25);
    if (this.lock !== "x" || this.fired || Math.abs(this.x) < 48)
      return { consume, step: 0 };
    this.fired = true;
    this.committedAt = now;
    this.committedDirection = Math.sign(this.x);
    return { consume: true, step: this.x > 0 ? 1 : -1 };
  }
}
