import {
  resizeCornerGrid,
  packGrid,
  gridBoundaries,
  gridJunctions,
  resizeGrid,
  moveFixedGrid,
  type GridItem,
  type GridBoundary,
  type GridRect,
} from "./widget-grid";
import "./widget-grid-editor.css";

type Options = {
  items: () => GridItem[];
  apply: (items: GridItem[], save: boolean) => void;
  announce: (message: string) => void;
};
type Candidate = { items: GridItem[]; dx: number; dy: number };
type Gesture = {
  pointer: number;
  kind: "move" | "resize" | "corner";
  corner?: "nw" | "se";
  valid?: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  original: GridItem[];
  current: GridItem[];
  rects: GridRect[];
  columns: number;
  stepX: number;
  stepY: number;
  id?: string;
  index?: number;
  seams: GridBoundary[];
  candidates: Candidate[];
  ghost?: HTMLElement;
  portal?: HTMLElement;
  offsetX: number;
  offsetY: number;
  active: boolean;
  lastKey: string;
  scroller: HTMLElement;
  scroll: number;
};
const clone = (items: GridItem[]) => items.map((i) => ({ ...i }));
const button = (label: string, text: string) => {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = label;
  b.textContent = text;
  return b;
};
/** Only editing UI. Data reads/reviews remain owned by InformationWidgets. */
export class WidgetGridEditor {
  private enabled = false;
  private gesture?: Gesture;
  private overlay = document.createElement("div");
  private marker = document.createElement("div");
  private hint = document.createElement("div");
  private observer: ResizeObserver;
  private abort = new AbortController();
  private frame = 0;
  private observed = new Set<Element>();
  private applying = false;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  constructor(
    private grid: HTMLElement,
    private options: Options,
  ) {
    this.overlay.className = "iw-grid-handles";
    this.overlay.setAttribute("aria-label", "相邻组件尺寸调节");
    this.marker.className = "iw-drop-marker";
    this.marker.setAttribute("aria-hidden", "true");
    this.marker.textContent = "放在这里";
    this.marker.hidden = true;
    this.hint.className = "iw-layout-hint";
    this.hint.setAttribute("role", "status");
    this.hint.hidden = true;
    grid.append(this.overlay, this.marker, this.hint);
    const opts = { signal: this.abort.signal };
    grid.addEventListener("pointerdown", (e) => this.down(e), opts);
    grid.addEventListener(
      "pointermove",
      (e) => {
        if (this.gesture?.pointer === e.pointerId) {
          this.gesture.x = e.clientX;
          this.gesture.y = e.clientY;
          this.requestFrame();
        }
      },
      opts,
    );
    grid.addEventListener(
      "pointerup",
      (e) => {
        if (this.gesture?.pointer === e.pointerId) {
          this.gesture.x = e.clientX;
          this.gesture.y = e.clientY;
          this.update();
          this.finish(false);
        }
      },
      opts,
    );
    grid.addEventListener(
      "pointercancel",
      (e) => {
        if (this.gesture?.pointer === e.pointerId) this.finish(true);
      },
      opts,
    );
    grid.addEventListener(
      "lostpointercapture",
      (e) => {
        if (this.gesture?.pointer === e.pointerId) this.finish(true);
      },
      opts,
    );
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && this.gesture) {
          e.preventDefault();
          e.stopPropagation();
          this.finish(true);
        }
      },
      opts,
    );
    window.addEventListener("blur", () => this.cancel(), opts);
    window.addEventListener(
      "resize",
      () => {
        this.cancel();
        this.refresh();
      },
      opts,
    );
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) this.cancel();
      },
      opts,
    );
    this.observer = new ResizeObserver(() => {
      if (this.enabled && !this.gesture) this.scheduleRefresh();
    });
    this.observer.observe(grid);
  }
  private scheduleRefresh() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.refresh();
    });
  }
  setEnabled(value: boolean) {
    if (!value) this.cancel();
    this.enabled = value;
    this.grid.dataset.directEditing = String(value);
    this.refresh();
  }
  cancel() {
    if (this.gesture) this.finish(true);
  }
  destroy() {
    this.cancel();
    this.abort.abort();
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    this.overlay.remove();
    this.marker.remove();
    this.hint.remove();
  }
  private cards() {
    return [...this.grid.querySelectorAll<HTMLElement>(":scope > .iw-card")];
  }
  private dimensions() {
    const css = getComputedStyle(this.grid);
    return {
      columns: css.gridTemplateColumns.split(" ").length,
      gap: parseFloat(css.columnGap) || 18,
      row: parseFloat(css.gridAutoRows) || 100,
    };
  }
  refresh() {
    const items = this.options.items();
    const cards = this.cards();
    for (const card of this.observed)
      if (!cards.includes(card as HTMLElement)) {
        this.observer.unobserve(card);
        this.observed.delete(card);
      }
    for (const card of cards) {
      if (!this.observed.has(card)) {
        this.observed.add(card);
        this.observer.observe(card);
        this.decorate(card);
      }
      const item = items.find((i) => i.id === card.dataset.instanceId);
      if (!item) continue;
      const label = card.querySelector<HTMLElement>(".iw-size-label");
      if (label) label.textContent = `${item.columns} × ${item.rows}`;
    }
    this.overlay.hidden = !this.enabled;
    if (
      !this.enabled ||
      this.gesture ||
      this.applying ||
      !this.grid.getBoundingClientRect().width
    )
      return;
    const { columns, gap, row } = this.dimensions(),
      width = this.grid.getBoundingClientRect().width,
      stepX = (width + gap) / columns,
      stepY = row + gap;
    const rects = packGrid(items, columns),
      seams = gridBoundaries(rects);
    this.overlay.replaceChildren();
    const position = (at: number, step: number) => at * step - gap / 2;
    for (const seam of seams) {
      const label =
        seam.axis === "x" ? "同时调整相邻组件宽度" : "同时调整相邻组件高度";
      const h = button(label, "");
      h.className = `iw-shared-handle iw-shared-${seam.axis}`;
      h.dataset.seam = JSON.stringify([seam]);
      if (seam.axis === "x") {
        h.style.left = `${position(seam.at, stepX) - 7}px`;
        h.style.top = `${seam.from * stepY + 14}px`;
        h.style.width = "14px";
        h.style.height = `${(seam.to - seam.from) * stepY - gap - 28}px`;
      } else {
        h.style.top = `${position(seam.at, stepY) - 7}px`;
        h.style.left = `${seam.from * stepX + 14}px`;
        h.style.height = "14px";
        h.style.width = `${(seam.to - seam.from) * stepX - gap - 28}px`;
      }
      this.bindBoundary(h, [seam], items, columns);
      this.overlay.append(h);
    }
    for (const j of gridJunctions(seams)) {
      const count = new Set([
        ...j.vertical.before,
        ...j.vertical.after,
        ...j.horizontal.before,
        ...j.horizontal.after,
      ]).size;
      const h = button(`同时调整交点旁的 ${count} 个组件`, "✥");
      h.className = "iw-shared-handle iw-shared-cross";
      h.dataset.seam = JSON.stringify([j.vertical, j.horizontal]);
      h.style.left = `${position(j.x, stepX) - 13}px`;
      h.style.top = `${position(j.y, stepY) - 13}px`;
      this.bindBoundary(h, [j.vertical, j.horizontal], items, columns);
      this.overlay.append(h);
    }
  }
  private decorate(card: HTMLElement) {
    const title = card.querySelector("h2")?.textContent ?? "组件";
    const bar = document.createElement("div");
    bar.className = "iw-window-controls";
    const grip = button(`拖动${title}换位置`, "⠿");
    grip.dataset.widgetMove = card.dataset.instanceId;
    grip.className = "iw-move-grip";
    bar.append(grip);
    const label = document.createElement("span");
    label.className = "iw-size-label";
    bar.append(label);
    for (const corner of ["nw", "se"] as const) {
      const point = button(
        `${corner === "nw" ? "左上角" : "右下角"}拖动调整${title}大小`,
        "",
      );
      point.className = `iw-corner-grip iw-corner-${corner}`;
      point.dataset.widgetResize = card.dataset.instanceId;
      point.dataset.corner = corner;
      point.addEventListener(
        "keydown",
        (e) => {
          if (!this.enabled || this.gesture) return;
          const dx =
            e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
          const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
          if (!dx && !dy) return;
          e.preventDefault();
          e.stopPropagation();
          const items = resizeCornerGrid(
            this.options.items(),
            card.dataset.instanceId!,
            corner,
            dx,
            dy,
            this.dimensions().columns,
          );
          this.animateApply(items, true);
          const item = items.find((i) => i.id === card.dataset.instanceId)!;
          this.options.announce(
            `尺寸 ${item.columns} 列 × ${item.rows} 行，已保存`,
          );
        },
        { signal: this.abort.signal },
      );
      bar.append(point);
    }
    const remove = button(`删除${title}小组件`, "删除");
    remove.className = "iw-remove-widget";
    remove.title = "仅移除此小组件，保留原始数据";
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!this.enabled || this.gesture) return;
      const cards = this.cards();
      const index = cards.indexOf(card);
      const remaining = this.options.items().filter(i => i.id !== card.dataset.instanceId);
      this.animateApply(remaining, true);
      const next = this.cards()[Math.min(index, remaining.length - 1)];
      const focus = next?.querySelector<HTMLButtonElement>(".iw-move-grip") ??
        this.grid.parentElement?.querySelector<HTMLButtonElement>('button[aria-label="调整信息组件布局"]');
      focus?.focus();
      this.options.announce(`已删除${title}小组件，原始数据保留；可从添加信息组件重新添加`);
    }, {signal: this.abort.signal});
    bar.append(remove);
    // Keyboard move uses the same position/snap behavior as pointer dragging.
    grip.addEventListener(
      "keydown",
      (e) => {
        if (!this.enabled) return;
        if (this.gesture) return;
        const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
        const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        if (!dx && !dy) return;
        e.preventDefault(); e.stopPropagation();
        const items = this.options.items(), item = items.find(i=>i.id===card.dataset.instanceId)!;
        const next = moveFixedGrid(items, item.id, item.x!+dx, item.y!+dy);
        if (next) { this.animateApply(next,true); grip.focus(); this.options.announce("位置已保存，其他组件保持不动"); }
        else this.options.announce("该位置已有组件，请选择空位");
      },
      { signal: this.abort.signal },
    );
    card.prepend(bar);
  }
  private bindBoundary(
    handle: HTMLButtonElement,
    seams: GridBoundary[],
    items: GridItem[],
    columns: number,
  ) {
    const choices = this.candidates(items, columns, seams);
    const movable = choices.some((c) => c.dx || c.dy);
    handle.setAttribute("aria-disabled", String(!movable));
    if (!movable) handle.title = "已达到标准尺寸限制，可先调整相邻组件尺寸";
    handle.addEventListener("keydown", (e) => {
      const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0,
        dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      if (!dx && !dy) return;
      e.preventDefault();
      e.stopPropagation();
      const candidate = this.nearest(choices, dx, dy);
      if (candidate.dx || candidate.dy) {
        const index = [...this.overlay.querySelectorAll("button")].indexOf(
          handle,
        );
        this.animateApply(candidate.items, true);
        this.overlay
          .querySelectorAll<HTMLButtonElement>("button")
          [index]?.focus();
        this.options.announce("已按网格调整相邻尺寸");
      } else this.options.announce("已达到标准尺寸限制");
    });
  }
  private candidates(
    items: GridItem[],
    columns: number,
    seams: GridBoundary[],
  ) {
    const result: Candidate[] = [];
    const xs = seams.some((s) => s.axis === "x")
        ? Array.from({ length: 17 }, (_, i) => i - 8)
        : [0],
      ys = seams.some((s) => s.axis === "y")
        ? Array.from({ length: 17 }, (_, i) => i - 8)
        : [0];
    for (const dx of xs)
      for (const dy of ys) {
        const resized = resizeGrid(items, columns, seams, dx, dy);
        if (resized) result.push({ items: resized, dx, dy });
      }
    return result;
  }
  private nearest(choices: Candidate[], dx: number, dy: number) {
    return choices.reduce((best, c) =>
      (c.dx - dx) ** 2 + (c.dy - dy) ** 2 <
      (best.dx - dx) ** 2 + (best.dy - dy) ** 2
        ? c
        : best,
    );
  }
  private animateApply(items: GridItem[], save: boolean) {
    const before = new Map(
      this.cards().map((c) => [
        c.dataset.instanceId!,
        c.getBoundingClientRect(),
      ]),
    );
    this.applying = true;
    try {
      this.options.apply(items, save);
    } finally {
      this.applying = false;
    }
    for (const card of this.cards()) {
      const old = before.get(card.dataset.instanceId!);
      if (!old) continue;
      card.getAnimations().forEach((a) => a.cancel());
      const next = card.getBoundingClientRect();
      if (
        this.reduced.matches ||
        !next.width ||
        !next.height ||
        card.dataset.moving === "true"
      )
        continue;
      const dx = old.left - next.left,
        dy = old.top - next.top;
      if (
        Math.abs(dx) +
          Math.abs(dy) +
          Math.abs(old.width - next.width) +
          Math.abs(old.height - next.height) <
        0.5
      )
        continue;
      card.animate(
        [
          {
            transform: `translate(${dx}px,${dy}px) scale(${old.width / next.width},${old.height / next.height})`,
          },
          { transform: "none" },
        ],
        { duration: 190, easing: "cubic-bezier(.2,.75,.25,1)" },
      );
    }
    if (!this.gesture) this.refresh();
  }
  private scrollParent() {
    let p = this.grid.parentElement;
    while (p && p !== document.body) {
      if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
      p = p.parentElement;
    }
    return document.scrollingElement as HTMLElement;
  }
  private down(e: PointerEvent) {
    if (!this.enabled || this.gesture || e.button !== 0) return;
    const target = e.target as HTMLElement,
      grip = target.closest<HTMLElement>("[data-widget-move]"),
      handle = target.closest<HTMLElement>("[data-seam]"),
      corner = target.closest<HTMLElement>("[data-widget-resize]");
    if (!grip && !handle && !corner) return;
    e.preventDefault();
    e.stopPropagation();
    if (handle?.getAttribute("aria-disabled") === "true") {
      this.options.announce("已达到标准尺寸限制，可先加大周围组件");
      return;
    }
    const original = clone(this.options.items()),
      { columns, gap, row } = this.dimensions(),
      gridRect = this.grid.getBoundingClientRect(),
      scroller = this.scrollParent();
    const id = grip?.dataset.widgetMove ?? corner?.dataset.widgetResize,
      card = id
        ? this.cards().find((c) => c.dataset.instanceId === id)
        : undefined,
      rect = card?.getBoundingClientRect();
    const seams: GridBoundary[] = handle
      ? JSON.parse(handle.dataset.seam!)
      : [];
    this.gesture = {
      pointer: e.pointerId,
      kind: grip ? "move" : corner ? "corner" : "resize",
      corner: corner?.dataset.corner as "nw" | "se" | undefined,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      original,
      current: clone(original),
      rects: packGrid(original, columns),
      columns,
      stepX: (gridRect.width + gap) / columns,
      stepY: row + gap,
      id,
      index: original.findIndex((i) => i.id === id),
      seams,
      candidates: seams.length ? this.candidates(original, columns, seams) : [],
      offsetX: rect ? e.clientX - rect.left : 0,
      offsetY: rect ? e.clientY - rect.top : 0,
      active: false,
      lastKey: "",
      scroller,
      scroll: scroller.scrollTop,
    };
    this.grid.setPointerCapture(e.pointerId);
  }
  private requestFrame() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }
  private update() {
    const g = this.gesture;
    if (!g) return;
    const dx = g.x - g.startX,
      dy = g.y - g.startY;
    if (!g.active && Math.hypot(dx, dy) < 5) return;
    if (!g.active) {
      g.active = true;
      this.grid.dataset.manipulating = "true";
      this.overlay.classList.add("iw-handles-busy");
      this.hint.hidden = false;
      if (g.kind === "move") {
        const card = this.cards().find((c) => c.dataset.instanceId === g.id)!;
        const rect = card.getBoundingClientRect();
        g.ghost = card.cloneNode(true) as HTMLElement;
        g.ghost.removeAttribute("id");
        g.ghost
          .querySelectorAll("[id]")
          .forEach((el) => el.removeAttribute("id"));
        g.ghost.classList.add("iw-drag-ghost");
        g.ghost.setAttribute("aria-hidden", "true");
        g.ghost.inert = true;
        g.ghost.style.width = `${rect.width}px`;
        g.ghost.style.height = `${rect.height}px`;
        // The desktop surface uses backdrop-filter, which changes the containing
        // block of fixed descendants. Keep the lifted card in viewport space.
        g.portal = document.createElement("div");
        g.portal.className = "information-widgets iw-drag-portal";
        const theme = getComputedStyle(this.grid.parentElement!);
        for (const name of [
          "--iw-ink",
          "--iw-muted",
          "--iw-line",
          "--iw-accent",
          "--theme-paper",
        ])
          g.portal.style.setProperty(name, theme.getPropertyValue(name));
        g.portal.append(g.ghost);
        document.body.append(g.portal);
        card.dataset.moving = "true";
        this.marker.hidden = false;
      } else
        for (const card of this.cards())
          if (
            (g.kind === "corner" && card.dataset.instanceId === g.id) ||
            g.seams.some((s) =>
              [...s.before, ...s.after].includes(card.dataset.instanceId!),
            )
          )
            card.dataset.resizing = "true";
    }
    if (g.kind === "move") this.updateMove(g);
    else if (g.kind === "corner")
      this.updateCorner(g, dx, dy + g.scroller.scrollTop - g.scroll);
    else this.updateResize(g, dx, dy + g.scroller.scrollTop - g.scroll);
  }
  private updateMove(g: Gesture) {
    const grid = this.grid.getBoundingClientRect(),
      { gap } = this.dimensions();
    const scrollRect =
      g.scroller === document.scrollingElement
        ? { top: 0, bottom: innerHeight }
        : g.scroller.getBoundingClientRect();
    const shift =
      g.y < scrollRect.top + 60 ? -10 : g.y > scrollRect.bottom - 60 ? 10 : 0;
    if (shift) {
      const before = g.scroller.scrollTop;
      g.scroller.scrollTop += shift;
      if (g.scroller.scrollTop !== before) this.requestFrame();
    }
    if (g.ghost) {
      g.ghost.style.left = `${g.x - g.offsetX}px`;
      g.ghost.style.top = `${g.y - g.offsetY}px`;
    }
    const item = g.original.find(i=>i.id===g.id)!;
    const x = Math.max(0,Math.min(g.columns-item.columns,Math.round((g.x-g.offsetX-grid.left)/g.stepX)));
    const y = Math.max(0,Math.round((g.y-g.offsetY-grid.top)/g.stepY));
    const next = moveFixedGrid(g.original, g.id!, x, y, g.columns);
    g.valid = !!next;
    if (next) { g.current=next; }
    const place = {x,y,w:item.columns,h:item.rows};
    Object.assign(this.marker.style, {
      left: `${place.x * g.stepX}px`, top: `${place.y * g.stepY}px`,
      width: `${place.w * g.stepX - gap}px`, height: `${place.h * g.stepY - gap}px`,
    });
    this.marker.dataset.invalid = String(!next);
    this.marker.textContent = next ? "放在这里" : "位置已占用";
    this.hint.textContent = next ? `第 ${x+1} 列 / 第 ${y+1} 行 · 松手保存 · Esc 取消` : "位置已占用，松手恢复原位";
    this.positionHint(g);
  }
  private updateCorner(g: Gesture, dx: number, dy: number) {
    const items = resizeCornerGrid(
      g.original,
      g.id!,
      g.corner!,
      dx / g.stepX,
      dy / g.stepY,
      g.columns,
    );
    const item = items.find((i) => i.id === g.id)!;
    const key = `${item.columns}/${item.rows}`;
    if (key !== g.lastKey) {
      g.lastKey = key;
      g.current = items;
      this.animateApply(items, false);
    }
    this.hint.textContent = `${item.columns} 列 × ${item.rows} 行 · 松手保存 · Esc 取消`;
    this.positionHint(g);
  }
  private updateResize(g: Gesture, dx: number, dy: number) {
    const next = this.nearest(g.candidates, dx / g.stepX, dy / g.stepY),
      key = `${next.dx}/${next.dy}`;
    if (key !== g.lastKey) {
      g.lastKey = key;
      g.current = next.items;
      this.animateApply(g.current, false);
    }
    const involved = new Set(g.seams.flatMap((s) => [...s.before, ...s.after]));
    this.hint.textContent = `${[...involved]
      .map((id) => {
        const i = g.current.find((v) => v.id === id)!;
        return `${i.columns}×${i.rows}`;
      })
      .join(" / ")} · 松手保存 · Esc 取消`;
    this.positionHint(g);
    for (const handle of this.overlay.querySelectorAll<HTMLElement>(
      "[data-seam]",
    )) {
      const seams: GridBoundary[] = JSON.parse(handle.dataset.seam!);
      const matches = seams.every((s) =>
        g.seams.some(
          (v) => v.axis === s.axis && v.at === s.at && v.from === s.from,
        ),
      );
      handle.style.transform = matches
        ? `translate(${seams.some((s) => s.axis === "x") ? next.dx * g.stepX : 0}px,${seams.some((s) => s.axis === "y") ? next.dy * g.stepY : 0}px)`
        : "";
    }
  }
  private positionHint(g: Gesture) {
    const r = this.grid.getBoundingClientRect();
    this.hint.style.left = `${Math.max(0, Math.min(r.width - 240, g.x - r.left + 12))}px`;
    this.hint.style.top = `${g.y - r.top + 20}px`;
  }
  private finish(cancel: boolean) {
    const g = this.gesture;
    if (!g) return;
    cancel = cancel || g.valid === false;
    this.gesture = undefined;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (g.active) this.animateApply(cancel ? g.original : g.current, !cancel);
    const card = g.id
      ? this.cards().find((c) => c.dataset.instanceId === g.id)
      : undefined;
    if (g.ghost && !cancel && !this.reduced.matches && card) {
      const from = g.ghost.getBoundingClientRect(),
        to = card.getBoundingClientRect(),
        ghost = g.ghost;
      const animation = ghost.animate(
        [
          { transform: "scale(1.015)" },
          {
            transform: `translate(${to.left - from.left}px,${to.top - from.top}px) scale(1)`,
          },
        ],
        {
          duration: 170,
          easing: "cubic-bezier(.2,.75,.25,1)",
          fill: "forwards",
        },
      );
      animation.finished.catch(() => {}).finally(() => g.portal?.remove());
    } else g.portal?.remove();
    for (const c of this.cards()) {
      delete c.dataset.moving;
      delete c.dataset.resizing;
    }
    this.marker.hidden = this.hint.hidden = true;
    delete this.grid.dataset.manipulating;
    this.overlay.classList.remove("iw-handles-busy");
    if (this.grid.hasPointerCapture(g.pointer))
      this.grid.releasePointerCapture(g.pointer);
    this.refresh();
    if (g.active)
      this.options.announce(cancel ? "已取消本次调整" : "布局已保存");
  }
}
