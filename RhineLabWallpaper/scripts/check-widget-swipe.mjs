import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({
  stdin: {
    contents: `export {WidgetPageMotion} from './src/widget-page-motion'; export {InformationWidgets} from './src/information-widgets';export {SwipePager} from './src/widget-layout';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  loader: { ".css": "empty" },
});
const { WidgetPageMotion, InformationWidgets, SwipePager } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
let checks = 0;
const check = (v, label) => {
  assert.ok(v, label);
  checks++;
};
const tick = () => new Promise(setImmediate);
class Node extends EventTarget {
  children = [];
  style = {};
  dataset = {};
  attrs = new Map();
  clientWidth = 400;
  hidden = false;
  isConnected = true;
  form = false;
  animations = [];
  classList = { add: () => {} };
  append(...nodes) {
    for (const n of nodes) {
      n.parent = this;
      this.children.push(n);
    }
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter((n) => n !== this);
  }
  closest() {
    return this.form ? this : null;
  }
  setAttribute(k, v) {
    this.attrs.set(k, v);
  }
  removeAttribute(k) {
    this.attrs.delete(k);
    if (k === "data-page-motion") delete this.dataset.pageMotion;
  }
  querySelectorAll() {
    return [];
  }
  cloneNode() {
    return new Node();
  }
  animate(frames, options) {
    let resolve;
    const a = {
      frames,
      options,
      finished: new Promise((r) => (resolve = r)),
      cancel() {
        resolve();
      },
      finish() {
        resolve();
      },
    };
    this.animations.push(a);
    return a;
  }
}
let reduced = false;
const previous = {
  document: globalThis.document,
  matchMedia: globalThis.matchMedia,
  window: globalThis.window,
};
globalThis.document = { createElement: () => new Node() };
globalThis.matchMedia = () => ({ matches: reduced });
globalThis.window = { getSelection: () => ({ toString: () => "" }) };
try {
  const viewport = new Node(),
    body = new Node();
  viewport.append(body);
  const motion = new WidgetPageMotion(viewport, body);
  motion.preview(24, true);
  check(
    Math.abs(
      parseFloat(body.style.transform.slice("translate3d(".length)) + 13.2,
    ) < 0.01,
    "positive wheel follows content to left before commit",
  );
  motion.release();
  await tick();
  check(
    body.animations.length === 1,
    "short drag springs back without changing a page",
  );
  body.animations.at(-1).finish();
  await tick();
  const first = motion.begin(1);
  check(
    body.style.transform.includes("-16px") && viewport.children.length === 2,
    "pending page retains old visible body without overlay",
  );
  motion.complete(first, true);
  check(
    viewport.children.length === 3 &&
      motion.ghost.inert &&
      motion.ghost.attrs.get("aria-hidden") === "true",
    "one outgoing snapshot is inert and hidden from accessibility",
  );
  check(
    body.animations.at(-1).frames[0].transform.includes("400px"),
    "next page enters from right",
  );
  motion.animations.forEach((a) => a.finish());
  await tick();
  await tick();
  check(
    viewport.children.length === 2 &&
      body.style.transform === "" &&
      !viewport.dataset.pageMotion,
    "completed motion removes temporary layer and compositor hint",
  );
  const failed = motion.begin(-1);
  motion.complete(failed, false, true);
  check(
    motion.hint.textContent.includes("保留当前页") &&
      viewport.children.length === 2,
    "failure retains current content and gives feedback",
  );
  motion.cancel();
  const canceled = motion.begin(1);
  motion.cancel();
  motion.complete(canceled, true);
  check(
    viewport.children.length === 2 && !viewport.dataset.pageMotion,
    "late completion cannot restore canceled animation",
  );
  reduced = true;
  const before = body.animations.length;
  motion.preview(35, true);
  const quiet = motion.begin(1);
  motion.complete(quiet, true);
  check(
    body.animations.length === before &&
      viewport.children.length === 2 &&
      body.style.transform === "",
    "reduced motion does not clone or slide",
  );
  reduced = false;
  motion.boundary(-1);
  check(
    motion.hint.textContent === "已是第一页",
    "first-page boundary feedback",
  );
  motion.cancel();
  const root = new Node(),
    card = {
      placement: { id: "one" },
      root,
      body: new Node(),
      pageMotion: { preview() {}, release() {}, cancel() {} },
      response: {
        items: [{ id: "a" }, { id: "b" }],
        total: 20,
        pagination: { offset: 0 },
      },
      offset: 0,
      pageSize: 2,
      loading: false,
    };
  const host = Object.create(InformationWidgets.prototype);
  let turns = [];
  Object.assign(host, {
    editing: false,
    turn: (_, direction) => turns.push(direction),
  });
  host.bindPaging(card);
  const wheel = (x, y, more = {}) => {
    const e = new Event("wheel", { cancelable: true });
    Object.assign(e, {
      deltaX: x,
      deltaY: y,
      deltaMode: 0,
      ctrlKey: false,
      ...more,
    });
    root.dispatchEvent(e);
    return e.defaultPrevented;
  };
  check(wheel(30, 1), "horizontal gesture is consumed by hovered card");
  check(wheel(30, 1) && turns.join() === "1", "threshold turns once");
  for (let i = 0; i < 8; i++) wheel(40, 0);
  check(turns.length === 1, "momentum cannot turn multiple pages");
  card.resetPaging();
  check(!wheel(0, 80) && turns.length === 1, "vertical scroll remains native");
  card.resetPaging();
  check(
    !wheel(100, 0, { ctrlKey: true }) && turns.length === 1,
    "pinch/browser zoom is not captured",
  );
  host.editing = true;
  check(!wheel(100, 0) && turns.length === 1, "layout editing does not page");
  host.editing = false;
  root.form = true;
  check(
    !wheel(100, 0) && turns.length === 1,
    "inputs retain native interaction",
  );
  root.form = false;
  check(
    wheel(-60, 0) && turns.at(-1) === -1,
    "new reversed gesture selects previous page",
  );
  card.resetPaging();
  const pager = new SwipePager();
  pager.wheel(20, 0, 0);
  check(
    pager.distance === 20 && !pager.committed,
    "drag progress is available before commit",
  );
  pager.wheel(30, 0, 10);
  check(pager.committed, "committed state locks one gesture");
  pager.wheel(60, 0, 220);
  check(pager.distance === 60, "quiet gap resets previous inertia");
  console.log(
    JSON.stringify({
      widgetSwipeChecks: checks,
      passed: true,
      productionWrites: 0,
    }),
  );
} catch (error) {
  console.error({
    message: error.message,
    actual: error.actual,
    expected: error.expected,
  });
  process.exitCode = 1;
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
}
