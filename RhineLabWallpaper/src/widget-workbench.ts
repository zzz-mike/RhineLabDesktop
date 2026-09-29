import {
  getCatalog,
  formatSourceDate,
  formatMetric,
  WidgetAPIError,
  type WidgetItem,
  type WidgetCatalog,
  type WidgetId,
} from "./secretary-client";
import {
  getDetail,
  searchItems,
  saveProject,
  parseProjectState,
  getSolar,
  type DetailResponse,
  type DetailRow,
  type Page,
  type ProjectState,
  type ProjectReview,
  type SolarResource,
  type SolarResponse,
} from "./widget-workbench-client";
import { renderWidgetChart } from "./widget-chart";
import "./widget-workbench.css";
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  cls = "",
) => {
  const e = document.createElement(tag);
  e.textContent = text;
  e.className = cls;
  return e;
};
const btn = (label: string, action: () => void) => {
  const b = el("button", label);
  b.type = "button";
  b.addEventListener("click", action);
  return b;
};
const option = (value: string, label: string) => {
  const o = el("option", label);
  o.value = value;
  return o;
};
const select = (label: string, entries: [string, string][]) => {
  const s = el("select");
  s.setAttribute("aria-label", label);
  s.append(...entries.map(([value, text]) => option(value, text)));
  return s;
};
const field = (label: string, input: HTMLElement) => {
  const l = el("label", label);
  l.append(input);
  return l;
};
const message = (e: unknown) =>
  e instanceof Error ? e.message : "暂时未能读取，请重试。";
const statusNames: Record<string, string> = {
  healthy: "连接正常",
  degraded: "连接异常",
  fresh: "最新记录",
  stale: "旧数据",
  online: "在线",
  offline: "离线",
  normal: "正常",
  abnormal: "异常",
  unknown: "未知",
  unsupported: "不支持",
  disabled: "未启用",
  disconnected: "未连接",
};
const fieldValue = (label: string, value: string) =>
  ["连接状态", "数据时效", "通信", "运行"].includes(label)
    ? (statusNames[value] ?? value)
    : value;
