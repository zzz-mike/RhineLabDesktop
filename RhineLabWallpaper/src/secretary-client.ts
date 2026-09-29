import { allowsService } from './release-access';
import { SharedReadPool } from "./shared-read-pool";
/** Fixed same-origin secretary API. Review capability is held in memory only. */
export const widgetIds = [
  "priorities",
  "projects",
  "today",
  "schedule",
  "solar.generation",
  "solar.trend",
  "solar.devices",
  "solar.alerts",
  "solar.revenue",
  "solar.total",
  "solar.stations",
  "todo",
  "triage",
] as const;
// Keep priorities parseable for old layouts/clients, but no longer offer the mixed card.
export const offeredWidgetIds = widgetIds.filter(id => id !== "priorities");
export type WidgetId = (typeof widgetIds)[number];
export type WidgetSize = "small" | "medium" | "large";
export type WidgetStatus =
  "ok" | "empty" | "partial" | "stale" | "disconnected" | "error" | "demo";
export const widgetTitles: Record<WidgetId, string> = {
  priorities: "先处理这些",
  todo: "要做",
  triage: "需要分类",
  projects: "项目进展",
  today: "今日事项",
  schedule: "重要日程",
  "solar.generation": "光伏 · 发电",
  "solar.trend": "光伏 · 趋势",
  "solar.devices": "光伏 · 设备",
  "solar.alerts": "光伏 · 告警",
  "solar.revenue": "光伏 · 收益",
  "solar.total": "光伏 · 全站总功率曲线",
  "solar.stations": "光伏 · 各站发电量",
};
export const statusLabels: Record<WidgetStatus, string> = {
  ok: "已接入",
  empty: "已核查为空",
  partial: "部分覆盖",
  stale: "旧数据",
  disconnected: "未连接",
  error: "读取失败",
  demo: "演示数据",
};
export interface Metric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
}
export interface Point {
  at: string | null;
  value: number | null;
  unit: string;
  series?: string;
  quality?: string;
  available_value?: number | null;
  missing_device_count?: number | null;
}
export interface SourceReference {
  source_id: string;
  record_id: string;
  revision?: number;
  batch_id?: string;
}
export interface DetailItem {
  id: string;
  title: string;
  status: string;
  updated_at?: string | null;
  source_url?: string | null;
  communication_status?: string;
  operating_status?: string;
  data_freshness?: string;
  power_kw?: number | null;
  severity?: string;
  raised_at?: string | null;
  triggered_at?: string | null;
  recovered_at?: string | null;
  last_seen_at?: string | null;
}
export interface SolarData {
  title?: string;
  summary?: string;
  note?: string;
  metrics: Metric[];
  points: Point[];
  items: DetailItem[];
  source_mode?: string;
  source_updated_at?: string | null;
  date?: string;
  data_complete?: boolean | null;
  daily_completeness?: number | null;
  gap_count?: number | null;
  alert_capability?: string;
  coverage_status?: string;
  collection_observed_at?: string | null;
}
export interface WidgetItem {
  id: string;
  project_id: string | null;
  project_name?: string;
  title: string;
  summary: string;
  status: string;
  group?: string;
  occurred_at?: string | null;
  updated_at?: string | null;
  due_at?: string | null;
  all_day?: boolean;
  source_url: string | null;
  source_refs: (string | SourceReference)[];
  revision?: number;
  evidence_status?: string;
  phase?: string;
  focus?: string;
  context?: string;
  next_action?: string;
  blocker?: string;
  secondary?: string;
  evidence_at?: string | null;
  caution?: string;
  focus_needs_review?: boolean;
  pinned?: boolean;
  facts?: { label: string; value: string }[];
  highlight?: { label: string; value: string; note: string } | null;
  coverage?: Record<string, string | number | boolean | null>;
  data?: SolarData;
  review_revision?: string;
  manual_status?: string | null;
  manual_project?: string | null;
  manual_project_is_set?: boolean;
  human_reviewed?: boolean;
  classification_authority?: string;
  project_source?: string;
  can_undo?: { status: boolean; project: boolean };
}
export interface WidgetResponse {
  schema_version: "1.0";
  widget_id: WidgetId;
  title: string;
  status: WidgetStatus;
  generated_at: string;
  data_updated_at: string | null;
  timezone: "Asia/Shanghai";
  message: string;
  items: WidgetItem[];
  metrics: Metric[];
  points: Point[];
  total: number;
  truncated: boolean;
  source: {
    id: string;
    label: string;
    sync?: {
      status?: string;
      last_attempt_at?: string | null;
      last_success_at?: string | null;
      status_persisted?: boolean;
    };
  };
  coverage?: { scope?: string };
  snapshot_revision?: string;
  pagination?: {
    offset: number;
    limit: number;
    total: number;
    next_offset: number | null;
    has_more: boolean;
  };
}
export interface WidgetCatalog {
  schema_version: "1.0";
  timezone: "Asia/Shanghai";
  widgets: {
    id: WidgetId;
    title: string;
    sizes: WidgetSize[];
    default_size: WidgetSize;
    refresh_seconds: number;
  }[];
  projects: { id: string; name: string; source_id: string }[];
}
export interface WidgetOptions {
  project_id?: string;
  limit?: number;
  offset?: number;
  snapshot_revision?: string;
  signal?: AbortSignal;
}
export type ReviewStatus = "active" | "completed" | "cancelled" | "observing";
export type ReviewRequest = {
  request_id: string;
  item_id: string;
  expected_revision: string;
} & (
  | { action: "status"; status: ReviewStatus }
  | { action: "project"; project: string }
  | { action: "undo"; field: "status" | "project" }
);
export interface RevisionResponse {
  schema_version: "1.0";
  revision: string;
  poll_seconds: number;
}
export interface ReviewItemResponse {
  schema_version: "1.0";
  item: WidgetItem;
  revision: string;
}
export interface ReviewResponse extends ReviewItemResponse {
  ok: true;
  duplicate: boolean;
}
export class WidgetAPIError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly currentItem?: WidgetItem,
    public readonly currentProject?: unknown,
  ) {
    super(message);
    this.name = "WidgetAPIError";
  }
}
const statuses = Object.keys(statusLabels);
const sizes = ["small", "medium", "large"];
const bad = () =>
  new Error("秘书返回的数据格式不兼容，保留上次结果并等待重试。");
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad();
  return v as Record<string, unknown>;
}
function string(v: unknown, max = 16000): string {
  if (typeof v !== "string" || v.length > max) throw bad();
  return v;
}
function array(v: unknown, max = 10000): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw bad();
  return v;
}
function number(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw bad();
  return v;
}
function integer(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw bad();
  return v;
}
function boolean(v: unknown): boolean {
  if (typeof v !== "boolean") throw bad();
  return v;
}
export function isWidgetId(v: unknown): v is WidgetId {
  return typeof v === "string" && widgetIds.includes(v as WidgetId);
}
function dateOnly(v: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v
  );
}
function date(v: unknown, allowDay = false): string | null {
  if (v === null) return null;
  const s = string(v, 80);
  if (allowDay && dateOnly(s)) return s;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      s,
    ) ||
    !dateOnly(s.slice(0, 10)) ||
    Number(s.slice(11, 13)) > 23 ||
    !Number.isFinite(Date.parse(s))
  )
    throw bad();
  return s;
}
/** Source links are navigation only; never passed back as a proxy target. */
export function safeDetailUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 2000 ||
    /[\s\\\u0000-\u001f\u007f]/.test(value) ||
    !/^http:\/\/(?:127\.0\.0\.1|localhost):(?:8866|8765)(?:\/|$)/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
    // Check the unnormalised path too: URL() would silently normalise /x/../.
    const rawPath =
      value
        .slice(value.indexOf("://") + 3)
        .replace(/^[^/]+/, "")
        .split("?")[0] || "/";
    const allowed = url.port === "8866" ? ["/"] : ["/", "/station"];
    if (!allowed.includes(rawPath) || !allowed.includes(url.pathname))
      return null;
    const keys = url.port === "8866" ? ["item", "project"] : ["code"];
    for (const key of url.searchParams.keys())
      if (!keys.includes(key) || url.searchParams.getAll(key).length !== 1)
        return null;
    for (const val of url.searchParams.values())
      if (/[\u0000-\u001f\u007f]/.test(val)) return null;
    return url.href;
  } catch {
    return null;
  }
}
export function formatSourceDate(
  value: string | null | undefined,
  allDay = false,
): string {
  if (!value) return "时间未知";
  if (dateOnly(value))
    return `${value.replaceAll("-", "/")}${allDay ? " · 全天" : " · 日期级"}`;
  try {
    date(value);
    return (
      new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        ...(allDay
          ? {}
          : { hour: "2-digit", minute: "2-digit", hour12: false }),
      }).format(new Date(value)) + (allDay ? " · 全天" : "")
    );
  } catch {
    return "时间未知";
  }
}
export function formatMetric(
  value: number | null | undefined,
  unit = "",
): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value)}${unit ? ` ${unit}` : ""}`
    : `未知${unit ? ` ${unit}` : ""}`;
}
function metric(v: unknown): Metric {
  const o = object(v);
  return {
    key: string(o.key, 200),
    label: string(o.label, 500),
    value: number(o.value),
    unit: string(o.unit, 80),
  };
}
function point(v: unknown): Point {
  const o = object(v),
    p: Point = {
      at: date(o.at, true),
      value: number(o.value),
      unit: string(o.unit, 80),
    };
  for (const key of ["series", "quality"] as const)
    if (o[key] !== undefined) p[key] = string(o[key], 200);
  for (const key of ["available_value", "missing_device_count"] as const)
    if (o[key] !== undefined) p[key] = number(o[key]);
  return p;
}
function detail(v: unknown): DetailItem {
  const o = object(v),
    item: DetailItem = {
      id: string(o.id, 1000),
      title: string(o.title),
      status: string(o.status, 300),
    };
  for (const key of [
    "communication_status",
    "operating_status",
    "data_freshness",
    "severity",
  ] as const)
    if (o[key] !== undefined) item[key] = string(o[key], 500);
  for (const key of [
    "updated_at",
    "raised_at",
    "triggered_at",
    "recovered_at",
    "last_seen_at",
  ] as const)
    if (o[key] !== undefined) item[key] = date(o[key]);
  if (o.power_kw !== undefined) item.power_kw = number(o.power_kw);
  if (o.source_url !== undefined) item.source_url = safeDetailUrl(o.source_url);
  return item;
}
function solar(v: unknown): SolarData {
  const o = object(v),
    data: SolarData = {
      metrics: array(o.metrics ?? [], 200).map(metric),
      points: array(o.points ?? []).map(point),
      items: array(o.items ?? [], 5000).map(detail),
    };
  for (const key of [
    "title",
    "summary",
    "note",
    "source_mode",
    "alert_capability",
    "coverage_status",
  ] as const)
    if (o[key] !== undefined) data[key] = string(o[key]);
  for (const key of ["source_updated_at", "collection_observed_at"] as const)
    if (o[key] !== undefined) data[key] = date(o[key]);
  if (o.date !== undefined) {
    const d = string(o.date, 10);
    if (!dateOnly(d)) throw bad();
    data.date = d;
  }
  if (o.data_complete !== undefined)
    data.data_complete =
      o.data_complete === null ? null : boolean(o.data_complete);
  for (const key of ["daily_completeness", "gap_count"] as const)
    if (o[key] !== undefined) data[key] = number(o[key]);
  return data;
}
function item(v: unknown): WidgetItem {
  const o = object(v),
    result: WidgetItem = {
      id: string(o.id, 1000),
      project_id: o.project_id === null ? null : string(o.project_id, 240),
      title: string(o.title),
      summary: string(o.summary),
      status: string(o.status, 300),
      source_url: safeDetailUrl(o.source_url),
      source_refs: array(o.source_refs, 1000).map((v) => {
        if (typeof v === "string") return string(v, 1000);
        const r = object(v),
          ref: SourceReference = {
            source_id: string(r.source_id, 200),
            record_id: string(r.record_id, 1000),
          };
        if (r.revision !== undefined) ref.revision = integer(r.revision);
        if (r.batch_id !== undefined) ref.batch_id = string(r.batch_id, 1000);
        return ref;
      }),
    };
  for (const key of [
    "project_name",
    "group",
    "evidence_status",
    "phase",
    "focus",
    "context",
    "next_action",
    "blocker",
    "secondary",
    "caution",
  ] as const)
    if (o[key] !== undefined && o[key] !== null) result[key] = string(o[key]);
  for (const key of ["occurred_at", "updated_at"] as const)
    if (o[key] !== undefined) result[key] = date(o[key]);
  if (o.evidence_at !== undefined)
    result.evidence_at = date(o.evidence_at, true);
  if (o.due_at !== undefined) result.due_at = date(o.due_at, true);
  if (o.revision !== undefined && o.revision !== null)
    result.revision = integer(o.revision);
  for (const key of ["all_day", "focus_needs_review", "pinned"] as const)
    if (o[key] !== undefined) result[key] = boolean(o[key]);
  if (o.facts !== undefined)
    result.facts = array(o.facts, 100).map((v) => {
      const f = object(v);
      return { label: string(f.label), value: string(f.value) };
    });
  if (o.highlight !== undefined) {
    const h = o.highlight === null ? null : object(o.highlight);
    result.highlight = h
      ? { label: string(h.label), value: string(h.value), note: string(h.note) }
      : null;
  }
  if (o.coverage !== undefined) {
    const c = object(o.coverage);
    result.coverage = {};
    for (const key of [
      "scope",
      "retained_versions",
      "body_read",
      "partial_read",
      "without_reading_record",
      "linked_messages",
      "unlinked_attachment_messages",
      "pending_project_review",
      "latest_received_at",
      "has_project_review",
    ]) {
      const val = c[key];
      if (
        val === null ||
        typeof val === "boolean" ||
        typeof val === "string" ||
        (typeof val === "number" && Number.isFinite(val))
      )
        result.coverage[key] = typeof val === "string" ? string(val) : val;
    }
  }
  if (o.review_revision !== undefined)
    result.review_revision = string(o.review_revision, 128);
  for (const key of ["manual_status", "manual_project"] as const)
    if (o[key] !== undefined)
      result[key] = o[key] === null ? null : string(o[key], 100);
  for (const key of ["manual_project_is_set", "human_reviewed"] as const)
    if (o[key] !== undefined) result[key] = boolean(o[key]);
  for (const key of ["classification_authority", "project_source"] as const)
    if (o[key] !== undefined) result[key] = string(o[key], 300);
  if (o.can_undo !== undefined) {
    const undo = object(o.can_undo);
    result.can_undo = {
      status: boolean(undo.status),
      project: boolean(undo.project),
    };
  }
  if (o.data !== undefined) result.data = solar(o.data);
  return result;
}
export function parseWidget(
  value: unknown,
  expected: WidgetId,
): WidgetResponse {
  const o = object(value);
  if (
    o.schema_version !== "1.0" ||
    o.widget_id !== expected ||
    o.timezone !== "Asia/Shanghai" ||
    !statuses.includes(String(o.status))
  )
    throw bad();
  const source = object(o.source),
    generated = date(o.generated_at);
  if (!generated) throw bad();
  const result: WidgetResponse = {
    schema_version: "1.0",
    widget_id: expected,
    title: string(o.title),
    status: o.status as WidgetStatus,
    generated_at: generated,
    data_updated_at: date(o.data_updated_at),
    timezone: "Asia/Shanghai",
    message: string(o.message),
    items: array(o.items, 100).map(item),
    metrics: array(o.metrics, 20000).map(metric),
    points: array(o.points, 20000).map(point),
    total: integer(o.total),
    truncated: boolean(o.truncated),
    source: { id: string(source.id, 200), label: string(source.label, 500) },
  };
  if (o.snapshot_revision !== undefined)
    result.snapshot_revision = string(o.snapshot_revision, 128);
  if (o.pagination !== undefined) {
    const page = object(o.pagination);
    const pagination = {
      offset: integer(page.offset),
      limit: integer(page.limit),
      total: integer(page.total),
      next_offset: page.next_offset === null ? null : integer(page.next_offset),
      has_more: boolean(page.has_more),
    };
    if (
      pagination.offset > 1000000 ||
      pagination.limit < 1 ||
      pagination.limit > 100 ||
      pagination.total !== result.total ||
      result.items.length > pagination.limit ||
      pagination.has_more !== (pagination.next_offset !== null) ||
      (pagination.next_offset !== null &&
        (pagination.next_offset <= pagination.offset ||
          pagination.next_offset >= pagination.total))
    )
      throw bad();
    result.pagination = pagination;
  }
  if (
    result.total < result.items.length ||
    result.truncated !== result.total > result.items.length
  )
    throw bad();
  if (o.coverage !== undefined) {
    const c = object(o.coverage);
    result.coverage = {
      scope: c.scope === undefined ? undefined : string(c.scope),
    };
  }
  if (source.sync !== undefined) {
    const s = object(source.sync);
    result.source.sync = {};
    if (s.status !== undefined)
      result.source.sync.status = string(s.status, 200);
    for (const key of ["last_attempt_at", "last_success_at"] as const)
      if (s[key] !== undefined) result.source.sync[key] = date(s[key]);
    if (s.status_persisted !== undefined)
      result.source.sync.status_persisted = boolean(s.status_persisted);
  }
  return result;
}
export function parseCatalog(value: unknown): WidgetCatalog {
  const o = object(value);
  if (o.schema_version !== "1.0" || o.timezone !== "Asia/Shanghai") throw bad();
  const seen = new Set<string>();
  const widgets = array(o.widgets, widgetIds.length).map((v) => {
    const w = object(v);
    if (!isWidgetId(w.id) || seen.has(w.id)) throw bad();
    seen.add(w.id);
    const available = array(w.sizes, 3).map((v) => {
      if (!sizes.includes(String(v))) throw bad();
      return v as WidgetSize;
    });
    if (!available.includes(w.default_size as WidgetSize)) throw bad();
    return {
      id: w.id,
      title: string(w.title, 500),
      sizes: available,
      default_size: w.default_size as WidgetSize,
      refresh_seconds: Math.max(60, integer(w.refresh_seconds)),
    };
  });
  if (!widgetIds.slice(0, 9).every(id => seen.has(id))) throw bad();
  return {
    schema_version: "1.0",
    timezone: "Asia/Shanghai",
    widgets,
    projects: array(o.projects, 5000).map((v) => {
      const p = object(v);
      return {
        id: string(p.id, 240),
        name: string(p.name, 1000),
        source_id: string(p.source_id, 200),
      };
    }),
  };
}
async function readJSONTransport(
  path: string,
  signal?: AbortSignal,
  write?: { body: string; token: string },
): Promise<unknown> {
  if (!allowsService(path)) throw new Error('此连接尚未开启，请在“本地连接”中授权。');
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 12000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(path, {
      method: write ? "POST" : "GET",
      headers: {
        "X-Rhine-Local": "1",
        Accept: "application/json",
        ...(write
          ? {
              "Content-Type": "application/json",
              "X-Rhine-Action-Token": write.token,
            }
          : {}),
      },
      ...(write ? { body: write.body } : {}),
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    if (
      !response.headers
        .get("content-type")
        ?.toLowerCase()
        .includes("application/json")
    ) {
      if (!response.ok)
        throw new WidgetAPIError(
          `秘书连接失败（HTTP ${response.status}）。`,
          response.status,
          "http_error",
        );
      throw bad();
    }
    const maximum = 1024 * 1024;
    if (Number(response.headers.get("content-length")) > maximum) {
      await response.body?.cancel();
      throw new Error("秘书响应过大，请缩小条数或项目范围。");
    }
    if (!response.body) throw bad();
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maximum) {
          await reader.cancel();
          throw new Error("秘书响应过大，请缩小条数或项目范围。");
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const part of chunks) {
      body.set(part, offset);
      offset += part.byteLength;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw bad();
    }
    if (!response.ok) {
      const failure = object(parsed);
      let currentItem: WidgetItem | undefined;
      if (failure.current_item !== undefined) {
        try {
          currentItem = item(failure.current_item);
        } catch {
          /* keep the original HTTP error even if its optional item is malformed */
        }
      }
      throw new WidgetAPIError(
        typeof failure.error === "string"
          ? string(failure.error, 2000)
          : `秘书连接失败（HTTP ${response.status}）。`,
        response.status,
        typeof failure.code === "string"
          ? string(failure.code, 100)
          : "http_error",
        currentItem,
        failure.current_project,
      );
    }
    return parsed;
  } catch (error) {
    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
    if (controller.signal.aborted)
      throw new Error(
        write
          ? "保存请求超时，结果尚未确认；请使用同一请求重试。"
          : "秘书读取超时，尚未取得新数据。",
      );
    if (error instanceof TypeError)
      throw new Error(
        write
          ? "保存连接中断，结果尚未确认；请使用同一请求重试。"
          : "秘书暂未连接，请检查本机桥和秘书服务。",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
const sharedReads = new SharedReadPool<unknown>((path, signal) =>
  readJSONTransport(path, signal),
);
function readJSON(
  path: string,
  signal?: AbortSignal,
  write?: { body: string; token: string },
): Promise<unknown> {
  if (!write) return sharedReads.get(path, signal);
  // A read started before a mutation cannot satisfy a subsequent revalidation.
  sharedReads.invalidate();
  return readJSONTransport(path, signal, write).finally(() =>
    sharedReads.invalidate(),
  );
}
export async function getCatalog(
  options: { signal?: AbortSignal } = {},
): Promise<WidgetCatalog> {
  return parseCatalog(
    await readJSON("/api/secretary/widgets/v1/catalog", options.signal),
  );
}
export async function getWidget(
  id: WidgetId,
  options: WidgetOptions = {},
): Promise<WidgetResponse> {
  if (!isWidgetId(id)) throw new Error("未知信息主题。");
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("条数必须为 1 至 100。");
  const query = new URLSearchParams({ limit: String(limit) });
  if (options.offset !== undefined) {
    if (
      !Number.isSafeInteger(options.offset) ||
      options.offset < 0 ||
      options.offset > 1000000
    )
      throw new Error("分页位置无效。");
    query.set("offset", String(options.offset));
  }
  if (options.snapshot_revision !== undefined)
    query.set("snapshot_revision", identifier(options.snapshot_revision, 128));
  if (options.project_id !== undefined) {
    if (
      typeof options.project_id !== "string" ||
      !options.project_id.trim() ||
      options.project_id.length > 240 ||
      /[\u0000-\u001f\u007f]/.test(options.project_id)
    )
      throw new Error("项目标识无效。");
    query.set("project_id", options.project_id);
  }
  return parseWidget(
    await readJSON(`/api/secretary/widgets/v1/${id}?${query}`, options.signal),
    id,
  );
}

function identifier(value: unknown, max: number): string {
  const text = string(value, max);
  if (!text || /[\u0000-\u001f\u007f]/.test(text))
    throw new Error("请求标识无效。");
  return text;
}
function parseReviewItem(value: unknown): ReviewItemResponse {
  const o = object(value);
  if (o.schema_version !== "1.0") throw bad();
  return {
    schema_version: "1.0",
    item: item(o.item),
    revision: identifier(o.revision, 128),
  };
}
export async function getRevision(
  options: { signal?: AbortSignal } = {},
): Promise<RevisionResponse> {
  const o = object(
    await readJSON("/api/secretary/widgets/v1/revision", options.signal),
  );
  if (o.schema_version !== "1.0" || o.poll_seconds !== 2) throw bad();
  return {
    schema_version: "1.0",
    revision: identifier(o.revision, 128),
    poll_seconds: 2,
  };
}
export async function getReviewItem(
  id: string,
  options: { signal?: AbortSignal } = {},
): Promise<ReviewItemResponse> {
  const query = new URLSearchParams({ item_id: identifier(id, 1000) });
  return parseReviewItem(
    await readJSON(`/api/secretary/widgets/v1/item?${query}`, options.signal),
  );
}
let reviewToken: string | undefined;
let tokenRequest: Promise<string> | undefined;
async function getReviewToken(): Promise<string> {
  if (reviewToken) return reviewToken;
  if (!tokenRequest)
    tokenRequest = (async () => {
      const capability = object(await readJSON("/api/local/v1/capabilities"));
      if (capability.secretary_review !== true)
        throw new WidgetAPIError(
          "本机秘书尚未开放人工分类。",
          403,
          "review_unavailable",
        );
      return (reviewToken = identifier(capability.secretary_review_token, 512));
    })().finally(() => {
      tokenRequest = undefined;
    });
  return tokenRequest;
}
/** The caller owns request_id: retry an uncertain outcome with the exact same request. */
export async function submitReview(
  request: ReviewRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ReviewResponse> {
  const base = {
    request_id: identifier(request.request_id, 128),
    item_id: identifier(request.item_id, 1000),
    expected_revision: identifier(request.expected_revision, 128),
  };
  let body: string;
  if (
    request.action === "status" &&
    ["active", "completed", "cancelled", "observing"].includes(request.status)
  )
    body = JSON.stringify({
      ...base,
      action: request.action,
      status: request.status,
    });
  else if (request.action === "project")
    body = JSON.stringify({
      ...base,
      action: request.action,
      project: string(request.project, 100),
    });
  else if (
    request.action === "undo" &&
    ["status", "project"].includes(request.field)
  )
    body = JSON.stringify({
      ...base,
      action: request.action,
      field: request.field,
    });
  else throw new Error("未知人工分类操作。");
  if (new TextEncoder().encode(body).byteLength > 4096)
    throw new Error("人工分类请求过大。");
  if (options.signal?.aborted) throw new DOMException("已取消", "AbortError");
  const token = await getReviewToken();
  try {
    const raw = object(
      await readJSON("/api/secretary/widgets/v1/review", options.signal, {
        body,
        token,
      }),
    );
    if (raw.ok !== true) throw bad();
    return {
      ...parseReviewItem(raw),
      ok: true,
      duplicate: boolean(raw.duplicate),
    };
  } catch (error) {
    // A restarted bridge may rotate the token. Do not retry business writes here;
    // the UI keeps the original request_id and body for an explicit retry.
    if (
      error instanceof WidgetAPIError &&
      error.status === 403 &&
      reviewToken === token
    )
      reviewToken = undefined;
    throw error;
  }
}

// Fixed V3 routes only. The independent UI parsers validate every response.
const workbenchResources = [
  "items",
  "item-detail",
  "project-detail",
  "solar/catalog",
  "solar/overview",
  "solar/station",
  "solar/period",
  "solar/devices",
  "solar/alerts",
  "solar/reports",
  "solar/health",
] as const;
export type WorkbenchResource = (typeof workbenchResources)[number];
export function readWorkbenchJSON(
  resource: WorkbenchResource,
  query: URLSearchParams,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!workbenchResources.includes(resource)) throw new Error("未知工作台接口");
  const path = resource.startsWith("solar/")
    ? `/api/solar/v1/${resource.slice(6)}`
    : `/api/secretary/widgets/v1/${resource}`;
  return readJSON(path + (query.size ? `?${query}` : ""), signal);
}
export const parseWidgetItem = item;
export async function writeProjectReviewJSON(
  body: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (new TextEncoder().encode(body).byteLength > 16384)
    throw new Error("项目编辑请求过大");
  if (signal?.aborted) throw new DOMException("已取消", "AbortError");
  const token = await getReviewToken();
  try {
    return await readJSON("/api/secretary/widgets/v1/project-review", signal, {
      body,
      token,
    });
  } catch (error) {
    if (
      error instanceof WidgetAPIError &&
      error.status === 403 &&
      reviewToken === token
    )
      reviewToken = undefined;
    throw error;
  }
}
