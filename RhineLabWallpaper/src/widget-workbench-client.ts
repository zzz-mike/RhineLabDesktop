import {
  readWorkbenchJSON,
  writeProjectReviewJSON,
  parseWidget,
  parseWidgetItem,
  type WidgetItem,
  type Metric,
  type Point,
  type WidgetResponse,
  type WorkbenchResource,
} from "./secretary-client";
export interface Page {
  offset: number;
  limit: number;
  total: number;
  next_offset: number | null;
  has_more: boolean;
}
export interface DetailRow {
  id: string;
  title: string;
  body: string;
  fields: { label: string; value: string }[];
  item?: WidgetItem;
  preview_url?: string;
  download_url?: string;
}
export interface ProjectState {
  project_id: string;
  project_name: string;
  review_revision: string;
  note: { stage: string; blocker: string; next_step: string; owner: string };
  pinned: boolean;
  note_redacted: boolean;
}
export interface DetailResponse {
  schema_version: "1.0";
  kind: "item" | "project";
  id: string;
  title: string;
  section: string;
  sections: { id: string; label: string }[];
  rows: DetailRow[];
  pagination: Page;
  snapshot_revision: string;
  item?: WidgetItem;
  project?: ProjectState;
}
export interface SolarResponse {
  schema_version: "1.0";
  resource: string;
  title: string;
  status: string;
  source_mode: string;
  fetched_at: string;
  source_updated_at: string | null;
  message: string;
  rows: DetailRow[];
  metrics: Metric[];
  points: Point[];
  pagination?: Page;
  stations?: { station_code: string; name: string; manufacturer: string }[];
  groups?: { id: string; name: string; member_count: number }[];
  available_dates?: string[];
  latest_date?: string | null;
  capabilities?: Record<string, boolean | null>;
  historical?: boolean | null;
  current_state_saved?: boolean | null;
  data_complete?: boolean | null;
  coverage_status?: string | null;
}
export type ProjectReview = {
  request_id: string;
  project_id: string;
  expected_revision: string;
} & (
  | { action: "note"; note: ProjectState["note"] }
  | { action: "pin"; pinned: boolean }
);
const fail = () => new Error("工作台返回格式不兼容，请保留当前内容后重试。");
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw fail();
  return v as Record<string, unknown>;
};
const str = (v: unknown, max = 50000): string => {
  if (typeof v !== "string" || v.length > max) throw fail();
  return v;
};
const arr = (v: unknown, max = 10000): unknown[] => {
  if (!Array.isArray(v) || v.length > max) throw fail();
  return v;
};
const num = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw fail();
  return v;
};
const int = (v: unknown): number => {
  const n = num(v);
  if (!Number.isSafeInteger(n) || n < 0) throw fail();
  return n;
};
const bool = (v: unknown): boolean => {
  if (typeof v !== "boolean") throw fail();
  return v;
};
function page(v: unknown, max: number): Page {
  const o = obj(v),
    p = {
      offset: int(o.offset),
      limit: int(o.limit),
      total: int(o.total),
      next_offset: o.next_offset === null ? null : int(o.next_offset),
      has_more: bool(o.has_more),
    };
  if (
    p.offset > 1000000 ||
    p.limit < 1 ||
    p.limit > max ||
    p.has_more !== (p.next_offset !== null) ||
    (p.next_offset !== null &&
      (p.next_offset <= p.offset || p.next_offset >= p.total))
  )
    throw fail();
  return p;
}
export function safeReportURL(
  value: unknown,
  kind: "preview" | "download",
): string | undefined {
  if (typeof value !== "string") return;
  try {
    const u = new URL(value);
    if (
      u.origin === "http://127.0.0.1:8765" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      new RegExp(`^/${kind}/[1-9][0-9]*$`).test(u.pathname) &&
      value === u.href
    )
      return u.href;
  } catch {}
  return;
}
function row(value: unknown): DetailRow {
  const r = obj(value);
  const result: DetailRow = {
    id: str(r.id, 1000),
    title: str(r.title, 4000),
    body: str(r.body, 128000),
    fields: arr(r.fields, 1000).map((f) => {
      const p = obj(f);
      return { label: str(p.label, 1000), value: str(p.value, 128000) };
    }),
  };
  if (r.item !== undefined) result.item = parseWidgetItem(r.item);
  result.preview_url = safeReportURL(r.preview_url, "preview");
  result.download_url = safeReportURL(r.download_url, "download");
  return result;
}
export function parseProjectState(value: unknown): ProjectState {
  const p = obj(value),
    n = obj(p.note);
  return {
    project_id: str(p.project_id, 1000),
    project_name: str(p.project_name, 2000),
    review_revision: str(p.review_revision, 128),
    note: {
      stage: str(n.stage, 2000),
      blocker: str(n.blocker, 2000),
      next_step: str(n.next_step, 2000),
      owner: str(n.owner, 2000),
    },
    pinned: bool(p.pinned),
    note_redacted:
      p.note_redacted === undefined ? false : bool(p.note_redacted),
  };
}
export const itemSections = ["overview", "evidence", "history"] as const;
export const projectSections = [
  "overview",
  "progress",
  "items",
  "conversation",
  "files",
  "finance",
] as const;
export function parseDetail(
  value: unknown,
  kind: "item" | "project",
): DetailResponse {
  const o = obj(value);
  if (o.schema_version !== "1.0" || o.kind !== kind) throw fail();
  const allowed: readonly string[] =
    kind === "item" ? itemSections : projectSections;
  const sections = arr(o.sections, 20).map((v) => {
    const x = obj(v),
      id = str(x.id, 100);
    if (!allowed.includes(id)) throw fail();
    return { id, label: str(x.label, 200) };
  });
  const section = str(o.section, 100);
  if (!allowed.includes(section)) throw fail();
  const rows = arr(o.rows, 30).map(row),
    pagination = page(o.pagination, 30);
  if (rows.length > pagination.limit) throw fail();
  return {
    schema_version: "1.0",
    kind,
    id: str(o.id, 1000),
    title: str(o.title, 4000),
    section,
    sections,
    rows,
    pagination,
    snapshot_revision: str(o.snapshot_revision, 128),
    ...(o.item !== undefined ? { item: parseWidgetItem(o.item) } : {}),
    ...(o.project !== undefined
      ? { project: parseProjectState(o.project) }
      : {}),
  };
}
export async function getDetail(
  kind: "item" | "project",
  id: string,
  section: string,
  offset = 0,
  snapshot?: string,
  signal?: AbortSignal,
): Promise<DetailResponse> {
  const allowed: readonly string[] =
    kind === "item" ? itemSections : projectSections;
  if (!allowed.includes(section)) throw fail();
  const q = new URLSearchParams({
    [kind + "_id"]: str(id, 1000),
    section,
    limit: "6",
    offset: String(int(offset)),
  });
  if (snapshot) q.set("snapshot_revision", str(snapshot, 128));
  return parseDetail(
    await readWorkbenchJSON(
      kind === "item" ? "item-detail" : "project-detail",
      q,
      signal,
    ),
    kind,
  );
}
export async function searchItems(options: {
  query?: string;
  status?: string;
  project_id?: string;
  offset?: number;
  snapshot?: string;
  signal?: AbortSignal;
}): Promise<WidgetResponse> {
  const status = options.status ?? "all";
  if (
    ![
      "all",
      "active",
      "waiting",
      "observing",
      "completed",
      "cancelled",
    ].includes(status)
  )
    throw fail();
  const q = new URLSearchParams({
    query: str(options.query ?? "", 120),
    status,
    limit: "6",
    offset: String(int(options.offset ?? 0)),
  });
  if (options.project_id) q.set("project_id", str(options.project_id, 1000));
  if (options.snapshot) q.set("snapshot_revision", str(options.snapshot, 128));
  return parseWidget(
    await readWorkbenchJSON("items", q, options.signal),
    "priorities",
  );
}
export async function saveProject(
  request: ProjectReview,
  signal?: AbortSignal,
): Promise<{ project: ProjectState; duplicate: boolean; revision: string }> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      request.request_id,
    )
  )
    throw fail();
  const base = {
    request_id: request.request_id,
    project_id: str(request.project_id, 1000),
    expected_revision: str(request.expected_revision, 128),
  };
  const payload =
    request.action === "pin"
      ? { ...base, action: "pin", pinned: bool(request.pinned) }
      : request.action === "note"
        ? {
            ...base,
            action: "note",
            note: Object.fromEntries(
              ["stage", "blocker", "next_step", "owner"].map((k) => [
                k,
                str(request.note[k as keyof ProjectState["note"]], 2000),
              ]),
            ),
          }
        : null;
  if (!payload) throw fail();
  const o = obj(await writeProjectReviewJSON(JSON.stringify(payload), signal));
  if (o.schema_version !== "1.0" || o.ok !== true) throw fail();
  return {
    project: parseProjectState(o.project),
    duplicate: bool(o.duplicate),
    revision: str(o.revision, 128),
  };
}
const solarResources = [
  "catalog",
  "overview",
  "station",
  "period",
  "devices",
  "alerts",
  "reports",
  "health",
] as const;
export type SolarResource = (typeof solarResources)[number];
export function parseSolar(
  value: unknown,
  expected: SolarResource,
): SolarResponse {
  const o = obj(value);
  if (o.schema_version !== "1.0" || o.resource !== expected) throw fail();
  const result: SolarResponse = {
    schema_version: "1.0",
    resource: expected,
    title: str(o.title, 4000),
    status: str(o.status, 100),
    source_mode: str(o.source_mode, 100),
    fetched_at: str(o.fetched_at, 100),
    source_updated_at:
      o.source_updated_at === null ? null : str(o.source_updated_at, 100),
    message: str(o.message, 16000),
    rows: arr(o.rows, 10000).map(row),
    metrics: arr(o.metrics, 200).map((v) => {
      const m = obj(v);
      return {
        key: str(m.key, 200),
        label: str(m.label, 1000),
        value: m.value === null ? null : num(m.value),
        unit: str(m.unit, 100),
      };
    }),
    points: arr(o.points, 20000).map((v) => {
      const p = obj(v),
        at = p.at === null ? null : str(p.at, 100);
      if (at && !/^\d{4}-\d{2}(?:-\d{2}(?:T.*)?)?$/.test(at)) throw fail();
      return {
        at,
        value: p.value === null ? null : num(p.value),
        unit: str(p.unit, 100),
        ...(p.series !== undefined ? { series: str(p.series, 200) } : {}),
        ...(p.quality !== undefined ? { quality: str(p.quality, 100) } : {}),
        ...(p.available_value !== undefined
          ? {
              available_value:
                p.available_value === null ? null : num(p.available_value),
            }
          : {}),
        ...(p.missing_device_count !== undefined
          ? {
              missing_device_count:
                p.missing_device_count === null
                  ? null
                  : int(p.missing_device_count),
            }
          : {}),
      };
    }),
  };
  if (o.pagination !== undefined) result.pagination = page(o.pagination, 50);
  for (const key of [
    "historical",
    "current_state_saved",
    "data_complete",
  ] as const)
    if (o[key] !== undefined)
      result[key] = o[key] === null ? null : bool(o[key]);
  if (o.coverage_status !== undefined)
    result.coverage_status =
      o.coverage_status === null ? null : str(o.coverage_status, 100);
  if (o.capabilities !== undefined) {
    const flags = obj(o.capabilities);
    result.capabilities = Object.fromEntries(
      Object.entries(flags).map(([key, value]) => [
        str(key, 100),
        value === null ? null : bool(value),
      ]),
    );
  }
  if (expected === "catalog") {
    result.stations = arr(o.stations, 10000).map((v) => {
      const s = obj(v);
      return {
        station_code: str(s.station_code, 1000),
        name: str(s.name, 2000),
        manufacturer: str(s.manufacturer, 200),
      };
    });
    result.groups = arr(o.groups, 10000).map((v) => {
      const g = obj(v);
      return {
        id: str(g.id, 100),
        name: str(g.name, 2000),
        member_count: int(g.member_count),
      };
    });
    result.available_dates = arr(o.available_dates, 10000).map((v) =>
      str(v, 10),
    );
    result.latest_date = o.latest_date == null ? null : str(o.latest_date, 10);
  }
  return result;
}
const allowedSolarParams: Record<SolarResource, string[]> = {
  catalog: [],
  overview: ["date", "group"],
  station: ["station_code", "date"],
  period: ["period_type", "period", "station_code", "group"],
  devices: ["station_code", "type", "status", "group", "limit", "offset"],
  alerts: ["station_code", "status", "severity", "group", "limit", "offset"],
  reports: ["group", "limit", "offset"],
  health: [],
};
export async function getSolar(
  resource: SolarResource,
  parameters: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<SolarResponse> {
  if (!solarResources.includes(resource)) throw fail();
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (!allowedSolarParams[resource].includes(key)) throw fail();
    if (value) q.set(key, str(value, 1000));
  }
  return parseSolar(
    await readWorkbenchJSON(
      `solar/${resource}` as WorkbenchResource,
      q,
      signal,
    ),
    resource,
  );
}
