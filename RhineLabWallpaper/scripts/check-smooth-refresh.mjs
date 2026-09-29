import assert from "node:assert/strict";
import { build } from "esbuild";
const out = await build({
  stdin: {
    contents: `export {SharedReadPool} from './src/shared-read-pool';export {InformationWidgets} from './src/information-widgets';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  loader: { ".css": "empty" },
});
const { SharedReadPool, InformationWidgets } = await import(
  "data:text/javascript;base64," +
    Buffer.from(out.outputFiles[0].text).toString("base64")
);
let checks = 0;
const check = (v, msg) => {
  assert.ok(v, msg);
  checks++;
};
const tick = () => new Promise(setImmediate);
let calls = 0,
  pending = [];
const pool = new SharedReadPool((key, signal) => {
  calls++;
  return new Promise((resolve, reject) => {
    pending.push({ key, signal, resolve });
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("cancel", "AbortError")),
      { once: true },
    );
  });
}, 2);
const a = new AbortController(),
  b = new AbortController();
const p1 = pool.get("same", a.signal),
  p2 = pool.get("same", b.signal);
await tick();
check(calls === 1, "same query shares transport");
a.abort();
await assert.rejects(p1, { name: "AbortError" });
check(!pending[0].signal.aborted, "one subscriber cannot cancel other");
pending[0].resolve("ok");
check((await p2) === "ok", "remaining subscriber resolves");
const later = pool.get("same");
await tick();
check(calls === 2, "settled result is not stale cached promise");
pending.at(-1).resolve("new");
check((await later) === "new", "subsequent identical read settles");
const c = new AbortController(),
  d = new AbortController();
const p3 = pool.get("cancel", c.signal),
  p4 = pool.get("cancel", d.signal);
await tick();
const canceled = pending.at(-1);
c.abort();
d.abort();
await Promise.allSettled([p3, p4]);
check(canceled.signal.aborted, "last subscriber aborts network");
await tick();
const first = pool.get("epoch");
await tick();
pool.invalidate();
const second = pool.get("epoch");
await tick();
check(
  pending.filter((p) => p.key === "epoch").length === 2,
  "post-write invalidation does not join earlier read",
);
pending.filter((p) => p.key === "epoch").forEach((p, i) => p.resolve(i));
check(
  (await first) === 0 && (await second) === 1,
  "old read cannot remove newer same-key owner",
);
const c1 = pool.get("1"),
  c2 = pool.get("2"),
  c3 = pool.get("3");
await tick();
check(
  pending.filter((p) => ["1", "2", "3"].includes(p.key)).length === 2,
  "bounded transport concurrency",
);
pending.find((p) => p.key === "1").resolve(1);
await c1;
await tick();
check(
  pending.some((p) => p.key === "3"),
  "queue progresses",
);
pending.find((p) => p.key === "2").resolve(2);
pending.find((p) => p.key === "3").resolve(3);
await Promise.all([c2, c3]);
const oldDoc = globalThis.document;
globalThis.document = { hidden: false };
try {
  const host = Object.create(InformationWidgets.prototype),
    card = {
      placement: { id: "a", widget_id: "today", project_id: null },
      offset: 0,
      pageSize: 2,
      loading: false,
    };
  Object.assign(host, {
    active: true,
    destroyed: false,
    cards: new Map([["a", card]]),
  });
  let loads = 0,
    release;
  host.runLoad = async () => {
    loads++;
    await new Promise((r) => (release = r));
  };
  const x = host.load(card, true),
    y = host.load(card, true, "background");
  check(x === y && loads === 1, "same card refresh joins current read");
  release();
  await Promise.all([x, y]);
  card.resizeTimer = setTimeout(() => {}, 10000);
  await host.load(card, true, "background");
  check(loads === 1, "background waits out pending resize debounce");
  clearTimeout(card.resizeTimer);
  card.resizeTimer = undefined;
  card.loading = true;
  card.blocking = false;
  card.response = {
    items: [{ id: "a" }, { id: "b" }],
    total: 20,
    pagination: { offset: 0, next_offset: 2 },
  };
  let turns = 0;
  host.load = () => {
    turns++;
    return Promise.resolve();
  };
  host.turn(card, 1);
  check(
    turns === 1 && card.offset === 2,
    "background loading does not block paging",
  );
  card.pageSize = 4;
  card.offset = 0;
  host.turn(card, 1);
  check(
    card.offset === 2,
    "larger capacity does not skip unseen rows from previous smaller page",
  );
  card.pageSize = 1;
  card.offset = 0;
  host.turn(card, 1);
  check(
    card.offset === 1,
    "smaller capacity advances after actually displayed rows",
  );
} finally {
  if (oldDoc === undefined) delete globalThis.document;
  else globalThis.document = oldDoc;
}
const nativeFetch=globalThis.fetch;
try {
  const host=Object.create(InformationWidgets.prototype),card={placement:{id:'solar-check',widget_id:'solar.generation'}};
  Object.assign(host,{generation:1,cards:new Map([[card.placement.id,card]]),renderCard(){}});
  globalThis.fetch=async()=>new Response(JSON.stringify({error:'isolated failure',code:'unavailable'}),{status:502,headers:{'content-type':'application/json'}});
  const pending=host.loadTrend(card,'solar:fixture:a');
  check(card.trendState==='loading','progressive trend is loading before response, not missing');
  await pending;check(card.trendState==='error','failed trend has distinct error state');
  globalThis.fetch=async()=>new Response(JSON.stringify({schema_version:'1.0',widget_id:'solar.trend',title:'curve',status:'empty',generated_at:'2026-09-25T00:00:00Z',data_updated_at:null,timezone:'Asia/Shanghai',message:'no points',items:[],total:0,truncated:false,metrics:[],points:[],source:{id:'fixture',label:'fixture'}}),{headers:{'content-type':'application/json'}});
  await host.loadTrend(card,'solar:fixture:a');check(card.trendState==='ready'&&card.trend.items.length===0,'successful empty trend is distinct from loading or failure');
} finally {globalThis.fetch=nativeFetch;}
console.log(JSON.stringify({ smoothRefreshChecks: checks, passed: true }));
