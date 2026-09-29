import {
  getCatalog,
  getWidget,
  isWidgetId,
  safeDetailUrl,
  formatMetric,
  formatSourceDate,
  offeredWidgetIds,
  widgetTitles,
  statusLabels,
  type WidgetCatalog,
  type WidgetId,
  type WidgetItem,
  type WidgetResponse,
  type WidgetSize,
  type WidgetStatus,
  type Metric,
  type Point,
} from "./secretary-client";
import "./information-widgets.css";
import {
  getRevision,
  getReviewItem,
  submitReview,
  WidgetAPIError,
  type ReviewRequest,
} from "./secretary-client";
import { capacity, SwipePager } from "./widget-layout";
import { renderWidgetChart } from "./widget-chart";
import { WidgetGridEditor } from "./widget-grid-editor";
import { WidgetWorkbench } from "./widget-workbench";
import { WidgetPageMotion } from "./widget-page-motion";
import { AdjacentPageCache, adjacentOffsets } from "./widget-page-cache";
import { isFleetWidget, getFleetOverview, fleetPage, stationPageSize, renderStationBars, type FleetOverview, type FleetItem } from "./solar-fleet";
import { columnSizes, pinGrid, type GridItem } from "./widget-grid";

export interface WidgetPlacement {
  id: string;
  widget_id: WidgetId;
  size: WidgetSize;
  project_id: string | null;
  limit: number;
  columns?: number;
  rows?: number;
  x?: number;
  y?: number;
}
export interface InformationLayout {
  schema_version: 1 | 2;
  widgets: WidgetPlacement[];
}
export const informationLayoutKey = "rhine-information-layout-v2";
const legacyLayoutKey = "rhine-information-layout-v1";
const businessLabels: Record<string, string> = {
  active: "要做",
  completed: "完成",
  cancelled: "不需要",
  observing: "观察",
  waiting: "等待",
};
const businessLabel = (value: string) => businessLabels[value] ?? value;
const groupNames: Record<string, string> = {
  active: "现在要做",
  waiting: "等待与决定",
  observing: "继续观察",
};
const coverageNames: Record<string, string> = {
  retained_versions: "留存文件",
  body_read: "正文已核读",
  partial_read: "部分读取",
  without_reading_record: "未登记核读",
  linked_messages: "关联原文",
  unlinked_attachment_messages: "附件待关联",
  pending_project_review: "原文待项目复核",
};
export function defaultInformationLayout(): InformationLayout {
  return {
    schema_version: 1,
    widgets: [
      {
        id: "default-priorities",
        widget_id: "todo",
        size: "medium",
        project_id: null,
        limit: 5,
      },
      {
        id: "default-priorities-triage",
        widget_id: "triage",
        size: "medium",
        project_id: null,
        limit: 5,
      },
      {
        id: "default-projects",
        widget_id: "projects",
        size: "medium",
        project_id: null,
        limit: 5,
      },
      {
        id: "default-today",
        widget_id: "today",
        size: "small",
        project_id: null,
        limit: 5,
      },
      {
        id: "default-schedule",
        widget_id: "schedule",
        size: "medium",
        project_id: null,
        limit: 5,
      },
    ],
  };
}
/** Only layout/preferences persist. Response data and local completion state never do. */
export function parseInformationLayout(
  value: unknown,
): InformationLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (
    ![1, 2].includes(Number(o.schema_version)) ||
    !Array.isArray(o.widgets) ||
    // A legacy layout may contain 24 mixed cards, each now split in two.
    o.widgets.length > 48
  )
    return null;
  const seen = new Set<string>(),
    widgets: WidgetPlacement[] = [];
  for (const value of o.widgets) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const w = value as Record<string, unknown>;
    if (
      typeof w.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(w.id) ||
      seen.has(w.id) ||
      !isWidgetId(w.widget_id) ||
      !["small", "medium", "large"].includes(String(w.size))
    )
      return null;
    if (
      w.project_id !== null &&
      (typeof w.project_id !== "string" ||
        !w.project_id.trim() ||
        w.project_id.length > 240 ||
        /[\u0000-\u001f\u007f]/.test(w.project_id))
    )
      return null;
    if (
      typeof w.limit !== "number" ||
      !Number.isInteger(w.limit) ||
      w.limit < 1 ||
      w.limit > 100
    )
      return null;
    if (
      w.columns !== undefined &&
      (!columnSizes.includes(w.columns as (typeof columnSizes)[number]) ||
        typeof w.columns !== "number")
    )
      return null;
    if (
      w.rows !== undefined &&
      (typeof w.rows !== "number" ||
        !Number.isInteger(w.rows) ||
        w.rows < 3 ||
        w.rows > 8)
    )
      return null;
    if ((w.x === undefined) !== (w.y === undefined)) return null;
    if (w.x !== undefined && (!Number.isInteger(w.x) || !Number.isInteger(w.y) || Number(w.x) < 0 || Number(w.x) + Number(w.columns ?? (w.size === "small" ? 4 : w.size === "large" ? 12 : 6)) > 12 || Number(w.y) < 0 || Number(w.y) > 10000)) return null;
    seen.add(w.id);
    widgets.push({
      id: w.id,
      x: w.x as number | undefined,
      y: w.y as number | undefined,
      widget_id: w.widget_id,
      size: w.size as WidgetSize,
      project_id: w.project_id as string | null,
      limit: w.limit,
      columns:
        (w.columns as number | undefined) ??
        (w.size === "small" ? 4 : w.size === "large" ? 12 : 6),
      rows: (w.rows as number | undefined) ?? (w.size === "large" ? 5 : 4),
    });
  }
  return { schema_version: 2, widgets };
}
/** One-time, preference-only migration. Never repartition an already split layout. */
export function splitPriorityLayout(layout: InformationLayout): InformationLayout {
  if (!layout.widgets.some(w => w.widget_id === "priorities")) return layout;
  const fixed = pinGrid(layout.widgets.map(w => ({id:w.id, columns:w.columns ?? (w.size === "small" ? 4 : w.size === "large" ? 12 : 6), rows:w.rows ?? 4, minRows:3, x:w.x, y:w.y})));
  const widgets = layout.widgets.map((w,i) => ({...w, columns:fixed[i].columns, rows:fixed[i].rows, x:fixed[i].x!, y:fixed[i].y!}));
  const ids = new Set(widgets.map(w=>w.id));
  const additions: typeof widgets = [];
  const partners = new Map<string, (typeof widgets)[number]>();
  for (const w of widgets) {
    if (w.widget_id !== "priorities") continue;
    w.widget_id = "todo";
    let id = `${w.id.slice(0,65)}-triage`, suffix = 1;
    while (ids.has(id)) id = `${w.id.slice(0,65)}-triage-${suffix++}`;
    ids.add(id);
    const triage = {...w, id, widget_id:"triage" as const};
    if (w.columns >= 8) {
      w.columns = Math.floor(w.columns / 2);
      triage.columns -= w.columns;
      triage.x += w.columns;
    } else if (w.rows >= 6) {
      w.rows = Math.floor(w.rows / 2);
      triage.rows -= w.rows;
      triage.y += w.rows;
    } else {
      // Narrow/short cards cannot split legibly. Append only the new card;
      // all existing coordinates remain untouched, even at the old 24-card cap.
      const occupied = [...widgets, ...additions];
      triage.y = Math.max(...occupied.map(i=>i.y+i.rows));
      if (triage.y > 10000) {
        triage.y = 0;
        while (occupied.some(i=>triage.x<i.x+i.columns && triage.x+triage.columns>i.x && triage.y<i.y+i.rows && triage.y+triage.rows>i.y)) triage.y++;
      }
    }
    w.size = w.columns <= 4 ? "small" : w.columns === 12 ? "large" : "medium";
    triage.size = triage.columns <= 4 ? "small" : triage.columns === 12 ? "large" : "medium";
    additions.push(triage);
    partners.set(w.id,triage);
  }
  return {schema_version:2, widgets:widgets.flatMap(w=>partners.has(w.id) ? [w,partners.get(w.id)!] : [w])};
}
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function button(
  text: string,
  label: string,
  action: () => void,
): HTMLButtonElement {
  const el = element("button", "iw-button", text);
  el.type = "button";
  el.setAttribute("aria-label", label);
  el.addEventListener("click", action);
  return el;
}
function sourceLink(
  text: string,
  url: unknown,
): HTMLAnchorElement | HTMLSpanElement {
  const safe = safeDetailUrl(url);
  if (!safe) return element("span", "iw-muted", "详情链接不可用");
  const a = element("a", "iw-link", text);
  a.href = safe;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
function paragraph(
  root: HTMLElement,
  label: string,
  value?: string | null,
  className = "",
): void {
  if (!value) return;
  const p = element("p", className);
  if (label) p.append(element("span", "iw-label", `${label} `));
  p.append(document.createTextNode(value));
  root.append(p);
}
function badge(status: string): HTMLElement {
  const el = element(
    "span",
    "iw-status",
    statusLabels[status as WidgetStatus] ?? status,
  );
  el.dataset.status = Object.hasOwn(statusLabels, status) ? status : "partial";
  return el;
}
function metrics(root: HTMLElement, values: Metric[]): void {
  if (!values.length) return;
  const dl = element("dl", "iw-metrics");
  for (const metric of values) {
    const row = element("div");
    row.append(
      element("dt", "", metric.label),
      element("dd", "", formatMetric(metric.value, metric.unit)),
    );
    dl.append(row);
  }
  root.append(dl);
}
interface CardState {
  placement: WidgetPlacement;
  root: HTMLElement;
  controls: HTMLElement;
  body: HTMLElement;
  status: HTMLElement;
  count: HTMLElement;
  project: HTMLSelectElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  page: HTMLElement;
  response?: WidgetResponse;
  error?: string;
  loading: boolean;
  blocking?: boolean;
  loadKey?: string;
  loadPromise?: Promise<boolean>;
  entryViews?: Map<string, { key: string; node: HTMLElement }>;
  renderKey?: string;
  trendAbort?: AbortController;
  trendKey?: string;
  trendState?: "loading" | "ready" | "error";
  trendPromise?: Promise<void>;
  revision: number;
  abort?: AbortController;
  offset: number;
  pageSize: number;
  density: string;
  snapshot?: string;
  trend?: WidgetResponse;
  pageNotice: string;
  resize: ResizeObserver;
  resizeTimer?: ReturnType<typeof setTimeout>;
  pageMotion?: WidgetPageMotion;
  resetPaging?: () => void;
  pages?: AdjacentPageCache<{ response: WidgetResponse; trend?: WidgetResponse }>;
  fleet?: FleetOverview;
  fleetCount?: number;
}

export class InformationWidgets {
  private active = false;
  private destroyed = false;
  private editing = false;
  private gridEditor?: WidgetGridEditor;
  private workbench?: WidgetWorkbench;
  private layout = defaultInformationLayout();
  private catalog?: WidgetCatalog;
  private catalogError = "";
  private storageError = "";
  private timer?: ReturnType<typeof setTimeout>;
  private catalogAbort?: AbortController;
  private catalogTask?: Promise<void>;
  private pollAbort?: AbortController;
  private generation = 0;
  private revision?: string;
  private refreshing = false;
  private lastFullRefresh = 0;
  private refreshPending = false;
  private cards = new Map<string, CardState>();
  private pendingReviews = new Map<string, ReviewRequest>();
  private quickBusy = new Set<string>();
  private reviewMessages = new Map<string, string>();
  private briefReviewNotices = new Map<string, { message: string; timer?: ReturnType<typeof setTimeout> }>();
  private reviewNotices = new Map<string, { node: HTMLElement; timer?: ReturnType<typeof setTimeout> }>();
  private latestReviews = new Map<string, WidgetItem>();
  private reviewEpoch = 0;
  private secretarySync = 0;
  private secretaryNeedsSync = false;
  private reviewReceipts = new Map<string, { item: WidgetItem; request: ReviewRequest }>();
  private chartUnits = new Map<string, string>();
  private shell = element("section", "information-widgets");
  private grid = element("div", "iw-grid");
  private notice = element("p", "iw-notice");
  private live = element("p", "iw-live");
  private feedback = element("div", "iw-feedback");
  private dialog = element("dialog", "iw-dialog");
  private editButton: HTMLButtonElement;
  private addPanel = element("details", "iw-add-panel");
  private visibility = () => {
    if (!this.active) return;
    if (document.hidden) this.stop();
    else void this.refresh();
  };
  constructor(private root: HTMLElement) {
    try {
      const saved =
        localStorage.getItem(informationLayoutKey) ??
        localStorage.getItem(legacyLayoutKey);
      if (saved !== null) {
        const parsed = parseInformationLayout(JSON.parse(saved));
        if (parsed) {
          this.layout = splitPriorityLayout(parsed);
          if (this.layout !== parsed) {
            // Keep a recoverable copy, including positions/filters and removed cards.
            const backupKey = `${informationLayoutKey}-before-priority-split`;
            if (localStorage.getItem(backupKey) === null) localStorage.setItem(backupKey, saved);
            localStorage.setItem(informationLayoutKey, JSON.stringify(this.layout));
          }
        }
        else
          this.storageError = "保存的布局无法读取，使用默认布局；旧配置保留。";
      }
    } catch {
      this.storageError = "布局暂时无法读取或保存。";
    }
    this.shell.setAttribute("aria-label", "秘书信息组件");
    this.shell.dataset.pageGesture = "content";
    const header = element("header", "iw-page-heading"),
      title = element("div");
    title.append(
      element("p", "iw-kicker", "INFORMATION / 信息"),
      element("h1", "", "项目与日常，一眼看到重点"),
      element("p", "iw-muted", "按来源更新 · 人工分类与秘书共用记录"),
    );
    const actions = element("div", "iw-page-actions");
    this.editButton = button("调整布局", "调整信息组件布局", () =>
      this.setEditing(!this.editing),
    );
    actions.append(
      button("查找事项", "查找全部已复核事项", () => this.workbench?.search()),
      button("刷新", "刷新所有信息组件", () => void this.refresh()),
      this.editButton,
    );
    header.append(title, actions);
    this.addPanel.append(element("summary", "", `＋ 添加信息组件 · ${offeredWidgetIds.length} 个主题`));
    const directory = element("div", "iw-directory");
    for (const id of offeredWidgetIds)
      directory.append(
        button(widgetTitles[id], `添加${widgetTitles[id]}组件`, () =>
          this.add(id),
        ),
      );
    this.addPanel.append(directory);
    this.addPanel.addEventListener("toggle", () => this.syncGesture());
    this.live.setAttribute("role", "status");
    this.feedback.setAttribute("aria-live", "polite");
    this.dialog.setAttribute("aria-label", "记录详情与人工分类");
    this.shell.append(
      header,
      this.notice,
      this.addPanel,
      this.feedback,
      this.grid,
      this.live,
      this.dialog,
    );
    root.append(this.shell);
    this.workbench = new WidgetWorkbench(
      (item) => this.openReview(item),
      () => { this.invalidatePages(true); void this.refreshSecretary(); },
    );
    this.gridEditor = new WidgetGridEditor(this.grid, {
      items: () =>
        this.layout.widgets.map((p) => ({
          id: p.id,
          columns:
            p.columns ?? (p.size === "small" ? 4 : p.size === "large" ? 12 : 6),
          rows: p.rows ?? 4,
          minRows: p.widget_id.startsWith("solar.") ? 4 : 3,
          x: p.x, y: p.y,
        })),
      apply: (items: GridItem[], save: boolean) => {
        const existing = new Map(this.layout.widgets.map((p) => [p.id, p]));
        this.layout.widgets = items.map((i) => {
          const p = existing.get(i.id)!;
          p.columns = i.columns;
          p.rows = i.rows;
          p.x = i.x; p.y = i.y;
          p.size =
            i.columns <= 4 ? "small" : i.columns === 12 ? "large" : "medium";
          return p;
        });
        this.reconcile();
        if (save) this.save();
      },
      announce: (message) => {
        this.live.textContent = message;
      },
    });
    document.addEventListener("visibilitychange", this.visibility);
    this.reconcile();
    this.updateNotice();
  }
  setActive(active: boolean) {
    if (this.destroyed || active === this.active) return;
    this.active = active;
    if (active && !document.hidden) void this.refresh();
    else {
      this.stop();
      this.dialog.close();
      this.workbench?.close();
    }
  }
  async refresh(): Promise<void> {
    if (!this.active || document.hidden || this.destroyed) return;
    if (this.refreshing) {
      this.refreshPending = true;
      return;
    }
    this.refreshing = true;
    clearTimeout(this.timer);
    const generation = this.generation, reviewEpoch = this.reviewEpoch,
      abort = new AbortController();
    this.pollAbort?.abort();
    this.pollAbort = abort;
    this.live.textContent = "正在更新…";
    void this.refreshCatalog();
    try {
      // Establish the revision before reading data, so concurrent changes trigger another refresh.
      const before = await getRevision({ signal: abort.signal });
      if (generation !== this.generation || reviewEpoch !== this.reviewEpoch) return;
      const cards = [...this.cards.values()];
      const loaded = new Map<CardState, boolean>();
      let index = 0;
      const worker = async () => {
        while (generation === this.generation && index < cards.length) {
          const card=cards[index++];
          if(reviewEpoch!==this.reviewEpoch && !card.placement.widget_id.startsWith("solar.")) continue;
          loaded.set(card, await this.load(card,true,"background"));
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(3, cards.length) }, worker),
      );
      if (generation === this.generation && reviewEpoch === this.reviewEpoch) {
        const current = [...this.cards.values()];
        if (current.filter(c => !c.placement.widget_id.startsWith("solar.")).every(c => loaded.get(c)))
          this.finishSecretarySync();
        const complete = current.every(c => loaded.get(c));
        // A revision is acknowledged only after its pages were actually accepted.
        // Failed/skipped reads must remain eligible for the next poll.
        if (complete) {
          this.revision = before.revision;
          this.lastFullRefresh = Date.now();
        }
        this.live.textContent = complete ? "已同步 · 每 2 秒检查更新" : "部分组件未更新，将自动重试；以下仍可能是上次结果。";
      }
    } catch (e) {
      if (generation === this.generation && !abort.signal.aborted)
        this.live.textContent = `同步暂不可用：${this.message(e)}`;
    } finally {
      this.refreshing = false;
      this.updateNotice();
      if (this.refreshPending && this.active && !document.hidden) {
        this.refreshPending = false;
        void this.refresh();
      } else this.schedulePoll();
    }
  }
  private refreshCatalog(): Promise<void> {
    if (this.catalogTask) return this.catalogTask;
    const generation = this.generation,
      abort = new AbortController();
    this.catalogAbort = abort;
    const task = getCatalog({ signal: abort.signal })
      .then((catalog) => {
        if (generation !== this.generation || abort.signal.aborted) return;
        this.catalog = catalog;
        this.catalogError = "";
        this.cards.forEach((c) => this.updateProjects(c));
      })
      .catch((error) => {
        if (generation === this.generation && !abort.signal.aborted)
          this.catalogError = this.message(error);
      })
      .finally(() => {
        if (this.catalogTask === task) this.catalogTask = undefined;
        this.updateNotice();
      });
    this.catalogTask = task;
    return task;
  }
  private schedulePoll() {
    clearTimeout(this.timer);
    if (this.active && !document.hidden && !this.destroyed)
      this.timer = setTimeout(() => void this.poll(), 2000);
  }
  private async poll() {
    if (!this.active || document.hidden || this.destroyed || this.refreshing)
      return;
    const generation = this.generation, reviewEpoch = this.reviewEpoch,
      abort = new AbortController();
    this.pollAbort = abort;
    try {
      if (this.quickBusy.size) return;
      if (this.secretaryNeedsSync) { await this.refreshSecretary(); return; }
      const state = await getRevision({ signal: abort.signal });
      if (generation !== this.generation || reviewEpoch !== this.reviewEpoch) return;
      if (Date.now() - this.lastFullRefresh >= 60000) { await this.refresh(); return; }
      if (this.quickBusy.size) return;
      if (state.revision !== this.revision) { await this.refresh(); return; }
      if (this.live.textContent !== "已同步 · 每 2 秒检查更新")
        this.live.textContent = "已同步 · 每 2 秒检查更新";
    } catch (e) {
      if (!abort.signal.aborted)
        this.live.textContent = `同步暂不可用：${this.message(e)}`;
    } finally {
      if (generation === this.generation) this.schedulePoll();
    }
  }
  private stop() {
    this.gridEditor?.cancel();
    ++this.generation;
    clearTimeout(this.timer);
    this.catalogAbort?.abort();
    this.catalogTask = undefined;
    this.pollAbort?.abort();
    this.cards.forEach((c) => {
      ++c.revision;
      c.abort?.abort();
      c.trendAbort?.abort();
      c.pages?.clear();
      c.fleet = undefined;
      c.loading = false;
      clearTimeout(c.resizeTimer);
      c.resizeTimer = undefined;
      c.loadPromise = undefined;
      c.resetPaging?.();
    });
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active = false;
    this.stop();
    this.reviewNotices.forEach(n => clearTimeout(n.timer));
    this.reviewNotices.clear();
    this.briefReviewNotices.forEach(n => clearTimeout(n.timer));
    this.briefReviewNotices.clear();
    this.gridEditor?.destroy();
    this.workbench?.destroy();
    this.cards.forEach((c) => c.resize.disconnect());
    document.removeEventListener("visibilitychange", this.visibility);
    this.dialog.close();
    this.shell.remove();
    this.cards.clear();
  }
  private message(e: unknown) {
    return e instanceof Error ? e.message : "暂未取得数据";
  }
  private syncGesture() {
    const editing = this.editing || this.addPanel.open;
    this.root.dataset.widgetEditing = this.shell.dataset.widgetEditing =
      String(editing);
  }
  private setEditing(value: boolean) {
    this.editing = value;
    this.editButton.textContent = value ? "完成调整" : "调整布局";
    this.editButton.setAttribute("aria-pressed", String(value));
    this.cards.forEach((c) => {
      c.controls.hidden = !value;
      if (value) c.resetPaging?.();
    });
    this.gridEditor?.setEnabled(value);
    this.syncGesture();
    if (value)
      this.live.textContent =
        "拖住右上角放到空位；左上、右下角缩放。保留空白、不自动补位；松手保存，Esc 取消。";
  }
  private save() {
    this.layout.schema_version = 2;
    try {
      localStorage.setItem(informationLayoutKey, JSON.stringify(this.layout));
      this.storageError = "";
    } catch {
      this.storageError = "本次布局未能保存。";
    }
    this.updateNotice();
  }
  private updateNotice() {
    this.notice.textContent = [this.storageError, this.catalogError]
      .filter(Boolean)
      .join(" ");
    this.notice.hidden = !this.notice.textContent;
  }
  private add(id: WidgetId) {
    if (this.layout.widgets.length >= 24) {
      this.live.textContent = "最多放置 24 个组件";
      return;
    }
    const placement: WidgetPlacement = {
      id: `widget-${crypto.randomUUID()}`,
      widget_id: id,
      size: "medium",
      columns: 6,
      rows: 4,
      project_id: null,
      limit: 5,
    };
    this.layout.widgets.push(placement);
    this.reconcile();
    this.save();
    this.setEditing(true);
    const card = this.cards.get(placement.id)!;
    card.root.focus();
    void this.load(card);
  }
  private reconcile() {
    const fixed = pinGrid(this.layout.widgets.map(p => ({id:p.id, columns:p.columns ?? (p.size === "small" ? 4 : p.size === "large" ? 12 : 6), rows:Math.max(p.widget_id.startsWith("solar.") ? 4 : 3, p.rows ?? 4), minRows:p.widget_id.startsWith("solar.") ? 4 : 3, x:p.x, y:p.y})));
    for (const p of this.layout.widgets) { const i = fixed.find(i=>i.id===p.id)!; p.x=i.x; p.y=i.y; }
    this.grid.dataset.fixedLayout = "true";
    const ids = new Set(this.layout.widgets.map((w) => w.id));
    for (const [id, card] of this.cards)
      if (!ids.has(id)) {
        card.abort?.abort();
        card.trendAbort?.abort();
        card.pages?.clear();
        card.resize.disconnect();
        clearTimeout(card.resizeTimer);
        card.resetPaging?.();
        card.root.remove();
        this.cards.delete(id);
      }
    this.grid.querySelector(".iw-empty-layout")?.remove();
    for (const p of this.layout.widgets) {
      let card = this.cards.get(p.id);
      if (!card) {
        card = this.makeCard(p);
        this.cards.set(p.id, card);
      }
      card.root.style.setProperty(
        "--iw-columns",
        String(
          p.columns ?? (p.size === "small" ? 4 : p.size === "large" ? 12 : 6),
        ),
      );
      card.root.style.setProperty("--iw-rows", String(p.rows ?? 4));
      card.root.style.setProperty("--iw-x", String(p.x! + 1));
      card.root.style.setProperty("--iw-y", String(p.y! + 1));
      this.grid.append(card.root);
    }
    this.gridEditor?.refresh();
    if (!ids.size)
      this.grid.append(element("p", "iw-empty-layout", "从上方添加信息组件。"));
  }
  private makeCard(p: WidgetPlacement): CardState {
    if (p.widget_id.startsWith("solar.")) p.rows = Math.max(4, p.rows ?? 4);
    const root = element("article", "iw-card");
    root.dataset.instanceId = p.id;
    root.dataset.pageGesture = "content";
    root.tabIndex = -1;
    const heading = element("header", "iw-card-heading"),
      title = element("h2", "", widgetTitles[p.widget_id]);
    title.id = `iw-title-${p.id}`;
    root.setAttribute("aria-labelledby", title.id);
    const status = element("span", "iw-status", "尚未读取");
    heading.append(title, status);
    const controls = element("div", "iw-controls");
    controls.hidden = !this.editing;
    const project = element("select"),
      limit = element("input");
    limit.type = "number";
    limit.min = "1";
    limit.max = "100";
    limit.value = String(p.limit);
    const queryOptions = element("details", "iw-query-options");
    queryOptions.append(element("summary", "", "组件选项"));
    const queryFields = element("div");
    for (const [label, input] of [
      ["项目范围", project],
      ["每页上限", limit],
    ] as const) {
      const l = element("label", "", label);
      input.setAttribute("aria-label", label);
      l.append(input);
      queryFields.append(l);
    }
    queryOptions.append(queryFields);
    controls.append(queryOptions);
    queryFields.append(
      button("移除", "移除此组件", () => {
        this.layout.widgets = this.layout.widgets.filter((w) => w.id !== p.id);
        this.save();
        this.reconcile();
        this.editButton.focus();
      }),
    );
    const body = element("div", "iw-body"),
      viewport = element("div", "iw-body-viewport"),
      footer = element("footer", "iw-card-footer"),
      count = element("span", "iw-count"),
      page = element("span", "iw-page-number");
    const previous = button("←", "上一页", () => this.turn(card, -1)),
      next = button("→", "下一页", () => this.turn(card, 1));
    footer.append(
      previous,
      page,
      next,
      button("↻", "刷新此组件", () => void this.load(card, true)),
    );
    viewport.append(body);
    root.append(heading, controls, viewport, count, footer);
    let measuredWidth = 0,
      measuredHeight = 0;
    const resize = new ResizeObserver(() => {
      const rect = { width: body.clientWidth, height: body.clientHeight };
      if (rect.width <= 0 || rect.height <= 0) return;
      if (rect.width !== measuredWidth || rect.height !== measuredHeight)
        card.resetPaging?.();
      measuredWidth = rect.width;
      measuredHeight = rect.height;
      const result = capacity(
        rect.width,
        rect.height,
        p.limit,
        p.widget_id.startsWith("solar."),
      );
      const fleetCount = isFleetWidget(p.widget_id) ? stationPageSize(rect.width) : undefined;
      const fleetChanged = fleetCount !== card.fleetCount;
      if (fleetChanged && p.widget_id === "solar.stations" && card.fleetCount && fleetCount)
        card.offset = Math.floor(card.offset * card.fleetCount / fleetCount);
      card.fleetCount = fleetCount;
      root.dataset.short = String(!p.widget_id.startsWith("solar.") && rect.height < 190);
      root.dataset.narrow = String(rect.width < 220);
      root.dataset.density = result.density;
      body.style.setProperty("--iw-content-columns", String(result.columns));
      root.dataset.solarWide = String(
        p.widget_id.startsWith("solar.") &&
          rect.width >= 640 &&
          rect.height >= 230,
      );
      if (card.pageSize !== result.count || card.density !== result.density || fleetChanged) {
        const changed = card.pageSize !== result.count || fleetChanged;
        card.density = result.density;
        card.pageSize = result.count;
        if (changed) {
          card.offset = Math.floor(card.offset / result.count) * result.count;
          clearTimeout(card.resizeTimer);
          card.resizeTimer = setTimeout(() => {
            card.resizeTimer = undefined;
            void this.load(card, true, "resize");
          }, 150);
        } else this.renderCard(card);
      }
    });
    const card: CardState = {
      placement: p,
      root,
      controls,
      body,
      status,
      count,
      project,
      previous,
      next,
      page,
      loading: false,
      revision: 0,
      offset: 0,
      pageSize: 1,
      density: "compact",
      pageNotice: "",
      resize,
      pageMotion: new WidgetPageMotion(viewport, body),
      pages: new AdjacentPageCache(),
    };
    resize.observe(body);
    project.addEventListener("change", () => {
      card.resetPaging?.();
      p.project_id = project.value || null;
      card.offset = 0;
      card.snapshot = undefined;
      card.response = undefined;
      this.save();
      void this.load(card, true);
    });
    limit.addEventListener("change", () => {
      const n = Number(limit.value);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        limit.value = String(p.limit);
        return;
      }
      p.limit = n;
      card.resetPaging?.();
      const rect = { width: body.clientWidth, height: body.clientHeight };
      card.pageSize = capacity(
        rect.width,
        rect.height,
        n,
        p.widget_id.startsWith("solar."),
      ).count;
      card.offset = 0;
      this.save();
      void this.load(card, true);
    });
    this.bindPaging(card);
    this.updateProjects(card);
    this.renderCard(card);
    return card;
  }
  private updateProjects(card: CardState) {
    card.project.disabled = isFleetWidget(card.placement.widget_id);
    const p = card.placement,
      options = [
        {
          id: "",
          name: p.widget_id.startsWith("solar.") ? "所有电站" : "所有项目",
        },
        ...(this.catalog?.projects ?? []).filter(
          (v) =>
            v.source_id ===
            (p.widget_id.startsWith("solar.") ? "solar-monitor" : "secretary"),
        ),
      ];
    if (p.project_id && !options.some((v) => v.id === p.project_id))
      options.push({ id: p.project_id, name: "已保存范围（当前目录未确认）" });
    const key = JSON.stringify(options);
    if (card.project.dataset.options !== key) {
      card.project.replaceChildren(
        ...options.map((v) => {
          const o = element("option", "", v.name);
          o.value = v.id;
          return o;
        }),
      );
      card.project.dataset.options = key;
    }
    card.project.value = p.project_id ?? "";
  }
  private bindPaging(card: CardState) {
    const pager = new SwipePager();
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    let touch:
      { id: number; x: number; y: number; locked: boolean } | undefined;
    const blocked = (target: EventTarget | null, touchInput = false) =>
      this.editing ||
      !!(target as Element)?.closest(
        touchInput
          ? "button,a,input,select,textarea,summary,[contenteditable]"
          : "input,select,textarea,summary,[contenteditable]",
      ) ||
      !!window.getSelection()?.toString();
    card.resetPaging = () => {
      clearTimeout(releaseTimer);
      pager.reset();
      touch = undefined;
      card.pageMotion?.cancel();
    };
    card.root.addEventListener(
      "wheel",
      (e) => {
        e.stopPropagation();
        if (e.ctrlKey || e.deltaMode !== 0 || blocked(e.target)) {
          card.resetPaging?.();
          return;
        }
        const motion = pager.wheel(
          e.deltaX,
          e.deltaY,
          performance.now(),
          e.deltaMode,
        );
        if (motion.consume) {
          e.preventDefault();
          clearTimeout(releaseTimer);
          releaseTimer = setTimeout(() => {
            pager.reset();
            card.pageMotion?.release();
          }, 190);
          if (!pager.committed && !(card.loading && card.blocking !== false)) {
            const direction = pager.distance < 0 ? -1 : 1;
            card.pageMotion?.preview(
              pager.distance,
              this.nextOffset(card, direction) !== null,
            );
          }
        }
        if (motion.step) this.turn(card, motion.step);
      },
      { passive: false },
    );
    card.body.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch" && !blocked(e.target, true))
        touch = { id: e.pointerId, x: e.clientX, y: e.clientY, locked: false };
    });
    card.body.addEventListener("pointermove", (e) => {
      if (!touch || e.pointerId !== touch.id || touch.locked) return;
      const dx = e.clientX - touch.x,
        dy = e.clientY - touch.y;
      if (Math.abs(dy) > 20 && Math.abs(dy) > Math.abs(dx)) {
        touch = undefined;
        return;
      }
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        touch.locked = true;
        this.turn(card, dx < 0 ? 1 : -1);
      }
    });
    for (const name of ["pointerup", "pointercancel", "pointerleave"])
      card.body.addEventListener(name, () => {
        touch = undefined;
      });
  }
  private nextOffset(card: CardState, direction: number): number | null {
    const shownOffset = card.response?.pagination?.offset ?? card.offset;
    const shownCount = Math.min(
      card.pageSize,
      card.response?.items.length ?? 0,
    );
    const next =
      direction < 0
        ? Math.max(0, shownOffset - card.pageSize)
        : shownOffset + shownCount < (card.response?.total ?? 0)
          ? shownOffset + shownCount
          : null;
    return next === card.offset ? null : next;
  }
  private turn(card: CardState, direction: number) {
    if ((card.loading && card.blocking !== false) || this.editing) return;
    const next = this.nextOffset(card, direction);
    if (next === null) {
      card.pageMotion?.boundary(direction);
      return;
    }
    const token = card.pageMotion?.begin(direction);
    card.offset = next;
    card.pageNotice = "";
    void this.load(card).then(() => {
      if (token !== undefined)
        card.pageMotion?.complete(
          token,
          !card.error &&
            (card.response?.pagination?.offset ?? card.offset) === next,
          !!card.error,
        );
    });
  }
  private load(
    card: CardState,
    fresh = false,
    reason: "interaction" | "background" | "resize" | "review" = "interaction",
  ): Promise<boolean> {
    if (
      this.destroyed ||
      !this.active ||
      document.hidden ||
      !this.cards.has(card.placement.id)
    )
      return Promise.resolve(false);
    if (reason === "background" && card.resizeTimer)
      return card.loadPromise ?? Promise.resolve(false);
    if (reason === "review") {
      clearTimeout(card.resizeTimer);
      card.resizeTimer = undefined;
    }
    const key = JSON.stringify([
      card.placement.widget_id,
      card.placement.project_id,
      card.offset,
      card.pageSize,
      fresh ? null : card.snapshot,
      card.placement.widget_id.startsWith("solar.") ? null : this.revision,
    ]);
    if (card.loadPromise && !card.abort?.signal.aborted) {
      if (card.loadKey === key) return card.loadPromise;
      if (reason === "background")
        return card.loadPromise.then(() => this.load(card, true, reason));
    }
    card.loadKey = key;
    const promise = this.runLoad(card, fresh, reason).finally(() => {
      if (card.loadPromise === promise) card.loadPromise = undefined;
    });
    card.loadPromise = promise;
    return promise;
  }
  private pageScope(card: CardState) {
    return JSON.stringify([card.placement.widget_id, card.placement.project_id, card.pageSize, card.fleetCount, card.snapshot, card.placement.widget_id.startsWith("solar.") ? null : this.revision]);
  }
  private invalidatePages(secretaryOnly = false) {
    for (const card of this.cards.values()) {
      if (secretaryOnly && card.placement.widget_id.startsWith("solar.")) continue;
      card.pages?.clear(); card.fleet = undefined;
      card.abort?.abort(); card.trendAbort?.abort(); ++card.revision;
      card.loading = false; card.loadPromise = undefined; card.snapshot = undefined;
    }
  }
  private async readPage(card: CardState, offset: number, snapshot: string | undefined, signal: AbortSignal, complete = false) {
    const p = card.placement;
    let response: WidgetResponse;
    if (isFleetWidget(p.widget_id)) {
      const fleet = card.fleet ?? await getFleetOverview(signal);
      if (signal.aborted) throw new DOMException("已取消", "AbortError");
      card.fleet = fleet;
      response = fleetPage(fleet, p.widget_id, offset, card.body.clientWidth);
    } else response = await getWidget(p.widget_id, {project_id:p.project_id ?? undefined, limit:card.pageSize, offset, snapshot_revision:snapshot, signal});
    let trend: WidgetResponse | undefined;
    const scope = p.project_id ?? response.items[0]?.project_id;
    if (complete && p.widget_id === "solar.generation" && scope && response.items.some(i=>!i.data?.points.length)) {
      trend = await getWidget("solar.trend", {project_id:scope, limit:1, signal});
      if (["error", "disconnected"].includes(trend.status)) throw new Error("相邻页曲线暂不可读");
    }
    return {response, trend};
  }
  private acceptPage(card: CardState, page: {response: WidgetResponse; trend?: WidgetResponse}) {
    const result = page.response, p = card.placement;
    if (!p.widget_id.startsWith("solar.")) for(const item of result.items) if(this.latestReviews?.has(item.id) && !this.quickBusy.has(item.id)) this.latestReviews.set(item.id,item);
    card.response = result; card.offset = result.pagination?.offset ?? card.offset;
    card.snapshot = result.snapshot_revision; card.error = undefined; card.loading = false;
    const scope = p.project_id ?? result.items[0]?.project_id;
    if (card.trendKey && card.trendKey !== scope) {
      card.trendAbort?.abort(); card.trend = undefined; card.trendKey = undefined;
      card.trendPromise = undefined; card.trendState = undefined;
    }
    if (page.trend) {
      card.trendAbort?.abort(); card.trend = page.trend; card.trendKey = scope ?? undefined;
      card.trendState = "ready"; card.trendPromise = undefined;
    } else if (p.widget_id === "solar.generation" && scope && result.items.some(i=>!i.data?.points.length)) void this.loadTrend(card, scope);
    this.renderCard(card);
    this.warmAdjacent(card);
  }
  private warmAdjacent(card: CardState) {
    if (!this.active || document.hidden || !card.pages || !card.response || !this.cards.has(card.placement.id)) return;
    const response = card.response, offset = response.pagination?.offset ?? card.offset;
    card.pages.configure(this.pageScope(card));
    const offsets = adjacentOffsets(offset, Math.min(card.pageSize,response.items.length), card.pageSize, response.total);
    card.pages.retain([offset,...offsets]);
    if (!["error","disconnected"].includes(response.status)) card.pages.put(offset,{response,trend:card.trendState === "ready" ? card.trend : undefined});
    const snapshot = card.snapshot, scope = this.pageScope(card);
    const update = () => {
      if (scope === this.pageScope(card)) card.root.dataset.adjacentReady = String(offsets.filter(o=>card.pages?.get(o)).length);
    };
    update();
    for (const offset of offsets) void card.pages.warm(offset, async signal => {
      const page = await this.readPage(card, offset, snapshot, signal, true);
      if (["error","disconnected"].includes(page.response.status)) throw new Error("相邻页暂不可读");
      return page;
    }).then(update).catch(()=>{});
  }
  private async runLoad(
    card: CardState,
    fresh: boolean,
    reason: "interaction" | "background" | "resize" | "review",
  ): Promise<boolean> {
    if (
      this.destroyed ||
      !this.active ||
      document.hidden ||
      !this.cards.has(card.placement.id)
    )
      return false;
    card.abort?.abort();
    const abort = new AbortController(),
      revision = ++card.revision;
    card.abort = abort;
    if (fresh) { card.pages?.clear(); card.fleet = undefined; card.snapshot = undefined; }
    card.pages?.configure(this.pageScope(card));
    const cached = !fresh ? card.pages?.get(card.offset) : undefined;
    if (cached) {
      card.root.dataset.pageCache = "hit";
      this.acceptPage(card, cached);
      return true;
    }
    if (card.root) card.root.dataset.pageCache = "miss";
    card.loading = true;
    card.blocking = !["background", "review"].includes(reason) || !card.response;
    this.renderStatus(card);
    const p = card.placement;
    try {
      let page: {response: WidgetResponse; trend?: WidgetResponse};
      try {
        const pending = !fresh ? card.pages?.pending(card.offset) : undefined;
        try { page = pending ? await pending : await this.readPage(card,card.offset,card.snapshot,abort.signal); }
        catch(e) { if (!pending || abort.signal.aborted) throw e; page = await this.readPage(card,card.offset,card.snapshot,abort.signal); }
      } catch (e) {
        if (revision !== card.revision || abort.signal.aborted) return false;
        if (e instanceof WidgetAPIError && e.code === "snapshot_changed") {
          card.offset = 0;
          card.snapshot = undefined;
          card.pages?.clear();
          card.pageNotice = "数据已更新，已回到第一页";
          page = await this.readPage(card,0,undefined,abort.signal);
        } else throw e;
      }
      if (revision !== card.revision || abort.signal.aborted) return false;
      let result = page.response;
      if (card.offset >= result.total && card.offset > 0) {
        card.offset = Math.max(
          0,
          Math.floor((result.total - 1) / card.pageSize) * card.pageSize,
        );
        page = await this.readPage(card,card.offset,undefined,abort.signal);
        result = page.response;
      }
      if (revision !== card.revision || abort.signal.aborted) return false;
      if (["error", "disconnected"].includes(result.status))
        throw new Error(result.message || "来源暂不可用");
      this.acceptPage(card, page);
      return true;
    } catch (e) {
      if (revision === card.revision && !abort.signal.aborted) {
        card.error = this.message(e);
        card.offset = card.response?.pagination?.offset ?? card.offset;
        card.snapshot = card.response?.snapshot_revision;
      }
      return false;
    } finally {
      if (revision === card.revision && !abort.signal.aborted) {
        card.loading = false;
        this.renderCard(card);
      }
    }
  }
  private loadTrend(card: CardState, scope: string): Promise<void> {
    if (
      card.trendKey === scope &&
      card.trendPromise &&
      !card.trendAbort?.signal.aborted
    )
      return card.trendPromise;
    card.trendAbort?.abort();
    const abort = new AbortController(),
      generation = this.generation;
    card.trendAbort = abort;
    card.trendKey = scope;
    if (!card.trend) card.trendState = "loading";
    const task = getWidget("solar.trend", {
      project_id: scope,
      limit: 1,
      signal: abort.signal,
    })
      .then((trend) => {
        if (
          abort.signal.aborted ||
          generation !== this.generation ||
          !this.cards.has(card.placement.id) ||
          card.trendKey !== scope
        )
          return;
        card.trend = trend;
        card.trendState = ["error", "disconnected"].includes(trend.status)
          ? "error"
          : "ready";
        if (card.pageNotice === "趋势暂不可读，保留已取得的发电数据")
          card.pageNotice = "";
        this.renderCard(card);
        if (card.pages && card.response && card.trendState === "ready") card.pages.put(card.offset,{response:card.response,trend});
      })
      .catch(() => {
        if (abort.signal.aborted || generation !== this.generation) return;
        card.trendState = "error";
        card.pageNotice = "趋势暂不可读，保留已取得的发电数据";
        this.renderCard(card);
      })
      .finally(() => {
        if (card.trendPromise === task) card.trendPromise = undefined;
      });
    card.trendPromise = task;
    return task;
  }
  private renderStatus(card: CardState) {
    const state = card.error
      ? card.response
        ? "stale"
        : "error"
      : card.response?.status;
    const label =
      card.loading && (card.blocking !== false || !card.response)
        ? "读取中…"
        : state
          ? statusLabels[state]
          : "尚未读取";
    if (card.status.textContent !== label) card.status.textContent = label;
    card.status.dataset.status = state ?? "partial";
    card.root.setAttribute(
      "aria-busy",
      String(card.loading && card.blocking !== false),
    );
    card.previous.disabled =
      (card.loading && card.blocking !== false) ||
      (card.response?.pagination?.offset ?? card.offset) === 0;
    card.next.disabled =
      (card.loading && card.blocking !== false) ||
      !card.response ||
      (card.response.pagination?.offset ?? card.offset) +
        Math.min(card.pageSize, card.response.items.length) >=
        card.response.total;
  }
  private renderCard(card: CardState) {
    this.renderStatus(card);
    const data = card.response;
    const count =
      card.pageNotice ||
      (data
        ? `来源 ${formatSourceDate(data.data_updated_at)}`
        : "尚未取得数据");
    if (card.count.textContent !== count) card.count.textContent = count;
    card.count.title = data?.message ?? "";
    const shownOffset = data?.pagination?.offset ?? card.offset;
    const shownItems = data?.items.slice(0, card.pageSize) ?? [];
    const page = data
      ? isFleetWidget(data.widget_id) ? `${shownOffset + 1} / ${data.total} 页` : `${data.total && shownItems.length ? shownOffset + 1 : 0}–${shownOffset + shownItems.length} / ${data.total} 条`
      : "—";
    if (card.page.textContent !== page) card.page.textContent = page;
    const key = JSON.stringify([
      shownItems,
      card.density,
      card.trend?.items,
      card.trendState,
      card.error,
      data?.items.length ? null : data?.message,
      shownItems.map(i=>[this.quickBusy.has(i.id),this.pendingReviews.has(i.id),this.reviewMessage(i.id)]),
    ]);
    if (card.renderKey === key) return;
    card.renderKey = key;
    const wanted: HTMLElement[] = [];
    const views: NonNullable<CardState["entryViews"]> = (card.entryViews ??=
      new Map());
    if (card.error)
      wanted.push(
        element(
          "p",
          "iw-warning",
          `${card.error}${data ? " · 以下为上次结果" : ""}`,
        ),
      );
    if (!data?.items.length) {
      if (data)
        wanted.push(
          element("p", "iw-empty-state", data.message || "当前范围没有记录"),
        );
      card.body.replaceChildren(...wanted);
      views.clear();
      return;
    }
    const focused =
      document.activeElement instanceof HTMLElement &&
      card.body.contains(document.activeElement)
        ? document.activeElement
        : undefined;
    const focusRecord =
      focused?.closest<HTMLElement>("[data-record-id]")?.dataset.recordId;
    const focusLabel = focused?.getAttribute("aria-label");
    for (const item of shownItems) {
      const entryKey = JSON.stringify([
        item,
        card.density,
        card.trend?.items.find((i) => i.project_id === item.project_id),
        card.trendState,
        this.quickBusy.has(item.id), this.pendingReviews.has(item.id), this.reviewMessage(item.id),
      ]);
      const previous = views.get(item.id);
      if (previous?.key === entryKey) {
        wanted.push(previous.node);
        continue;
      }
      const entry = element("section", "iw-summary");
      entry.dataset.recordId = item.id;
      const solar = data.widget_id.startsWith("solar.");
      entry.append(
        element("h3", "", solar ? item.project_name || item.title : item.title),
      );
      if (solar) {
        if (isFleetWidget(data.widget_id)) { entry.classList.add("iw-fleet-summary"); entry.title = item.data?.note ?? ""; }
        const fallback = card.trend?.items.find(
          (i) => i.project_id === item.project_id,
        );
        const chartData = item.data?.points.length ? item.data : fallback?.data;
        if (item.status === "demo" || item.data?.source_mode === "demo")
          paragraph(entry, "", "演示数据", "iw-warning");
        const fleetItem = item as FleetItem;
        if (fleetItem.fleet_bars) {
          entry.classList.add("iw-fleet-bars-summary");
          const chart = element("div", "iw-chart-slot");
          renderStationBars(chart, fleetItem.fleet_bars, fleetItem.fleet_scale ?? 1, code => {
            const project = this.catalog?.projects.find(p=>p.source_id === "solar-monitor" && p.id.endsWith(`:${code}`));
            this.workbench?.solar(project?.id);
          });
          entry.append(chart);
        } else if (chartData?.points.length) {
          const chart = element("div", "iw-chart-slot");
          const units = [...new Set(chartData.points.map((p) => p.unit))];
          const draw = (unit: string) =>
            renderWidgetChart(
              chart,
              chartData.points.filter((p) => p.unit === unit),
              `${fallback && chartData === fallback.data ? "同站趋势 · " : ""}${chartData.date ?? "来源实际日期"}`,
            );
          if (units.length > 1) {
            const select = element("select");
            select.setAttribute("aria-label", "曲线单位");
            for (const unit of units) {
              const o = element("option", "", unit || "单位未知");
              o.value = unit;
              select.append(o);
            }
            select.value = units.includes(this.chartUnits.get(item.id) ?? "")
              ? this.chartUnits.get(item.id)!
              : units[0];
            select.addEventListener("change", () => {
              this.chartUnits.set(item.id, select.value);
              draw(select.value);
            });
            entry.append(select);
          }
          draw(
            units.includes(this.chartUnits.get(item.id) ?? "")
              ? this.chartUnits.get(item.id)!
              : units[0],
          );
          entry.append(chart);
        } else
          paragraph(
            entry,
            "",
            data.widget_id === "solar.generation" &&
              card.trendState === "loading"
              ? "曲线加载中…"
              : card.trendState === "error"
                ? "曲线暂不可读"
                : "来源未提供曲线",
            "iw-muted",
          );
        if (item.data)
          metrics(
            entry,
            item.data.metrics.slice(0, card.density === "compact" ? 1 : 2),
          );
        if (item.data?.data_complete === false)
          paragraph(entry, "", "数据存在缺口", "iw-warning");
        if (isFleetWidget(data.widget_id)) paragraph(entry,"",item.data?.note,"iw-fleet-note");
      } else {
        paragraph(
          entry,
          "",
          data.widget_id === "projects"
            ? businessLabel(item.phase || item.status)
            : item.project_name || businessLabel(item.phase || item.status),
          "iw-phase",
        );
        paragraph(
          entry,
          "",
          item.focus_needs_review
            ? "当前重点待复核"
            : item.focus || item.summary,
          data.widget_id === "projects"
            ? "iw-summary-text iw-project-focus"
            : "iw-summary-text",
        );
        if (data.widget_id === "projects" && item.highlight) {
          const highlight = element(
            "p",
            "iw-summary-highlight",
            `${item.highlight.label} · ${item.highlight.value}`,
          );
          highlight.title = item.highlight.note;
          entry.append(highlight);
          if (card.density === "detailed")
            paragraph(entry, "", item.highlight.note, "iw-extra");
        }
        if (
          card.density !== "compact" &&
          !(data.widget_id === "projects" && item.highlight)
        )
          paragraph(
            entry,
            item.due_at ? "安排" : "下一步",
            item.due_at
              ? formatSourceDate(item.due_at, item.all_day)
              : item.next_action,
            "iw-extra",
          );
      }
      const actions = element("div", "iw-summary-actions");
      actions.append(
        button(
          solar ? "电站工作台" : "详情",
          solar ? "打开电站工作台" : "查看完整记录",
          () => this.openDetail(item, data.widget_id),
        ),
      );
      if (item.review_revision) {
        const more = button("项目归属 / 更多", "人工分类此事项", () => this.openReview(item));
        more.disabled = this.quickBusy.has(item.id);
        actions.append(more);
      }
      if (!solar && item.review_revision) {
        entry.classList.add("iw-actionable-summary");
        const quick = element("div", "iw-quick-review");
        quick.setAttribute("role", "group"); quick.setAttribute("aria-label", "快速判别");
        for (const [status,label] of [["active","要做"],["completed","完成"],["cancelled","不需要"],["observing","观察"]] as const) {
          const action = button(label,label,()=>void this.quickReview(item,status));
          action.setAttribute("aria-pressed",String((item.manual_status ?? item.group ?? item.status) === status));
          action.disabled = this.quickBusy.has(item.id) || this.pendingReviews.has(item.id);
          quick.append(action);
        }
        entry.append(quick);
        const feedback = this.reviewMessage(item.id);
        if (feedback) {
          const message = element("p", "iw-review-inline", feedback.split("；")[0]);
          message.title = feedback;
          message.setAttribute("role", "status");
          entry.append(message);
        }
      }
      entry.append(actions);
      if (solar) {
        entry.classList.add("iw-solar-summary");
        const side = element("div", "iw-solar-details");
        for (const child of [...entry.children])
          if (
            child.tagName !== "H3" &&
            !child.classList.contains("iw-chart-slot")
          )
            side.append(child);
        entry.append(side);
      }
      views.set(item.id, { key: entryKey, node: entry });
      wanted.push(entry);
    }
    const ids = new Set(shownItems.map((item) => item.id));
    for (const id of views.keys()) if (!ids.has(id)) views.delete(id);
    for (let i = 0; i < wanted.length; i++)
      if (card.body.children[i] !== wanted[i])
        card.body.insertBefore(wanted[i], card.body.children[i] ?? null);
    while (card.body.children.length > wanted.length)
      card.body.lastElementChild!.remove();
    if (focused && !focused.isConnected && focusRecord && focusLabel) {
      const node = views.get(focusRecord)?.node;
      [...(node?.querySelectorAll<HTMLElement>("[aria-label]") ?? [])]
        .find((e) => e.getAttribute("aria-label") === focusLabel)
        ?.focus({ preventScroll: true });
    }
  }
  private openDetail(item: WidgetItem, topic: WidgetId) {
    if (topic.startsWith("solar."))
      this.workbench?.solar(item.project_id ?? undefined);
    else if (topic === "projects" && item.project_id)
      this.workbench?.project(item.project_id, item.project_name || item.title);
    else this.workbench?.item(item);
  }
  private renderReviewedViews() {
    for (const card of this.cards.values())
      if (!card.placement.widget_id.startsWith("solar.")) this.renderCard(card);
  }
  private finishSecretarySync() {
    this.secretaryNeedsSync = false;
    for (const {item, request} of this.reviewReceipts.values())
      this.showUndo(item, request.action === "undo" ? undefined : request.action,
        `${this.confirmedMessage(item, request)}；组件列表已更新`);
    this.reviewReceipts.clear();
  }
  private secretarySyncFailed() {
    this.live.textContent = "秘书列表尚未更新，将自动重试；保留上次内容，不代表已同步。";
    for (const {item, request} of this.reviewReceipts.values()) {
      const node = this.showUndo(item, request.action === "undo" ? undefined : request.action,
        `${this.confirmedMessage(item, request)}；组件列表尚未更新，正在自动重试`, true);
      node.append(button("重试刷新", "只重试秘书列表读取", () => void this.refreshSecretary()));
    }
  }
  private async refreshSecretary(revision?: string): Promise<boolean> {
    const sync = ++this.secretarySync, epoch = this.reviewEpoch, generation = this.generation;
    this.secretaryNeedsSync = true;
    this.invalidatePages(true);
    if (!this.active || document.hidden || this.destroyed) return false;
    this.live.textContent = "正在刷新秘书组件列表…";
    const current = () => sync === this.secretarySync && epoch === this.reviewEpoch && generation === this.generation && !this.destroyed;
    try {
      const value = revision ?? (await getRevision()).revision;
      if (!current()) return false;
      const cards = [...this.cards.values()].filter(c=>!c.placement.widget_id.startsWith("solar."));
      const loaded = new Map<CardState, boolean>();
      let index=0;
      const worker=async()=> { while(current() && index<cards.length) {
        const card = cards[index++];
        loaded.set(card, await this.load(card,true,"review"));
      } };
      await Promise.all(Array.from({length:Math.min(3,cards.length)},worker));
      if (!current()) return false;
      if ([...this.cards.values()].filter(c=>!c.placement.widget_id.startsWith("solar.")).some(c=>!loaded.get(c))) {
        this.secretarySyncFailed(); return false;
      }
      this.revision = value;
      this.finishSecretarySync();
      this.live.textContent = [...this.cards.values()].some(c=>c.error) ? "部分组件未更新，旧内容已标记。" : "已同步 · 每 2 秒检查更新";
      return true;
    } catch {
      if (current()) this.secretarySyncFailed();
      return false;
    }
  }
  private applyReviewedItem(item: WidgetItem) {
    this.latestReviews.set(item.id,item);
    this.invalidatePages(true);
    for (const card of this.cards.values()) {
      if (card.placement.widget_id.startsWith("solar.")) continue;
      if (card.response) card.response = {...card.response,items:card.response.items.map(i=>i.id === item.id ? item : i)};
      this.renderCard(card);
    }
  }
  private confirmedMessage(item: WidgetItem, request?: ReviewRequest) {
    if(request?.action === "undo") return "已撤销本次人工分类，秘书已确认";
    if(request?.action === "project") return "项目归属已更新，秘书已确认";
    const status = item.manual_status ?? item.status;
    const text = status === "active" ? "已设为要做" : status === "completed" ? "已标为完成" : status === "cancelled" ? "已设为不需要" : status === "observing" ? "已设为观察" : `状态为${businessLabel(status)}`;
    return `${text}，秘书已确认${status === "active" ? "；要做事项仍保留在“要做”组件，不代表已启动执行" : "；列表范围以秘书返回为准"}`;
  }
  private reviewMessage(id: string) {
    return this.briefReviewNotices?.get(id)?.message ?? this.reviewMessages?.get(id);
  }
  private briefFeedback(item: WidgetItem) {
    const previous = this.briefReviewNotices.get(item.id);
    clearTimeout(previous?.timer);
    const state: { message: string; timer?: ReturnType<typeof setTimeout> } = {
      message: `已是“${businessLabel(item.manual_status ?? item.status)}”，无需重复提交`,
    };
    this.briefReviewNotices.set(item.id, state);
    state.timer = setTimeout(() => {
      if (this.briefReviewNotices.get(item.id) !== state) return;
      this.briefReviewNotices.delete(item.id);
      if (!this.destroyed) this.renderReviewedViews();
    }, 2000);
    // No global banner, hover/focus pause or change to the existing undo receipt.
    this.renderReviewedViews();
  }
  private feedbackFor(item: WidgetItem, message: string, persistent = false) {
    clearTimeout(this.briefReviewNotices?.get(item.id)?.timer);
    this.briefReviewNotices?.delete(item.id);
    const previous = this.reviewNotices.get(item.id);
    clearTimeout(previous?.timer); previous?.node.remove();
    this.reviewMessages.set(item.id,message);
    const node=element("div","iw-saved-action");
    node.append(element("span","",`${item.title}：${message}`));
    const state: {node:HTMLElement;timer?:ReturnType<typeof setTimeout>}={node};
    this.reviewNotices.set(item.id,state);
    const remove=()=>{ if(this.reviewNotices.get(item.id)!==state)return; clearTimeout(state.timer); node.remove();this.reviewNotices.delete(item.id);this.reviewMessages.delete(item.id);if(!this.destroyed)this.renderReviewedViews(); };
    if(!persistent) {
      const schedule=()=>{clearTimeout(state.timer);state.timer=setTimeout(remove,8000);};
      node.addEventListener("mouseenter",()=>clearTimeout(state.timer));
      node.addEventListener("mouseleave",schedule);
      node.addEventListener("focusin",()=>clearTimeout(state.timer));
      node.addEventListener("focusout",schedule);
      node.append(button("×","关闭分类提示",remove)); schedule();
    }
    this.feedback.append(node);
    this.renderReviewedViews();
    return node;
  }
  private async performReview(item: WidgetItem, request: ReviewRequest): Promise<WidgetItem | undefined> {
    if(this.quickBusy.has(item.id) || this.destroyed) return;
    const pending=this.pendingReviews.get(item.id);
    if(pending && pending.request_id!==request.request_id) return;
    this.quickBusy.add(item.id);this.pendingReviews.set(item.id,request);
    ++this.reviewEpoch;
    this.secretaryNeedsSync = true;
    this.reviewReceipts.delete(item.id);
    this.invalidatePages(true);
    this.workbench?.invalidateSecretary(false);
    this.feedbackFor(item,"正在提交到秘书AI…",true);
    try {
      const result=await submitReview(request);
      this.pendingReviews.delete(item.id);
      if(this.destroyed) return result.item;
      this.applyReviewedItem(result.item);
      this.reviewReceipts.set(item.id, {item: result.item, request});
      this.showUndo(result.item,request.action === "undo" ? undefined : request.action,
        `${this.confirmedMessage(result.item,request)}；正在刷新组件列表…`, true);
      this.workbench?.invalidateSecretary(true);
      await this.refreshSecretary(result.revision);
      return result.item;
    } catch(error) {
      if(this.destroyed) return;
      const conflict=error instanceof WidgetAPIError && ["revision_conflict","request_id_conflict"].includes(error.code);
      if(conflict) {
        this.pendingReviews.delete(item.id);
        try {item = error.currentItem ?? (await getReviewItem(item.id)).item;this.applyReviewedItem(item);} catch {}
      }
      const node=this.feedbackFor(item,conflict ? "记录已被其他窗口更新，本次未覆盖；请核对后再操作" : `提交结果未确认：${this.message(error)}；不会当作已保存`,true);
      node.append(button(conflict?"核对记录":"重试同一请求",conflict?"核对冲突记录":"重试未确认的分类请求",()=>{if(conflict)this.openReview(item);else void this.performReview(item,request);}));
      this.workbench?.invalidateSecretary(true);
      void this.refreshSecretary();
    } finally {this.quickBusy.delete(item.id);if(!this.destroyed)this.renderReviewedViews();}
  }
  private async quickReview(item: WidgetItem, status: "active" | "completed" | "cancelled" | "observing") {
    if (this.quickBusy.has(item.id) || !item.review_revision) return;
    if (this.pendingReviews.has(item.id)) {this.openReview(item); return;}
    if(item.manual_status === status) { this.briefFeedback(item);return; }
    await this.performReview(item,{request_id:crypto.randomUUID(),item_id:item.id,expected_revision:item.review_revision,action:"status",status});
  }
  private openReview(initial: WidgetItem) {
    let item = initial,
      pending = this.pendingReviews.get(initial.id),
      busy = false;
    this.dialog.replaceChildren();
    const title = element("h2", "", item.title),
      message = element("p", "iw-review-message"),
      form = element("div", "iw-review-form"),
      status = element("select"),
      project = element("select");
    const choose = element("option", "", "请选择人工状态（尚未设置）");
    choose.value = "";
    choose.disabled = true;
    status.append(choose);
    for (const [value, label] of [
      ["active", "要做"],
      ["completed", "完成"],
      ["cancelled", "不需要"],
      ["observing", "观察"],
    ]) {
      const o = element("option", "", label);
      o.value = value;
      status.append(o);
    }
    status.value = ["active", "completed", "cancelled", "observing"].includes(
      item.manual_status ?? item.status,
    )
      ? (item.manual_status ?? item.status)
      : "";
    const empty = element("option", "", "取消项目归属");
    empty.value = "";
    project.append(empty);
    for (const p of this.catalog?.projects ?? [])
      if (p.source_id === "secretary") {
        const o = element("option", "", p.name);
        o.value = p.name;
        project.append(o);
      }
    project.value = item.manual_project_is_set
      ? (item.manual_project ?? "")
      : (item.project_name ?? "");
    const field = (label: string, input: HTMLElement) => {
      const l = element("label", "", label);
      input.setAttribute("aria-label", label);
      l.append(input);
      return l;
    };
    const close = button("关闭", "关闭人工分类", () => this.dialog.close());
    const run = async (request: ReviewRequest) => {
      if(busy || this.quickBusy.has(item.id)) return;
      busy=true;pending=request;setDisabled(true);message.textContent="正在提交到秘书AI…";
      const result=await this.performReview(item,request);
      if(result) {
        item=result;
        status.value=["active","completed","cancelled","observing"].includes(item.manual_status ?? item.status) ? (item.manual_status ?? item.status) : "";
        project.value=item.manual_project_is_set ? (item.manual_project ?? "") : (item.project_name ?? "");
      }
      item=this.latestReviews.get(item.id) ?? item;
      pending=this.pendingReviews.get(item.id);
      message.textContent=this.reviewMessages.get(item.id) ?? "请核对秘书的最新记录";
      busy=false;setDisabled(false);
    };
    const make = (
      action: "status" | "project" | "undo",
      fieldName?: "status" | "project",
    ) => {
      if (!item.review_revision) return;
      if (action === "status" && !status.value) {
        message.textContent = "请先选择一个人工状态。";
        return;
      }
      if(action === "status" && item.manual_status === status.value) {
        message.textContent=`秘书已确认的人工状态就是“${businessLabel(status.value)}”，无需重复提交`;return;
      }
      const base = {
        request_id: crypto.randomUUID(),
        item_id: item.id,
        expected_revision: item.review_revision,
      };
      const request: ReviewRequest =
        action === "status"
          ? {
              ...base,
              action,
              status: status.value as
                "active" | "completed" | "cancelled" | "observing",
            }
          : action === "project"
            ? { ...base, action, project: project.value }
            : { ...base, action, field: fieldName! };
      void run(request);
    };
    const saveStatus = button("保存状态", "保存人工状态", () => make("status")),
      saveProject = button("保存归属", "保存人工项目归属", () =>
        make("project"),
      );
    const undoStatus = button("撤销上次状态分类", "撤销人工状态", () =>
        make("undo", "status"),
      ),
      undoProject = button("撤销上次项目分类", "撤销人工项目归属", () =>
        make("undo", "project"),
      );
    const retry = button("重试同一请求", "重试未确认的分类请求", () => {
      if (pending) void run(pending);
    });
    const setDisabled = (value: boolean) => {
      status.disabled = project.disabled = value || !!pending;
      saveStatus.disabled = saveProject.disabled = value || !!pending;
      undoStatus.disabled = value || !!pending || !item.can_undo?.status;
      undoProject.disabled = value || !!pending || !item.can_undo?.project;
      retry.hidden = !pending;
      retry.disabled = value;
      close.disabled = value;
    };
    form.append(
      field("人工状态", status),
      saveStatus,
      field("项目归属", project),
      saveProject,
      undoStatus,
      undoProject,
      retry,
    );
    this.dialog.append(close, title, form, message);
    if (pending)
      message.textContent = "此事项有尚未确认的请求，请先重试同一请求。";
    setDisabled(false);
    if (!this.dialog.open) this.dialog.showModal();
  }
  private showUndo(item: WidgetItem, field?: "status" | "project", message = "秘书已确认", persistent = false) {
    const notice=this.feedbackFor(item,message,persistent);
    if(field && item.can_undo?.[field]) {
      notice.append(button("撤销","撤销刚才的分类",()=>void this.performReview(item,{request_id:crypto.randomUUID(),item_id:item.id,expected_revision:item.review_revision!,action:"undo",field})));
    }
    return notice;
  }
  private renderSecretary(
    root: HTMLElement,
    item: WidgetItem,
    topic: WidgetId,
  ): void {
    const head = element("div", "iw-entry-heading");
    head.append(element("h3", "", item.title));
    if (topic !== "projects" && item.group)
      head.append(
        element("span", "iw-muted", groupNames[item.group] ?? item.group),
      );
    root.append(head);
    if (topic === "projects") {
      paragraph(root, "", businessLabel(item.phase || item.status), "iw-phase");
      paragraph(root, "", item.focus, "iw-focus");
      if (item.highlight) {
        const h = element("div", "iw-highlight");
        h.append(
          element("span", "iw-label", item.highlight.label),
          element("strong", "", item.highlight.value),
        );
        paragraph(h, "", item.highlight.note, "iw-caution");
        root.append(h);
      }
      paragraph(root, "", item.summary);
      paragraph(root, "", item.context, "iw-muted");
      if (item.facts?.length) {
        const dl = element("dl", "iw-facts");
        for (const f of item.facts) {
          const row = element("div");
          row.append(element("dt", "", f.label), element("dd", "", f.value));
          dl.append(row);
        }
        root.append(dl);
      }
      paragraph(root, "卡点", item.blocker, "iw-warning");
      paragraph(root, "同时关注", item.secondary);
      paragraph(root, "下一步", item.next_action, "iw-next");
      paragraph(root, "注意", item.caution, "iw-caution");
      if (item.focus_needs_review)
        paragraph(
          root,
          "",
          "阶段已有人工调整；旧重点不作为当前结论。",
          "iw-caution",
        );
    } else {
      if (item.project_name)
        paragraph(root, "项目", item.project_name, "iw-phase");
      if (item.due_at)
        paragraph(
          root,
          "安排",
          formatSourceDate(item.due_at, item.all_day),
          "iw-due",
        );
      paragraph(root, "", item.summary);
    }
    this.renderEvidence(root, item);
  }
  private renderSolar(
    root: HTMLElement,
    item: WidgetItem,
    topic: WidgetId,
  ): void {
    const head = element("div", "iw-entry-heading");
    head.append(
      element("h3", "", item.project_name || item.title),
      badge(item.status),
    );
    root.append(head);
    paragraph(root, "", item.summary);
    const data = item.data;
    if (!data) {
      paragraph(root, "", "主题内容尚未接入。", "iw-warning");
      this.renderEvidence(root, item);
      return;
    }
    if (data.source_mode === "demo" || item.status === "demo")
      paragraph(root, "", "演示记录，不计入真实汇总。", "iw-warning");
    if (data.date) paragraph(root, "数据日期", data.date, "iw-phase");
    if (data.data_complete !== undefined)
      paragraph(
        root,
        "数据完整性",
        data.data_complete === true
          ? "来源标记完整"
          : data.data_complete === false
            ? "来源标记不完整"
            : "未知",
        "iw-muted",
      );
    if (topic === "solar.alerts" && data.coverage_status !== "verified")
      paragraph(
        root,
        "",
        "告警覆盖尚未确认。留存条目不是当前全部告警，没有条目也不等于无异常。",
        "iw-warning",
      );
    metrics(root, data.metrics);
    if (data.note && data.note !== item.summary)
      paragraph(root, "", data.note, "iw-caution");
    if (topic === "solar.trend") this.renderPoints(root, data.points, item.id);
    if (topic === "solar.devices" || topic === "solar.alerts") {
      const details = element("details", "iw-details");
      details.dataset.detailKey = `nested-${item.id}`;
      details.append(
        element(
          "summary",
          "",
          `${topic === "solar.devices" ? "设备" : "告警"}留存明细 · ${data.items.length} 条`,
        ),
      );
      if (!data.items.length)
        paragraph(
          details,
          "",
          topic === "solar.alerts" && data.coverage_status !== "verified"
            ? "尚无可确认的告警明细，不能判断无异常。"
            : "本次来源记录未包含明细。",
          "iw-muted",
        );
      for (const child of data.items.slice(0, 100)) {
        const row = element("div", "iw-subentry");
        row.append(element("h4", "", child.title));
        paragraph(row, "来源状态", child.status);
        if (topic === "solar.devices") {
          paragraph(
            row,
            "通信 / 运行 / 数据",
            [
              child.communication_status ?? "未知",
              child.operating_status ?? "未知",
              child.data_freshness ?? "未知",
            ].join(" / "),
          );
          if (child.power_kw !== undefined)
            paragraph(row, "功率", formatMetric(child.power_kw, "kW"));
        } else {
          paragraph(row, "级别", child.severity ?? "未知");
          paragraph(
            row,
            "触发",
            formatSourceDate(child.raised_at ?? child.triggered_at),
          );
          paragraph(row, "恢复", formatSourceDate(child.recovered_at));
          paragraph(row, "最后观察", formatSourceDate(child.last_seen_at));
        }
        if (child.updated_at)
          paragraph(
            row,
            "来源时间",
            formatSourceDate(child.updated_at),
            "iw-muted",
          );
        if (child.source_url)
          row.append(sourceLink("查看明细 ↗", child.source_url));
        details.append(row);
      }
      if (data.items.length > 100)
        paragraph(
          details,
          "",
          `此处显示前 100 / ${data.items.length} 条，请进入原站查看完整明细。`,
          "iw-caution",
        );
      root.append(details);
    }
    this.renderEvidence(root, item);
  }
  private renderPoints(
    root: HTMLElement,
    points: Point[],
    record: string,
  ): void {
    const details = element("details", "iw-details");
    details.dataset.detailKey = `points-${record}`;
    const visible = points.slice(-96);
    details.append(
      element(
        "summary",
        "",
        `趋势采样 · 显示最近 ${visible.length} / ${points.length} 点`,
      ),
    );
    paragraph(
      details,
      "",
      "保留实际日期、单位和采样口径。小时参考值不是实时实测；缺失点不补零。",
      "iw-caution",
    );
    if (!points.length)
      paragraph(details, "", "来源尚未提供采样点。", "iw-muted");
    else {
      const wrap = element("div", "iw-table-wrap"),
        table = element("table", "iw-table"),
        caption = element("caption", "", "趋势来源采样（上海时区）"),
        header = element("thead"),
        tr = element("tr");
      for (const label of [
        "时间",
        "数值",
        "口径 / 质量",
        "可用小计 / 缺失设备",
      ]) {
        const th = element("th", "", label);
        th.scope = "col";
        tr.append(th);
      }
      header.append(tr);
      const body = element("tbody");
      for (const point of visible) {
        const row = element("tr");
        row.append(
          element("td", "", formatSourceDate(point.at)),
          element("td", "", formatMetric(point.value, point.unit)),
          element(
            "td",
            "",
            `${point.series === "hourly_reference" ? "小时参考" : point.series === "realtime" ? "实时采样" : (point.series ?? "口径未知")} / ${point.quality ?? "质量未知"}`,
          ),
          element(
            "td",
            "",
            `${formatMetric(point.available_value, point.unit)} / ${formatMetric(point.missing_device_count, "台")}`,
          ),
        );
        body.append(row);
      }
      table.append(caption, header, body);
      wrap.append(table);
      details.append(wrap);
    }
    root.append(details);
  }
  private renderEvidence(root: HTMLElement, item: WidgetItem): void {
    const meta = element("div", "iw-evidence");
    meta.append(
      element(
        "span",
        "",
        `依据 ${formatSourceDate(item.evidence_at ?? item.updated_at)}`,
      ),
      sourceLink("进展与依据 ↗", item.source_url),
    );
    root.append(meta);
    const details = element("details", "iw-details iw-trace");
    details.dataset.detailKey = `evidence-${item.id}`;
    details.append(
      element(
        "summary",
        "",
        `来源记录 · ${item.source_refs.length} 条关联依据${item.revision !== undefined ? ` · 修订 ${item.revision}` : ""}`,
      ),
    );
    paragraph(details, "记录 ID", item.id);
    if (item.project_id) paragraph(details, "项目 ID", item.project_id);
    if (item.coverage)
      for (const [key, label] of Object.entries(coverageNames))
        if (item.coverage[key] !== undefined)
          paragraph(
            details,
            label,
            typeof item.coverage[key] === "number"
              ? formatMetric(item.coverage[key] as number, "份/条")
              : "未知",
          );
    for (const ref of item.source_refs.slice(0, 12))
      paragraph(
        details,
        "",
        typeof ref === "string"
          ? ref
          : `${ref.source_id} / ${ref.record_id}${ref.revision !== undefined ? ` / 修订 ${ref.revision}` : ""}`,
        "iw-trace-id",
      );
    if (item.source_refs.length > 12)
      paragraph(
        details,
        "",
        `另有 ${item.source_refs.length - 12} 条，完整依据请到原系统。`,
        "iw-muted",
      );
    root.append(details);
  }
}