const noteLabels: Record<keyof ProjectState["note"], string> = {
  stage: "进度",
  blocker: "卡点",
  next_step: "下一步",
  owner: "负责人",
};
const sectionLabels: Record<string, string> = {
  overview: "概览",
  evidence: "原始证据",
  history: "状态历史",
  progress: "项目进展",
  items: "项目事项",
  conversation: "往来会话",
  files: "文件核读",
  finance: "财务台账（只读）",
};
const solarLabels: Record<string, string> = {
  station: "站点与历史",
  period: "月 / 年统计",
  devices: "设备",
  alerts: "告警",
  reports: "已有报告",
  health: "采集健康",
};
export class WidgetWorkbench {
  private dialog = el("dialog", "", "iw-workbench");
  private title = el("h2");
  private nav = el("nav", "", "iw-wb-tabs");
  private controls = el("form", "", "iw-wb-controls");
  private status = el("p", "", "iw-wb-status");
  private content = el("div", "", "iw-wb-content");
  private pager = el("footer", "", "iw-wb-pager");
  private editor = el("section", "", "iw-wb-editor");
  private abort?: AbortController;
  private sequence = 0;
  private catalog?: WidgetCatalog;
  private solarCatalog?: SolarResponse;
  private detail?: DetailResponse;
  private drafts = new Map<string, ProjectState["note"]>();
  private pending = new Map<string, ProjectReview>();
  private busyProjects = new Set<string>();
  private reloadSecretary?: () => void;
  constructor(
    private review: (item: WidgetItem) => void,
    private changed: () => void,
  ) {
    this.dialog.setAttribute("aria-label", "信息工作台");
    this.status.setAttribute("role", "status");
    const head = el("header", "", "iw-wb-header");
    head.append(
      this.title,
      btn("关闭", () => this.close()),
    );
    const top = el("div", "", "iw-wb-top");
    top.append(head, this.nav);
    this.dialog.append(
      top,
      this.controls,
      this.status,
      this.editor,
      this.content,
      this.pager,
    );
    document.body.append(this.dialog);
    this.dialog.addEventListener("close", () => {
      this.abort?.abort();
      this.sequence++;
    });
    this.controls.addEventListener("submit", (e) => e.preventDefault());
    for (const name of ["wheel", "pointerdown", "keydown"])
      this.dialog.addEventListener(name, (e) => e.stopPropagation(), {
        passive: true,
      });
  }
  close() {
    this.abort?.abort();
    this.sequence++;
    this.dialog.close();
  }
  destroy() {
    this.close();
    this.dialog.remove();
  }
  invalidateSecretary(refresh: boolean) {
    if(!this.dialog.open || !this.reloadSecretary) return;
    this.abort?.abort(); ++this.sequence;
    if(refresh) this.reloadSecretary();
  }
  private open(title: string) {
    this.reloadSecretary = undefined;
    this.abort?.abort();
    this.sequence++;
    this.title.textContent = title;
    this.nav.replaceChildren();
    this.controls.replaceChildren();
    this.content.replaceChildren();
    this.pager.replaceChildren();
    this.editor.replaceChildren();
    this.status.textContent = "";
    if (!this.dialog.open) this.dialog.showModal();
  }
  private async read<T>(
    load: (signal: AbortSignal) => Promise<T>,
    done: (value: T) => void,
    onConflict?: () => void,
  ) {
    this.abort?.abort();
    const abort = new AbortController(),
      sequence = ++this.sequence;
    this.abort = abort;
    this.status.textContent = "正在读取，已有内容保持显示…";
    this.content.setAttribute("aria-busy", "true");
    try {
      const data = await load(abort.signal);
      if (sequence !== this.sequence || abort.signal.aborted) return;
      this.status.textContent = "";
      done(data);
    } catch (error) {
      if (sequence !== this.sequence || abort.signal.aborted) return;
      if (
        error instanceof WidgetAPIError &&
        error.code === "snapshot_changed" &&
        onConflict
      ) {
        this.status.textContent = "来源已更新，正在返回第一页…";
        onConflict();
      } else
        this.status.textContent = `${message(error)}${this.content.childElementCount ? " · 已保留上次内容" : ""}`;
    } finally {
      if (sequence === this.sequence)
        this.content.setAttribute("aria-busy", "false");
    }
  }
  private tabs(
    entries: [string, string][],
    active: string,
    choose: (id: string) => void,
  ) {
    this.nav.replaceChildren(
      ...entries.map(([id, label]) => {
        const b = btn(label, () => choose(id));
        b.setAttribute("aria-pressed", String(id === active));
        return b;
      }),
    );
  }
  private pagination(page: Page | undefined, change: (offset: number) => void) {
    this.pager.replaceChildren();
    if (!page) return;
    const previous = btn("上一页", () =>
        change(Math.max(0, page.offset - page.limit)),
      ),
      next = btn("下一页", () => change(page.next_offset!));
    previous.disabled = page.offset === 0;
    next.disabled = !page.has_more;
    this.pager.append(
      previous,
      el(
        "span",
        `${page.total ? Math.floor(page.offset / page.limit) + 1 : 0} / ${Math.ceil(page.total / page.limit)} · ${page.total} 条`,
      ),
      next,
    );
  }
  private rows(rows: DetailRow[]) {
    const list = el("div", "", "iw-wb-rows");
    for (const row of rows) {
      const card = el("article", "", "iw-wb-row");
      card.append(el("h3", row.title));
      if (row.body) card.append(el("p", row.body, "iw-wb-prose"));
      if (row.fields.length) {
        const dl = el("dl");
        for (const f of row.fields) {
          const pair = el("div");
          pair.append(
            el("dt", f.label),
            el("dd", fieldValue(f.label, f.value)),
          );
          dl.append(pair);
        }
        card.append(dl);
      }
      if (row.item) {
        const item = row.item;
        card.append(btn("事项详情", () => this.item(item)));
        if (item.review_revision)
          card.append(btn("人工分类", () => this.review(item)));
      }
      for (const [url, label] of [
        [row.preview_url, "预览已有报告"],
        [row.download_url, "下载已有报告"],
      ] as const)
        if (url) {
          const a = el("a", label);
          a.href = url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          card.append(a);
        }
      list.append(card);
    }
    if (!rows.length) list.append(el("p", "当前范围没有记录。"));
    return list;
  }
  search() {
    this.open("查找事项");
    const query = el("input");
    query.placeholder = "搜索已复核事项，含已完成和不需要";
    query.maxLength = 120;
    query.setAttribute("aria-label", "搜索事项");
    const status = select("事项状态", [
        ["all", "全部状态"],
        ["active", "要做"],
        ["waiting", "等待"],
        ["observing", "观察"],
        ["completed", "完成"],
        ["cancelled", "不需要"],
      ]),
      project = select("项目范围", [["", "全部项目"]]);
    let offset = 0,
      snapshot: string | undefined;
    const load = () =>
      void this.read(
        (signal) =>
          searchItems({
            query: query.value,
            status: status.value,
            project_id: project.value,
            offset,
            snapshot,
            signal,
          }),
        (data) => {
          snapshot = data.snapshot_revision;
          this.content.replaceChildren(
            this.rows(
              data.items.map((item) => ({
                id: item.id,
                title: item.title,
                body: item.summary || "",
                fields: [
                  { label: "项目", value: item.project_name || "未归属" },
                  {
                    label: "状态",
                    value:
                      (
                        {
                          active: "要做",
                          waiting: "等待",
                          observing: "观察",
                          completed: "完成",
                          cancelled: "不需要",
                        } as Record<string, string>
                      )[item.status] ?? item.status,
                  },
                ],
                item,
              })),
            ),
          );
          this.pagination(data.pagination, (at) => {
            offset = at;
            load();
          });
          this.status.textContent = data.message;
        },
        () => {
          offset = 0;
          snapshot = undefined;
          load();
        },
      );
    const submit = () => {
      offset = 0;
      snapshot = undefined;
      load();
    };
    this.controls.append(
      field("关键词", query),
      field("状态", status),
      field("项目", project),
      btn("搜索", submit),
    );
    query.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    status.addEventListener("change", submit);
    project.addEventListener("change", submit);
    const seq = this.sequence;
    void getCatalog()
      .then((c) => {
        if (seq !== this.sequence && !this.dialog.open) return;
        this.catalog = c;
        if (!project.isConnected) return;
        project.append(
          ...c.projects
            .filter((p) => p.source_id === "secretary")
            .map((p) => option(p.id, p.name)),
        );
      })
      .catch(() => {});
    this.reloadSecretary = () => {snapshot=undefined;load();};
    load();
  }
  item(item: WidgetItem) {
    this.openDetail("item", item.id, item.title);
  }
  project(id: string, title = "项目详情") {
    this.openDetail("project", id, title);
  }
  private openDetail(kind: "item" | "project", id: string, title: string) {
    this.open(title);
    let section = "overview",
      offset = 0,
      snapshot: string | undefined;
    const choices =
      kind === "item"
        ? ["overview", "evidence", "history"]
        : ["overview", "progress", "items", "conversation", "files", "finance"];
    const choose = (next: string) => {
      section = next;
      offset = 0;
      snapshot = undefined;
      this.editor.replaceChildren();
      load();
    };
    const load = () => {
      this.tabs(
        choices.map((id) => [id, sectionLabels[id]]),
        section,
        choose,
      );
      void this.read(
        (signal) => getDetail(kind, id, section, offset, snapshot, signal),
        (data) => {
          this.detail = data;
          snapshot = data.snapshot_revision;
          this.title.textContent = data.title;
          this.content.replaceChildren(this.rows(data.rows));
          this.pagination(data.pagination, (at) => {
            offset = at;
            load();
          });
          this.controls.replaceChildren(
            btn("刷新本页", () => {
              snapshot = undefined;
              load();
            }),
          );
          if (data.item?.review_revision)
            this.controls.append(
              btn("人工分类", () => this.review(data.item!)),
            );
          if (data.project) {
            const project = data.project;
            this.controls.append(
              btn("编辑项目便笺", () => this.editProject(project)),
              btn(project.pinned ? "取消项目置顶" : "置顶项目", () =>
                this.pinProject(project, () => {
                  snapshot = undefined;
                  load();
                }),
              ),
            );
          }
          if (section === "finance")
            this.status.textContent =
              "财务台账仅查看；来源未确认的到账、收入或收益不会补值。";
        },
        () => {
          offset = 0;
          snapshot = undefined;
          load();
        },
      );
    };
    this.reloadSecretary = () => {snapshot=undefined;load();};
    load();
  }
  private editProject(project: ProjectState) {
    this.editor.replaceChildren();
    if (project.note_redacted) {
      this.editor.append(el("p", "含隐藏内容，请回原站修改，避免覆盖原文。"));
      return;
    }
    const draft = this.drafts.get(project.project_id) ?? { ...project.note };
    this.drafts.set(project.project_id, draft);
    const fields = new Map<keyof ProjectState["note"], HTMLTextAreaElement>();
    for (const key of Object.keys(
      noteLabels,
    ) as (keyof ProjectState["note"])[]) {
      const input = el("textarea");
      input.value = draft[key];
      input.maxLength = 2000;
      input.rows = 2;
      input.setAttribute("aria-label", noteLabels[key]);
      input.addEventListener("input", () => {
        draft[key] = input.value;
        this.drafts.set(project.project_id, draft);
      });
      fields.set(key, input);
      this.editor.append(field(noteLabels[key], input));
    }
    const notice = el("p", "", "iw-wb-status"),
      compare = el("div", "", "iw-wb-conflict");
    let current = project,
      conflict = false;
    const lock = (busy: boolean) => {
      fields.forEach((e) => (e.disabled = busy));
      save.disabled = busy;
    };
    const save = btn("保存项目便笺", () => {
      if (conflict || current.note_redacted) return;
      const pending = this.pending.get(project.project_id);
      const request = pending ?? {
        request_id: crypto.randomUUID(),
        project_id: project.project_id,
        expected_revision: current.review_revision,
        action: "note" as const,
        note: { ...draft },
      };
      if (request.action !== "note") {
        notice.textContent = "有一项置顶结果未确认，请先处理置顶重试。";
        return;
      }
      void run(request);
    });
    const reload = btn("读取最新版本并保留草稿", () => {
      void getDetail("project", project.project_id, "overview")
        .then((data) => {
          if (!data.project) return;
          current = data.project;
          compare.replaceChildren(
            el("h4", "服务器最新便笺"),
            ...Object.keys(noteLabels).map((k) =>
              el(
                "p",
                `${noteLabels[k as keyof typeof noteLabels]}：${current.note[k as keyof typeof noteLabels] || "未填写"}`,
              ),
            ),
          );
          if (current.note_redacted) {
            lock(true);
            notice.textContent = "含隐藏内容，请回原站修改，避免覆盖原文。";
            return;
          }
          conflict = false;
          save.disabled = false;
          save.textContent = "确认以我的草稿保存";
          notice.textContent = "你的草稿仍保留，请对照最新内容后再点确认保存。";
        })
        .catch((e) => (notice.textContent = message(e)));
    });
    reload.hidden = true;
    const run = async (request: ProjectReview) => {
      if (this.busyProjects.has(project.project_id)) return;
      if (
        new TextEncoder().encode(JSON.stringify(request)).byteLength > 16384
      ) {
        notice.textContent = "便笺内容过长，请缩短后再保存。";
        return;
      }
      this.busyProjects.add(project.project_id);
      this.pending.set(project.project_id, request);
      lock(true);
      notice.textContent = "正在保存…";
      try {
        const result = await saveProject(request);
        current = result.project;
        this.pending.delete(project.project_id);
        this.drafts.delete(project.project_id);
        notice.textContent = result.duplicate
          ? "已确认先前保存结果"
          : "已保存到秘书，同一项目已更新";
        save.textContent = "保存项目便笺";
        this.changed();
      } catch (error) {
        if (
          error instanceof WidgetAPIError &&
          [
            "revision_conflict",
            "request_id_conflict",
            "note_redacted",
          ].includes(error.code)
        ) {
          this.pending.delete(project.project_id);
          if (error.currentProject) {
            try {
              current = parseProjectState(error.currentProject);
            } catch {}
          }
          if (error.code === "note_redacted")
            current = { ...current, note_redacted: true };
          conflict = true;
          reload.hidden = false;
          notice.textContent =
            "项目已被其他窗口修改。草稿保留，先读取最新版本再确认。";
        } else {
          notice.textContent = `保存结果未确认：${message(error)}。请重试同一请求。`;
          save.textContent = "重试同一保存请求";
        }
      } finally {
        this.busyProjects.delete(project.project_id);
        lock(false);
        save.disabled = conflict || current.note_redacted;
        fields.forEach(
          (e) =>
            (e.disabled =
              current.note_redacted || this.pending.has(project.project_id)),
        );
        if (current.note_redacted)
          notice.textContent = "含隐藏内容，请回原站修改，避免覆盖原文。";
      }
    };
    if (this.pending.get(project.project_id)?.action === "note") {
      save.textContent = "重试同一保存请求";
      fields.forEach((e) => (e.disabled = true));
    }
    this.editor.append(
      save,
      btn("收起编辑（保留草稿）", () => this.editor.replaceChildren()),
      notice,
      reload,
      compare,
    );
  }
  private async pinProject(project: ProjectState, reload: () => void) {
    if (this.busyProjects.has(project.project_id)) return;
    const pending = this.pending.get(project.project_id);
    if (pending && pending.action !== "pin") {
      this.status.textContent =
        "便笺保存结果尚未确认，请先重试或处理便笺冲突。";
      return;
    }
    const request: ProjectReview = pending ?? {
      request_id: crypto.randomUUID(),
      project_id: project.project_id,
      expected_revision: project.review_revision,
      action: "pin",
      pinned: !project.pinned,
    };
    this.pending.set(project.project_id, request);
    this.busyProjects.add(project.project_id);
    this.status.textContent = "正在保存置顶设置…";
    const view = this.sequence;
    try {
      await saveProject(request);
      this.pending.delete(project.project_id);
      this.changed();
      if (view === this.sequence && this.dialog.open) reload();
    } catch (error) {
      if (
        error instanceof WidgetAPIError &&
        ["revision_conflict", "request_id_conflict"].includes(error.code)
      ) {
        this.pending.delete(project.project_id);
        if (view === this.sequence && this.dialog.open)
          this.status.textContent = "置顶状态已变化，请刷新本页核对后再操作。";
      } else if (view === this.sequence && this.dialog.open)
        this.status.textContent = `结果未确认：${message(error)}。再次点击将重试同一请求。`;
    } finally {
      this.busyProjects.delete(project.project_id);
    }
  }
  solar(projectId?: string) {
    this.open("电站工作台");
    this.status.textContent = "正在读取电站目录…";
    void this.read(
      (signal) => getSolar("catalog", {}, signal),
      (catalog) => {
        this.solarCatalog = catalog;
        this.solarPage("station", projectId);
      },
    );
  }
  private solarPage(resource: SolarResource, projectId?: string) {
    const catalog = this.solarCatalog;
    if (!catalog) return;
    this.editor.replaceChildren();
    this.controls.replaceChildren();
    this.pager.replaceChildren();
    this.tabs(Object.entries(solarLabels), resource, (id) =>
      this.solarPage(id as SolarResource, projectId),
    );
    const station = select("电站", [
      ["", resource === "station" ? "请选择电站" : "全部电站"],
      ...(catalog.stations ?? []).map(
        (s) =>
          [s.station_code, `${s.name} · ${s.manufacturer}`] as [string, string],
      ),
    ]);
    const match = catalog.stations?.find(
      (s) => `solar:${s.manufacturer}:${s.station_code}` === projectId,
    );
    if (match) station.value = match.station_code;
    const group = select("电站分组", [
      ["", "全部分组"],
      ...(catalog.groups ?? []).map((g) => [g.id, g.name] as [string, string]),
    ]);
    const date = select("历史日期", [
      ["", "来源当前日期"],
      ...(catalog.available_dates ?? [])
        .slice()
        .reverse()
        .map((d) => [d, d] as [string, string]),
    ]);
    const periodType = select("统计周期", [
        ["monthly", "月统计"],
        ["yearly", "年统计"],
      ]),
      period = el("input");
    period.type = "month";
    period.value = (
      catalog.latest_date ?? new Date().toISOString().slice(0, 10)
    ).slice(0, 7);
    period.setAttribute("aria-label", "统计月份或年份");
    periodType.addEventListener("change", () => {
      period.type = periodType.value === "monthly" ? "month" : "number";
      period.value = (
        catalog.latest_date ?? new Date().toISOString().slice(0, 10)
      ).slice(0, periodType.value === "monthly" ? 7 : 4);
    });
    const deviceStatus = select("设备状态", [
      ["", "全部状态"],
      ["online", "在线"],
      ["offline", "离线"],
      ["stale", "旧数据"],
      ["unsupported", "不支持"],
      ["unknown", "未知"],
      ["normal", "正常"],
      ["abnormal", "异常"],
    ]);
    const alertStatus = select("告警状态", [
      ["all", "全部"],
      ["active", "记录中活动"],
      ["recovered", "已恢复"],
    ]);
    const type = el("input"),
      severity = el("input");
    type.setAttribute("aria-label", "设备类型");
    severity.setAttribute("aria-label", "告警等级");
    type.placeholder = "全部类型";
    severity.placeholder = "全部等级";
    type.maxLength = severity.maxLength = 80;
    let offset = 0;
    const params = () => {
      const p: Record<string, string> = {};
      if (["station", "period", "devices", "alerts"].includes(resource))
        p.station_code = station.value;
      if (["period", "devices", "alerts", "reports"].includes(resource))
        p.group = group.value;
      if (resource === "station") p.date = date.value;
      if (resource === "period") {
        p.period_type = periodType.value;
        p.period = period.value;
      }
      if (resource === "devices") {
        p.status = deviceStatus.value;
        p.type = type.value;
      }
      if (resource === "alerts") {
        p.status = alertStatus.value;
        p.severity = severity.value;
      }
      if (["devices", "alerts", "reports"].includes(resource)) {
        p.limit = "6";
        p.offset = String(offset);
      }
      return p;
    };
    const load = () => {
      if (resource === "station" && !station.value) {
        this.abort?.abort();
        this.sequence++;
        this.content.setAttribute("aria-busy", "false");
        this.status.textContent = "请选择一个电站，再查询历史日期与曲线。";
        this.content.replaceChildren();
        return;
      }
      void this.read(
        (signal) => getSolar(resource, params(), signal),
        (data) => {
          const top = el("section", "", "iw-wb-solar-summary");
          top.append(
            el("h3", data.title),
            el(
              "p",
              `${({ ok: "已接入", partial: "部分覆盖", disconnected: "未连接", empty: "当前无记录", stale: "旧数据", error: "读取失败" } as Record<string, string>)[data.status] ?? data.status}${data.source_mode === "demo" ? " · 演示数据" : ""} · 来源更新 ${data.source_updated_at ? formatSourceDate(data.source_updated_at) : "未知"}`,
            ),
            el("p", data.message),
          );
          if (data.historical)
            top.append(
              el(
                "p",
                data.current_state_saved === false
                  ? "历史日期：仅展示当时保存的记录，未保存的设备状态保持未知。"
                  : "历史日期：展示来源保存的记录。",
              ),
            );
          if (data.metrics.length) {
            const dl = el("dl");
            for (const m of data.metrics) {
              const pair = el("div");
              pair.append(
                el("dt", m.label),
                el(
                  "dd",
                  m.unit === "比例"
                    ? formatMetric(m.value === null ? null : m.value * 100, "%")
                    : formatMetric(m.value, m.unit),
                ),
              );
              dl.append(pair);
            }
            top.append(dl);
          }
          if (data.points.length) {
            const chart = el("div", "", "iw-wb-chart");
            const labels: Record<string, string> = {
              strict: "严格合计",
              available: "可用数据（非完整总计）",
              realtime: "实时记录",
              hourly_reference: "小时参考",
            };
            renderWidgetChart(
              chart,
              data.points.map((p) => ({
                ...p,
                series: labels[p.series ?? ""] ?? p.series,
              })),
              data.title,
            );
            top.append(chart);
          }
          this.content.replaceChildren(top, this.rows(data.rows));
          this.pagination(data.pagination, (at) => {
            offset = at;
            load();
          });
          if (resource === "alerts")
            this.status.textContent =
              "告警覆盖尚未核实；空列表不代表没有告警。";
        },
      );
    };
    if (["station", "period", "devices", "alerts"].includes(resource))
      this.controls.append(field("电站", station));
    if (["period", "devices", "alerts", "reports"].includes(resource))
      this.controls.append(field("分组", group));
    if (resource === "station") this.controls.append(field("历史日期", date));
    if (resource === "period")
      this.controls.append(
        field("周期", periodType),
        field("月份 / 年份", period),
      );
    if (resource === "devices")
      this.controls.append(field("状态", deviceStatus), field("类型", type));
    if (resource === "alerts")
      this.controls.append(field("状态", alertStatus), field("等级", severity));
    this.controls.append(
      btn("查询", () => {
        offset = 0;
        load();
      }),
    );
    load();
  }
}
