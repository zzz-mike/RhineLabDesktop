/** Integer grid geometry, shared by live previews and committed layout changes. */
export const columnSizes = [4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export interface GridItem {
  id: string;
  columns: number;
  rows: number;
  minRows: number;
  x?: number;
  y?: number;
}
export interface GridRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface GridBoundary {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
  before: string[];
  after: string[];
}
export interface GridJunction {
  x: number;
  y: number;
  vertical: GridBoundary;
  horizontal: GridBoundary;
}
const intersects = (a: GridRect, b: GridRect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const overlaps = (a: number, b: number, c: number, d: number) =>
  Math.min(b, d) > Math.max(a, c);
/** CSS grid's sparse, row-major auto-placement, with no reordering or overlap. */
export function packGrid(items: GridItem[], columns: number): GridRect[] {
  if (items.every(i => i.x !== undefined && i.y !== undefined))
    return items.map(i => ({id:i.id, x:i.x!, y:i.y!, w:i.columns, h:i.rows}));
  const result: GridRect[] = [];
  let x = 0,
    y = 0;
  for (const item of items) {
    const w = Math.min(columns, item.columns),
      h = item.rows;
    while (true) {
      if (x + w > columns) {
        x = 0;
        y++;
      }
      const rect = { id: item.id, x, y, w, h };
      if (!result.some((other) => intersects(rect, other))) {
        result.push(rect);
        x += w;
        break;
      }
      x++;
    }
  }
  return result;
}
function sameCoverage(a: [number, number][], b: [number, number][]) {
  const merge = (ranges: [number, number][]) => {
    const result: [number, number][] = [];
    for (const r of ranges.sort((a, b) => a[0] - b[0])) {
      const last = result.at(-1);
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else result.push([...r]);
    }
    return JSON.stringify(result);
  };
  return merge(a) === merge(b);
}
/** Each seam affects the complete connected set on both sides (including T joins). */
export function gridBoundaries(rects: GridRect[]): GridBoundary[] {
  const result: GridBoundary[] = [];
  for (const axis of ["x", "y"] as const) {
    const start = (r: GridRect) => (axis === "x" ? r.x : r.y),
      size = (r: GridRect) => (axis === "x" ? r.w : r.h);
    const cross = (r: GridRect): [number, number] =>
      axis === "x" ? [r.y, r.y + r.h] : [r.x, r.x + r.w];
    for (const at of new Set(rects.map((r) => start(r) + size(r)))) {
      const before = rects.filter((r) => start(r) + size(r) === at),
        after = rects.filter((r) => start(r) === at);
      const used = new Set<string>();
      for (const seed of before) {
        if (used.has(seed.id)) continue;
        const left = new Set([seed.id]),
          right = new Set<string>();
        let changed = true;
        while (changed) {
          changed = false;
          for (const a of before)
            for (const b of after) {
              const [a0, a1] = cross(a),
                [b0, b1] = cross(b);
              if (
                overlaps(a0, a1, b0, b1) &&
                (left.has(a.id) || right.has(b.id))
              ) {
                if (!left.has(a.id)) {
                  left.add(a.id);
                  changed = true;
                }
                if (!right.has(b.id)) {
                  right.add(b.id);
                  changed = true;
                }
              }
            }
        }
        left.forEach((id) => used.add(id));
        if (!right.size) continue;
        const aa = before.filter((r) => left.has(r.id)).map(cross),
          bb = after.filter((r) => right.has(r.id)).map(cross);
        if (!sameCoverage(aa, bb)) continue;
        result.push({
          axis,
          at,
          from: Math.min(...aa.map((r) => r[0])),
          to: Math.max(...aa.map((r) => r[1])),
          before: [...left],
          after: [...right],
        });
      }
    }
  }
  return result;
}
export function gridJunctions(boundaries: GridBoundary[]): GridJunction[] {
  const result: GridJunction[] = [],
    seen = new Set<string>();
  const merge = (parts: GridBoundary[]): GridBoundary => ({
    ...parts[0],
    from: Math.min(...parts.map((p) => p.from)),
    to: Math.max(...parts.map((p) => p.to)),
    before: [...new Set(parts.flatMap((p) => p.before))],
    after: [...new Set(parts.flatMap((p) => p.after))],
  });
  for (const v of boundaries.filter((b) => b.axis === "x"))
    for (const h of boundaries.filter((b) => b.axis === "y")) {
      const key = `${v.at}/${h.at}`;
      if (
        seen.has(key) ||
        v.at < h.from ||
        v.at > h.to ||
        h.at < v.from ||
        h.at > v.to
      )
        continue;
      const vertical = merge(
        boundaries.filter(
          (b) =>
            b.axis === "x" && b.at === v.at && h.at >= b.from && h.at <= b.to,
        ),
      );
      const horizontal = merge(
        boundaries.filter(
          (b) =>
            b.axis === "y" && b.at === h.at && v.at >= b.from && v.at <= b.to,
        ),
      );
      if (
        new Set([
          ...vertical.before,
          ...vertical.after,
          ...horizontal.before,
          ...horizontal.after,
        ]).size >= 3
      ) {
        seen.add(key);
        result.push({ x: v.at, y: h.at, vertical, horizontal });
      }
    }
  return result;
}
/** Resize from the original snapshot. Never compound deltas or silently resize an unrelated card. */
export function resizeGrid(
  items: GridItem[],
  columns: number,
  seams: GridBoundary[],
  dx: number,
  dy: number,
): GridItem[] | null {
  const rects = packGrid(items, columns),
    expected = rects.map((r) => ({ ...r })),
    next = items.map((i) => ({ ...i }));
  for (const seam of seams) {
    const delta = seam.axis === "x" ? dx : dy;
    if (!Number.isInteger(delta)) return null;
    for (const rect of expected) {
      const side = seam.before.includes(rect.id)
        ? 1
        : seam.after.includes(rect.id)
          ? -1
          : 0;
      if (!side) continue;
      const item = next.find((i) => i.id === rect.id)!;
      if (seam.axis === "x") {
        // Validate effective width; unchanged responsive caps retain their original preference.
        const width = rect.w + side * delta;
        if (
          !columnSizes.includes(width as (typeof columnSizes)[number]) ||
          width > columns
        )
          return null;
        if (delta !== 0) item.columns = width;
        rect.w = width;
        if (side < 0) rect.x += delta;
      } else {
        const height = rect.h + side * delta;
        if (height < item.minRows || height > 8) return null;
        item.rows = height;
        rect.h = height;
        if (side < 0) rect.y += delta;
      }
    }
  }
  if (items.every(i => i.x !== undefined && i.y !== undefined)) {
    for (const item of next) { const rect = expected.find(r => r.id === item.id)!; item.x = rect.x; item.y = rect.y; }
    return validFixedGrid(next, columns) ? next : null;
  }
  const actual = packGrid(next, columns);
  // Sparse packing must preserve the intended shared boundary and every unrelated cell.
  if (
    actual.some(
      (r, i) =>
        r.x !== expected[i].x ||
        r.y !== expected[i].y ||
        r.w !== expected[i].w ||
        r.h !== expected[i].h,
    )
  )
    return null;
  return next;
}
export function nearestResize(
  items: GridItem[],
  columns: number,
  seams: GridBoundary[],
  dx: number,
  dy: number,
) {
  const xs = seams.some((s) => s.axis === "x")
    ? Array.from({ length: 17 }, (_, i) => i - 8)
    : [0];
  const ys = seams.some((s) => s.axis === "y")
    ? Array.from({ length: 17 }, (_, i) => i - 8)
    : [0];
  let best:
    { items: GridItem[]; dx: number; dy: number; distance: number } | undefined;
  for (const x of xs)
    for (const y of ys) {
      const distance = (x - dx) ** 2 + (y - dy) ** 2;
      if (best && distance >= best.distance) continue;
      const value = resizeGrid(items, columns, seams, x, y);
      if (value) best = { items: value, dx: x, dy: y, distance };
    }
  return (
    best ?? { items: items.map((i) => ({ ...i })), dx: 0, dy: 0, distance: 0 }
  );
}
export function reorderGrid(
  items: GridItem[],
  id: string,
  index: number,
): GridItem[] {
  const moving = items.find((i) => i.id === id);
  if (!moving) return items;
  const rest = items.filter((i) => i.id !== id);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, moving);
  return rest;
}

/** Corner travel is measured in grid cells; NW reverses both axes. */
export function resizeCornerGrid(
  items: GridItem[],
  id: string,
  corner: "nw" | "se",
  dx: number,
  dy: number,
  viewportColumns = 12,
): GridItem[] {
  if (items.every(i => i.x !== undefined && i.y !== undefined)) {
    const original = items.find(i => i.id === id)!;
    const next = items.map(i => ({...i}));
    const item = next.find(i => i.id === id)!;
    const sign = corner === "nw" ? -1 : 1;
    item.columns = Math.max(4, Math.min(12, original.columns + Math.round(sign * dx)));
    item.rows = Math.max(item.minRows, Math.min(8, original.rows + Math.round(sign * dy)));
    if (corner === "nw") {
      item.x = original.x! + original.columns - item.columns;
      item.y = original.y! + original.rows - item.rows;
    }
    if (validFixedGrid(next, viewportColumns)) return next;
    let best = items.map(i=>({...i})), distance = Infinity;
    for (let width=4; width<=12; width++) for (let height=original.minRows; height<=8; height++) {
      const trial = items.map(i=>({...i})), target=trial.find(i=>i.id===id)!;
      Object.assign(target,{columns:width,rows:height});
      if(corner==="nw") {target.x=original.x!+original.columns-width;target.y=original.y!+original.rows-height;}
      const d=(width-item.columns)**2+(height-item.rows)**2;
      if(d<distance && validFixedGrid(trial,viewportColumns)){best=trial;distance=d;}
    }
    return best;
  }
  const sign = corner === "nw" ? -1 : 1;
  const x = Math.round(sign * dx),
    y = Math.round(sign * dy);
  return items.map((item) => {
    if (item.id !== id) return { ...item };
    // A narrow screen clips a stored wide card. A vertical drag must not erase its desktop width.
    const visible = Math.min(item.columns, viewportColumns);
    const columns =
      x === 0
        ? item.columns
        : Math.max(4, Math.min(Math.max(4, viewportColumns), visible + x));
    return {
      ...item,
      columns,
      rows: Math.max(item.minRows, Math.min(8, item.rows + y)),
    };
  });
}

/** Freeze the legacy arrangement once. New cards append below it, never fill holes. */
export function pinGrid(items: GridItem[]): GridItem[] {
  if (!items.some(i => i.x !== undefined && i.y !== undefined)) {
    const rects = packGrid(items, 12);
    return items.map((i,n) => ({...i, x:rects[n].x, y:rects[n].y}));
  }
  let bottom = Math.max(0, ...items.filter(i=>i.y!==undefined).map(i=>i.y!+i.rows));
  return items.map(i => {
    if (i.x !== undefined && i.y !== undefined) return {...i};
    const result = {...i, x:0, y:bottom}; bottom += i.rows; return result;
  });
}
export function validFixedGrid(items: GridItem[], columns = 12): boolean {
  const rects = packGrid(items, columns);
  return rects.every((r,n) => Number.isInteger(r.x) && Number.isInteger(r.y) && r.x >= 0 && r.y >= 0 && r.y <= 10000 && r.x+r.w <= columns && !rects.slice(n+1).some(other=>intersects(r,other)));
}
export function moveFixedGrid(items: GridItem[], id: string, x: number, y: number, columns = 12): GridItem[] | null {
  const next = items.map(i=>i.id === id ? {...i,x:Math.max(0,Math.min(columns-i.columns,Math.round(x))),y:Math.max(0,Math.min(10000,Math.round(y)))} : {...i});
  return validFixedGrid(next, columns) ? next : null;
}
