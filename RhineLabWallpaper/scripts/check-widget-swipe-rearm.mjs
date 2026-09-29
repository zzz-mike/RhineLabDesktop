import assert from "node:assert/strict";
import { build } from "esbuild";
const { outputFiles } = await build({
  entryPoints: ["src/widget-layout.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { SwipePager } = await import(
  "data:text/javascript;base64," +
    Buffer.from(outputFiles[0].text).toString("base64")
);
let checks = 0;
const eq = (a, b) => {
  assert.deepEqual(a, b);
  checks++;
};
const p = new SwipePager();
let time = 0,
  steps = [];
const send = (dx, dy = 0, dt = 16) => {
  time += dt;
  const r = p.wheel(dx, dy, time);
  if (r.step) steps.push({ step: r.step, time });
  return r;
};
[24, 32, 40, 36, 30, 24, 18, 12, 8, 5, 3, 2, 1].forEach((x) => send(x));
eq(
  steps.map((x) => x.step),
  [1],
);
// No 180ms silence: a deliberate new impulse lands in the old momentum stream.
[18, 30, 38, 30, 20, 12, 6, 3, 1].forEach((x) => send(x));
eq(
  steps.map((x) => x.step),
  [1, 1],
);
eq(steps[1].time - steps[0].time < 500, true);
[-22, -30, -35, -20, -10, -5, -1].forEach((x) => send(x));
eq(
  steps.map((x) => x.step),
  [1, 1, -1],
);
for (let i = 0; i < 190; i++) send(-Math.max(0.2, 1 - i * 0.01));
eq(steps.length, 3);
send(-24);
send(-30);
eq(
  steps.map((x) => x.step),
  [1, 1, -1, -1],
);
const q = new SwipePager();
let count = 0;
for (let t = 0; t < 2500; t += 16) count += !!q.wheel(30, 0, t).step;
eq(count, 1);
const r = new SwipePager();
r.wheel(60, 0, 0);
eq(r.wheel(-120, 0, 10).step, 0);
eq(r.wheel(-20, 0, 150).step, 0);
eq(r.wheel(-30, 0, 166).step, -1);
const v = new SwipePager();
v.wheel(60, 0, 0);
eq(v.wheel(0, 40, 150), { consume: false, step: 0 });
const gentle = new SwipePager();
let gentleSteps = 0,
  gt = 0;
for (const x of [
  30, 30, 28, 24, 18, 12, 8, 4, 2, 1, 2, 4, 7, 10, 14, 18, 20, 15, 9, 4, 1,
]) {
  gt += 16;
  gentleSteps += !!gentle.wheel(x, 0, gt).step;
}
eq(gentleSteps, 2);
console.log(
  JSON.stringify({
    swipeRearmChecks: checks,
    passed: true,
    scenario: "new impulse during 3-second inertia; no quiet gap required",
  }),
);
