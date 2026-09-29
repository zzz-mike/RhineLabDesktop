// Isolated frontend contract and async state checks. No real browser or network writes.
import assert from "node:assert/strict";
import { build } from "esbuild";
let checks = 0;
const check = (value, label) => {
  assert.ok(value, label);
  checks++;
};
const tick = () => new Promise(setImmediate);
class Element extends EventTarget {
  children = [];
  attributes = new Map();
  textContent = "";
  value = "";
  disabled = false;
  hidden = false;
  open = false;
  constructor(tag) {
    super();
    this.tagName = tag;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = [...nodes];
  }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
  }
  getAttribute(k) {
    return this.attributes.get(k);
  }
  get childElementCount() {
    return this.children.length;
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
  remove() {}
}
const flatten = (node) => [node, ...node.children.flatMap(flatten)];
const button = (node, text) =>
  flatten(node).find((e) => e.tagName === "button" && e.textContent === text);
const click = (node, text) => {
  const b = button(node, text);
  assert.ok(b, `button ${text}`);
  assert.ok(!b.disabled);
  b.dispatchEvent(new Event("click"));
};
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const project = {
  project_id: "secretary:test",
  project_name: "隔离项目",
  review_revision: "r1",
  note: { stage: "原进度", blocker: "", next_step: "", owner: "" },
  pinned: false,
  note_redacted: false,
};
const saved = (p = project) => ({
  schema_version: "1.0",
  ok: true,
  duplicate: false,
  revision: "r2",
  project: { ...p, review_revision: "r2" },
});
const nativeFetch = globalThis.fetch,
  nativeDoc = globalThis.document;
