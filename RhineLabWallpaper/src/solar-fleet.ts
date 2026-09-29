import {readWorkbenchJSON, widgetTitles, type WidgetId, type WidgetResponse, type WidgetItem} from "./secretary-client";
import {parseSolar, type SolarResponse} from "./widget-workbench-client";

export interface StationEnergy {
  station_code: string; name: string; value: number | null; unit: "kWh";
  updated_at: string | null; stale: boolean;
}
export interface FleetOverview extends SolarResponse {date: string; station_energy: StationEnergy[]}
export interface FleetItem extends WidgetItem {fleet_bars?: StationEnergy[]; fleet_scale?: number}
export const isFleetWidget = (id: WidgetId) => id === "solar.total" || id === "solar.stations";
export const stationPageSize = (width: number) => Math.max(1, Math.min(16, Math.floor((width - 16) / 94)));

export async function getFleetOverview(signal?: AbortSignal): Promise<FleetOverview> {
  const raw = await readWorkbenchJSON("solar/overview", new URLSearchParams(), signal) as Record<string, unknown>;
  const data = parseSolar(raw, "overview");
  const invalid = () => {throw new Error("全站统计格式不兼容，请重试。");};
  if (typeof raw.date !== "string" || !/^\d{4}-\d\d-\d\d$/.test(raw.date) || !Array.isArray(raw.station_energy) || raw.station_energy.length > 10000) return invalid();
  const seen = new Set<string>();
  const station_energy = raw.station_energy.map((v: unknown): StationEnergy => {
    if (!v || typeof v !== "object") return invalid();
    const s = v as Record<string, unknown>;
    if (typeof s.station_code !== "string" || !s.station_code || seen.has(s.station_code) || typeof s.name !== "string" || s.name.length > 240 || s.unit !== "kWh" || !(s.value === null || typeof s.value === "number" && Number.isFinite(s.value)) || typeof s.stale !== "boolean" || !(s.updated_at === null || typeof s.updated_at === "string" && Number.isFinite(Date.parse(s.updated_at)))) return invalid();
    seen.add(s.station_code);
    return {station_code:s.station_code, name:s.name, value:s.value as number | null, unit:"kWh", updated_at:s.updated_at as string | null, stale:s.stale};
  });
  return {...data, date:raw.date, station_energy};
}

/** Page the same overview snapshot locally. Bar axes use the full fleet maximum. */
export function fleetPage(data: FleetOverview, id: WidgetId, offset: number, width: number): WidgetResponse {
  const count = stationPageSize(width), bars = data.station_energy;
  const total = id === "solar.total" ? 2 : Math.max(1, Math.ceil(bars.length / count));
  offset = Math.max(0, Math.min(total - 1, offset));
  const reference = offset === 1, start = offset * count;
  const title = id === "solar.total" ? reference ? "小时参考 · 与实测分开" : "全站实测功率 · kW" : `各站当日累计 · kWh · ${bars.length ? start+1 : 0}–${Math.min(start+count,bars.length)} / ${bars.length} 站`;
  const item: FleetItem = {
    id:`${id}:${offset}`, project_id:null, title, project_name:title, summary:data.message,
    status:data.status, source_refs:[], source_url:"http://127.0.0.1:8765/",
    data:{date:data.date, source_mode:data.source_mode, data_complete:data.data_complete,
      source_updated_at:data.source_updated_at, metrics:data.metrics.filter(m=>m.key==="energy"), items:[],
      points:id === "solar.total" ? data.points.filter(p=>p.series?.includes("小时") === reference) : [],
      note:id === "solar.total" ? reference ? "小时电量折算参考；不拼接或替代实测总功率。" : "完整总功率缺测时仅展示可用小计，非完整总量。" : "全站共用纵轴；点柱子查看电站，缺测不补零。"},
  };
  if(id === "solar.stations") {
    item.fleet_bars=bars.slice(start,start+count);
    item.fleet_scale=Math.max(1,...bars.map(s=>s.value ?? 0));
    item.data!.note=`全站同轴 0–${new Intl.NumberFormat("zh-CN",{maximumFractionDigits:0}).format(item.fleet_scale)} kWh · 斜纹为旧读数 · 点柱子查看电站`;
  }
  return {schema_version:"1.0",widget_id:id,title:widgetTitles[id],status:data.status as WidgetResponse["status"],generated_at:data.fetched_at,data_updated_at:data.source_updated_at,timezone:"Asia/Shanghai",message:data.message,items:[item],metrics:[],points:[],source:{id:"solar-monitor",label:"光伏原站 · 全部电站"},total,truncated:total>1,pagination:{offset,limit:1,total,next_offset:offset+1<total?offset+1:null,has_more:offset+1<total}};
}

export function renderStationBars(root: HTMLElement, bars: StationEnergy[], maximum: number, open: (code:string)=>void) {
  root.classList.add("iw-station-bars");
  root.style.setProperty("--bar-count",String(Math.max(1,bars.length)));
  if(!bars.length){root.textContent="当前没有已接入电站";return;}
  for(const bar of bars) {
    const column=document.createElement("button");column.type="button";column.className="iw-station-bar";
    column.dataset.stationCode=bar.station_code;
    const number=bar.value===null?"缺测":new Intl.NumberFormat("zh-CN",{maximumFractionDigits:1}).format(bar.value);
    column.setAttribute("aria-label",`${bar.name}：${number} kWh${bar.stale?"，读数过期":""}，查看电站`);
    column.title=`${bar.name}\n${number} kWh\n${bar.updated_at ?? "时间未知"}${bar.stale?" · 读数过期":""}`;
    const value=document.createElement("span");value.className="iw-bar-value";value.textContent=number;
    const track=document.createElement("span");track.className="iw-bar-track";
    const fill=document.createElement("span");fill.className="iw-bar-fill";
    fill.style.height=bar.value===null?"100%":`${Math.max(bar.value===0?0:1,Math.min(100,bar.value/maximum*100))}%`;
    fill.dataset.missing=String(bar.value===null);fill.dataset.stale=String(bar.stale);track.append(fill);
    const label=document.createElement("span");label.className="iw-bar-label";label.textContent=bar.name;
    column.append(value,track,label);column.addEventListener("click",()=>open(bar.station_code));root.append(column);
  }
}
