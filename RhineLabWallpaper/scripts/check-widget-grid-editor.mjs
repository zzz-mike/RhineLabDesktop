import assert from "node:assert/strict";
import { build } from "esbuild";
const { outputFiles } = await build({
  entryPoints: ["src/widget-grid.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const g = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);
const item = (id, columns = 6, rows = 4, minRows = 3) => ({
  id,
  columns,
  rows,
  minRows,
});
let checks = 0;
const check = (v, m) => {
  assert.ok(v, m);
  checks++;
};
const four = [item("a"), item("b"), item("c"), item("d")],
  rects = g.packGrid(four, 12);
assert.deepEqual(
  rects.map(({ id, ...r }) => r),
  [
    { x: 0, y: 0, w: 6, h: 4 },
    { x: 6, y: 0, w: 6, h: 4 },
    { x: 0, y: 4, w: 6, h: 4 },
    { x: 6, y: 4, w: 6, h: 4 },
  ],
);
checks++;
const seams = g.gridBoundaries(rects),
  junction = g.gridJunctions(seams).find((j) => j.x === 6 && j.y === 4);
check(junction, "four-card cross is discoverable");
assert.deepEqual(
  g.resizeGrid(four, 12, [junction.vertical], 1, 0).map((i) => i.columns),
  [7, 5, 7, 5],
);
checks++;
const moved = g.resizeGrid(
  four,
  12,
  [junction.vertical, junction.horizontal],
  2,
  1,
);
check(!!moved, "four-card diagonal resize available");
assert.deepEqual(
  moved.map((i) => [i.columns, i.rows]),
  [
    [8, 5],
    [4, 5],
    [8, 3],
    [4, 3],
  ],
);
checks++;
check(
  g.resizeGrid(four, 12, [junction.vertical], 4, 0) === null,
  "no unsupported 10/2 columns",
);
check(
  g.resizeGrid(four, 12, [junction.horizontal], 0, 2) === null,
  "minimum rows protected",
);
const three = [item("a", 12, 4), item("b", 6, 4), item("c", 6, 4)],
  tj = g.gridJunctions(g.gridBoundaries(g.packGrid(three, 12)))[0];
check(!!tj, "T-junction is discoverable");
const t = g.resizeGrid(three, 12, [tj.vertical, tj.horizontal], -2, 1);
assert.deepEqual(
  t.map((i) => [i.columns, i.rows]),
  [
    [12, 5],
    [4, 3],
    [8, 3],
  ],
);
checks++;
const vertical = [item("a", 4, 8), item("b", 8, 4), item("c", 8, 4)],
  vj = g.gridJunctions(g.gridBoundaries(g.packGrid(vertical, 12)))[0];
check(!!vj, "rotated T-junction");
check(
  !!g.resizeGrid(vertical, 12, [vj.vertical, vj.horizontal], 2, -1),
  "rotated T resizes all three",
);
const solar = [
  item("a", 6, 4, 4),
  item("b", 6, 4, 4),
  item("c", 6, 4, 4),
  item("d", 6, 4, 4),
];
const sj = g.gridJunctions(g.gridBoundaries(g.packGrid(solar, 12)))[0];
check(
  g.resizeGrid(solar, 12, [sj.horizontal], 0, 1) === null,
  "solar minimum four rows",
);
const narrow = [item("a", 12), item("b", 6)];
check(
  g.packGrid(narrow, 8).every((r) => r.x + r.w <= 8),
  "responsive widths cap",
);
assert.deepEqual(
  g.reorderGrid(four, "a", 2).map((i) => i.id),
  ["b", "c", "a", "d"],
);
checks++;
assert.deepEqual(
  four.map((i) => i.id),
  ["a", "b", "c", "d"],
);
checks++;
for (let seed = 0; seed < 35; seed++) {
  const items = Array.from({ length: 6 }, (_, i) =>
    item(
      String(i),
      [4, 6, 8, 12][(seed + i * 3) % 4],
      3 + ((seed * 3 + i) % 6),
    ),
  );
  const columns = [4, 8, 12][seed % 3];
  const rects = g.packGrid(items, columns);
  check(
    rects.every((r) => r.w > 0 && r.x + r.w <= columns),
    "random pack within grid",
  );
  for (const seam of g.gridBoundaries(rects))
    for (const delta of [-2, -1, 0, 1, 2]) {
      const next = g.resizeGrid(
        items,
        columns,
        [seam],
        seam.axis === "x" ? delta : 0,
        seam.axis === "y" ? delta : 0,
      );
      if (!next) continue;
      const packed = g.packGrid(next, columns);
      check(
        packed.every((a, i) =>
          packed.every(
            (b, j) =>
              i === j ||
              a.x >= b.x + b.w ||
              a.x + a.w <= b.x ||
              a.y >= b.y + b.h ||
              a.y + a.h <= b.y,
          ),
        ),
        "shared resize cannot overlap",
      );
      check(
        next.every((i) => i.rows >= i.minRows && i.rows <= 8),
        "bounds maintained",
      );
    }
}
console.log(
  JSON.stringify({
    widgetGridChecks: checks,
    passed: true,
    coverage:
      "pair/T/four-way/bounds/responsive/reorder/randomized non-overlap",
  }),
);