async function main() {
  const out = await build({
    stdin: {
      contents: `export * from './src/widget-workbench-client'; export {WidgetWorkbench} from './src/widget-workbench';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    loader: { ".css": "empty" },
  });
  const api = await import(
    "data:text/javascript;base64," +
      Buffer.from(out.outputFiles[0].text).toString("base64")
  );
  globalThis.document = {
    createElement: (tag) => new Element(tag),
    body: new Element("body"),
  };
  let changed = 0,
    reloaded = 0,
    finish;
  const host = new api.WidgetWorkbench(
    () => {},
    () => changed++,
  );
  const complete = async () => {
    for (let i = 0; i < 30 && host.busyProjects.size; i++) await tick();
    assert.equal(host.busyProjects.size, 0);
  };
  globalThis.fetch = async (path, options) =>
    path.includes("capabilities")
      ? response({
          secretary_review: true,
          secretary_review_token: "isolated-test",
        })
      : new Promise((resolve) => (finish = () => resolve(response(saved()))));
  host.open("旧项目");
  const pending = host.pinProject(project, () => reloaded++);
  for (let i = 0; i < 10 && !finish; i++) await tick();
  host.open("新视图");
  finish();
  await pending;
  check(
    changed === 1 &&
      reloaded === 0 &&
      host.pending.size === 0 &&
      host.title.textContent === "新视图",
    "late pin success updates data but cannot reopen earlier view",
  );
  host.editProject({ ...project, note_redacted: true });
  check(
    flatten(host.editor).every((e) => e.tagName !== "textarea"),
    "redacted note never creates editable masked fields",
  );
  globalThis.fetch = async () =>
    response(
      {
        error: "hidden note",
        code: "note_redacted",
        current_project: { ...project, note_redacted: true },
      },
      409,
    );
  host.editProject(project);
  click(host.editor, "保存项目便笺");
  await complete();
  check(
    host.pending.size === 0,
    "known note_redacted rejection clears pending UUID",
  );
  check(
    flatten(host.editor)
      .filter((e) => e.tagName === "textarea")
      .every((e) => e.disabled) && button(host.editor, "保存项目便笺").disabled,
    "late redaction disables note editing and save",
  );
  globalThis.fetch = async () =>
    response(saved({ ...project, pinned: true, note_redacted: true }));
  await host.pinProject({ ...project, note_redacted: true }, () => reloaded++);
  check(
    host.pending.size === 0 && reloaded === 1,
    "redacted note does not block independent pin update",
  );
  const bodies = [];
  let uncertain = true;
  globalThis.fetch = async (path, options) => {
    bodies.push(options.body);
    if (uncertain) {
      uncertain = false;
      throw new TypeError("isolated dropped reply");
    }
    return response(saved());
  };
  host.editProject(project);
  click(host.editor, "保存项目便笺");
  await complete();
  check(
    host.pending.size === 1 &&
      flatten(host.editor)
        .filter((e) => e.tagName === "textarea")
        .every((e) => e.disabled),
    "uncertain write retains request and locks payload",
  );
  click(host.editor, "重试同一保存请求");
  await complete();
  check(
    bodies.length === 2 && bodies[0] === bodies[1] && host.pending.size === 0,
    "uncertain retry uses exact UUID and payload",
  );
  const input = flatten(host.editor).find((e) => e.tagName === "textarea");
  input.value = "保存后的新草稿";
  input.dispatchEvent(new Event("input"));
  host.editProject({ ...project, review_revision: "r2" });
  check(
    flatten(host.editor).find((e) => e.tagName === "textarea").value ===
      "保存后的新草稿",
    "draft edited after successful save survives reopening editor",
  );
  const beforeOversize=bodies.length;
  for(const input of flatten(host.editor).filter(e=>e.tagName==='textarea')) {
    input.value='长'.repeat(2000);input.dispatchEvent(new Event('input'));
  }
  click(host.editor,'保存项目便笺');await complete();
  check(host.pending.size===0&&bodies.length===beforeOversize&&flatten(host.editor).filter(e=>e.tagName==='textarea').every(e=>!e.disabled),'oversized multibyte note stays editable and never becomes uncertain write');
  let resolveOld, resolveNew;
  const seen = [];
  const old = host.read(
    () => new Promise((r) => (resolveOld = r)),
    (x) => seen.push(x),
  );
  const latest = host.read(
    () => new Promise((r) => (resolveNew = r)),
    (x) => seen.push(x),
  );
  resolveNew("latest");
  await latest;
  resolveOld("old");
  await old;
  check(
    seen.join() === "latest",
    "late read cannot overwrite current workbench view",
  );
  const solar = {
    schema_version: "1.0",
    resource: "period",
    title: "隔离月统计",
    status: "partial",
    source_mode: "real",
    fetched_at: "2026-09-25T00:00:00Z",
    source_updated_at: null,
    message: "",
    rows: [],
    metrics: [],
    points: [
      {
        at: "2026-09",
        value: null,
        available_value: 2,
        missing_device_count: 1,
        unit: "kWh",
        series: "strict",
      },
    ],
    historical: true,
    current_state_saved: false,
    data_complete: false,
  };
  const parsed = api.parseSolar(solar, "period");
  check(
    parsed.points[0].at === "2026-09" &&
      parsed.points[0].value === null &&
      parsed.points[0].available_value === 2 &&
      parsed.points[0].missing_device_count === 1,
    "month/unknown/available subtotal kept independently",
  );
  check(
    parsed.historical === true &&
      parsed.current_state_saved === false &&
      parsed.source_updated_at === null,
    "historical flags and unknown source timestamp preserved",
  );
  let resolveStation;
  globalThis.fetch = () => new Promise((resolve) => (resolveStation = resolve));
  host.solarCatalog = {
    stations: [
      { station_code: "test-a", manufacturer: "fixture", name: "隔离电站" },
    ],
    available_dates: [],
    groups: [],
    latest_date: "2026-09-25",
  };
  host.solarPage("station", "solar:fixture:test-a");
  for (let i = 0; i < 10 && !resolveStation; i++) await tick();
  const selector = flatten(host.controls).find(
    (e) => e.getAttribute("aria-label") === "电站",
  );
  selector.value = "";
  click(host.controls, "查询");
  resolveStation(response({ ...solar, resource: "station", points: [] }));
  for (let i = 0; i < 10; i++) await tick();
  check(
    host.content.childElementCount === 0 &&
      host.status.textContent.includes("请选择一个电站"),
    "empty station invalidates pending result rather than restoring old station",
  );
  for (const url of [
    "http://evil/preview/1",
    "http://127.0.0.1:8765/preview/1?x=y",
    "http://127.0.0.1:8765/preview/../preview/1",
    "http://user@127.0.0.1:8765/preview/1",
  ])
    check(
      api.safeReportURL(url, "preview") === undefined,
      "unsafe report URL rejected",
    );
  check(
    api.safeReportURL("http://127.0.0.1:8765/preview/1", "preview") !==
      undefined,
    "exact report URL accepted",
  );
  const detail = {
    schema_version: "1.0",
    kind: "project",
    id: project.project_id,
    title: "隔离项目",
    section: "overview",
    sections: [{ id: "overview", label: "概览" }],
    rows: [],
    pagination: {
      offset: 0,
      limit: 6,
      total: 0,
      next_offset: null,
      has_more: false,
    },
    snapshot_revision: "snapshot",
    project,
  };
  let path;
  globalThis.fetch = async (p) => {
    path = p;
    return response(detail);
  };
  await api.getDetail("project", project.project_id, "overview");
  check(
    new URL(path, "http://test").searchParams.get("limit") === "6",
    "detail default is six rows",
  );
  check(
    api.parseDetail(detail, "project").project.note_redacted === false,
    "project note flag parsed",
  );
  await assert.rejects(
    api.saveProject({
      request_id: "bad",
      project_id: project.project_id,
      expected_revision: "r1",
      action: "pin",
      pinned: true,
    }),
  );
  checks++;
  host.destroy();
  console.log(
    JSON.stringify({
      widgetWorkbenchChecks: checks,
      passed: true,
      productionWrites: 0,
    }),
  );
}
try {
  await main();
} catch (error) {
  console.error({
    name: error.name,
    message: error.message,
    actual: error.actual,
    expected: error.expected,
  });
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  if (nativeDoc === undefined) delete globalThis.document;
  else globalThis.document = nativeDoc;
}
