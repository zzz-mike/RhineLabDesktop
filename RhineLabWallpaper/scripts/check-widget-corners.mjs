import assert from "node:assert/strict";
import { build } from "esbuild";
const { outputFiles } = await build({
  entryPoints: ["src/widget-grid.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { resizeCornerGrid, packGrid } = await import(
  "data:text/javascript;base64," +
    Buffer.from(outputFiles[0].text).toString("base64")
);
const items = [
  { id: "a", columns: 6, rows: 4, minRows: 3 },
  { id: "b", columns: 6, rows: 4, minRows: 4 },
];
let checks = 0;
const check = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
check(resizeCornerGrid(items, "a", "se", 1, 2)[0], {
  id: "a",
  columns: 7,
  rows: 6,
  minRows: 3,
});
check(resizeCornerGrid(items, "a", "nw", 1, 1)[0], {
  id: "a",
  columns: 5,
  rows: 3,
  minRows: 3,
});
check(resizeCornerGrid(items, "a", "nw", -2, -2)[0], {
  id: "a",
  columns: 8,
  rows: 6,
  minRows: 3,
});
check(resizeCornerGrid(items, "a", "se", 0.4, 0.4), items);
check(resizeCornerGrid(items, "a", "se", 100, -100)[0], {
  id: "a",
  columns: 12,
  rows: 3,
  minRows: 3,
});
check(resizeCornerGrid(items, "b", "nw", 100, 100)[1], {
  id: "b",
  columns: 4,
  rows: 4,
  minRows: 4,
});
check(resizeCornerGrid(items, "a", "se", 0, 1, 4)[0].columns, 6);
check(resizeCornerGrid(items, "a", "se", 5, 0, 4)[0].columns, 4);
check(items[0], { id: "a", columns: 6, rows: 4, minRows: 3 });
for (const corner of ["nw", "se"])
  for (let dx = -10; dx <= 10; dx++)
    for (let dy = -10; dy <= 10; dy++) {
      const next = resizeCornerGrid(items, "a", corner, dx, dy),
        r = packGrid(next, 12);
      assert.ok(
        next[0].columns >= 4 &&
          next[0].columns <= 12 &&
          next[0].rows >= 3 &&
          next[0].rows <= 8,
      );
      assert.ok(
        !r.some((a, i) =>
          r
            .slice(i + 1)
            .some(
              (b) =>
                a.x < b.x + b.w &&
                a.x + a.w > b.x &&
                a.y < b.y + b.h &&
                a.y + a.h > b.y,
            ),
        ),
      );
      assert.deepEqual(next[1], items[1]);
      checks++;
    }
console.log(JSON.stringify({ cornerResizeChecks: checks, passed: true }));
