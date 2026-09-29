import type { Point } from "./secretary-client";

export interface ChartSample {
  time: number;
  value: number | null;
  quality?: string;
}
export interface ChartSeries {
  name: string;
  samples: ChartSample[];
  segments: { time: number; value: number }[][];
  gaps: number;
}
export interface ChartGroup {
  unit: string;
  series: ChartSeries[];
  minTime: number;
  maxTime: number;
  minValue: number;
  maxValue: number;
  unknownDates: number;
}

/** No interpolation, aggregation across units, or substitution of available_value for missing totals. */
export function buildChartGroups(points: Point[]): ChartGroup[] {
  const units = new Map<
    string,
    { series: Map<string, ChartSample[]>; unknownDates: number }
  >();
  for (const point of points) {
    let unit = units.get(point.unit);
    if (!unit) {
      unit = { series: new Map(), unknownDates: 0 };
      units.set(point.unit, unit);
    }
    const time = point.at ? Date.parse(point.at) : NaN;
    if (!Number.isFinite(time)) {
      unit.unknownDates++;
      continue;
    }
    const name = point.series || "观测值";
    const samples = unit.series.get(name) || [];
    samples.push({
      time,
      value:
        typeof point.value === "number" && Number.isFinite(point.value)
          ? point.value
          : null,
      quality: point.quality,
    });
    unit.series.set(name, samples);
  }
  return [...units].map(([unit, data]) => {
    const series: ChartSeries[] = [...data.series].map(([name, samples]) => {
      samples.sort((a, b) => a.time - b.time);
      const segments: ChartSeries["segments"] = [];
      let segment: ChartSeries["segments"][number] = [];
      for (const sample of samples) {
        if (sample.value === null) {
          if (segment.length) segments.push(segment);
          segment = [];
        } else segment.push({ time: sample.time, value: sample.value });
      }
      if (segment.length) segments.push(segment);
      return {
        name,
        samples,
        segments,
        gaps: samples.filter((p) => p.value === null).length,
      };
    });
    const samples = series.flatMap((s) => s.samples),
      values = samples.flatMap((p) => (p.value === null ? [] : [p.value]));
    const times = samples.map((p) => p.time);
    return {
      unit,
      series,
      unknownDates: data.unknownDates,
      minTime: times.length ? Math.min(...times) : 0,
      maxTime: times.length ? Math.max(...times) : 0,
      minValue: values.length ? Math.min(0, ...values) : 0,
      maxValue: values.length ? Math.max(0, ...values) : 0,
    };
  });
}
const SVG_NS = "http://www.w3.org/2000/svg";
const colors = ["#546b62", "#a07445", "#586b93", "#8c6376", "#737d3f"];
const instantStamp = (time: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(time);
const number = (value: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value);
export function renderWidgetChart(
  root: HTMLElement,
  points: Point[],
  label = "实际曲线",
): void {
  const dated = points
    .map((p) => p.at)
    .filter((at): at is string => Boolean(at));
  const monthOnly =
    dated.length > 0 && dated.every((at) => /^\d{4}-\d{2}$/.test(at));
  const dayOnly =
    dated.length > 0 && dated.every((at) => /^\d{4}-\d{2}-\d{2}$/.test(at));
  const stamp = (time: number) =>
    monthOnly
      ? new Date(time).toISOString().slice(0, 7)
      : dayOnly
        ? new Date(time).toISOString().slice(0, 10)
        : instantStamp(time);
  root.replaceChildren();
  root.classList.add("iw-chart");
  const doc = root.ownerDocument;
  const text = (tag: string, value: string, cls = "") => {
    const node = doc.createElement(tag);
    node.textContent = value;
    if (cls) node.className = cls;
    return node;
  };
  const svg = <K extends keyof SVGElementTagNameMap>(
    tag: K,
    attributes: Record<string, string> = {},
  ): SVGElementTagNameMap[K] => {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes))
      node.setAttribute(key, value);
    return node;
  };
  const groups = buildChartGroups(points);
  if (!groups.length) {
    root.append(text("p", "暂无实际曲线数据", "iw-chart-empty"));
    return;
  }
  for (const group of groups) {
    const section = text("section", "", "iw-chart-unit");
    section.append(text("strong", `${label} · ${group.unit || "单位未提供"}`));
    const known = group.series
      .flatMap((s) => s.samples)
      .filter((p) => p.value !== null);
    const gaps = group.series.reduce((sum, s) => sum + s.gaps, 0);
    if (!known.length) {
      section.append(
        text(
          "p",
          `暂无可绘制的有效值${gaps ? ` · ${gaps} 个缺测点` : ""}${group.unknownDates ? ` · ${group.unknownDates} 点时间未知` : ""}`,
          "iw-chart-empty",
        ),
      );
      root.append(section);
      continue;
    }
    const frame = svg("svg", {
      viewBox: "0 0 480 164",
      role: "img",
      "aria-label": `${label}，单位 ${group.unit || "未知"}，${stamp(group.minTime)} 至 ${stamp(group.maxTime)}，${gaps} 个缺测点`,
    });
    frame.style.width = "100%";
    frame.style.display = "block";
    const left = 54,
      top = 12,
      width = 414,
      height = 118;
    const x = (time: number) =>
      group.maxTime === group.minTime
        ? left + width / 2
        : left +
          ((time - group.minTime) / (group.maxTime - group.minTime)) * width;
    const span = group.maxValue - group.minValue || 1;
    const y = (value: number) =>
      top + height - ((value - group.minValue) / span) * height;
    for (const value of [
      group.minValue,
      group.minValue + span / 2,
      group.minValue + span,
    ]) {
      frame.append(
        svg("line", {
          x1: String(left),
          x2: String(left + width),
          y1: String(y(value)),
          y2: String(y(value)),
          stroke: "currentColor",
          opacity: ".15",
        }),
      );
      const tick = svg("text", {
        x: "48",
        y: String(y(value) + 4),
        "text-anchor": "end",
        "font-size": "11",
        fill: "currentColor",
      });
      tick.textContent = number(value);
      frame.append(tick);
    }
    group.series.forEach((series, index) => {
      const color = colors[index % colors.length];
      for (const segment of series.segments) {
        frame.append(
          svg("polyline", {
            points: segment.map((p) => `${x(p.time)},${y(p.value)}`).join(" "),
            fill: "none",
            stroke: color,
            "stroke-width": "2",
            "vector-effect": "non-scaling-stroke",
            "stroke-dasharray": index >= colors.length ? "5 3" : "none",
          }),
        );
        // Sample markers remain visible for a lone reading; title exposes real values.
        for (const p of segment.length > 150
          ? [segment[0], segment[segment.length - 1]]
          : segment) {
          const dot = svg("circle", {
            cx: String(x(p.time)),
            cy: String(y(p.value)),
            r: segment.length > 150 ? "1" : "2",
            fill: color,
          });
          const title = svg("title");
          title.textContent = `${series.name} · ${stamp(p.time)} · ${number(p.value)} ${group.unit}`;
          dot.append(title);
          frame.append(dot);
        }
      }
      for (const p of series.samples.filter((p) => p.value === null))
        frame.append(
          svg("line", {
            x1: String(x(p.time)),
            x2: String(x(p.time)),
            y1: "12",
            y2: "130",
            stroke: color,
            opacity: ".25",
            "stroke-dasharray": "2 4",
          }),
        );
    });
    for (const [time, anchor] of [
      [group.minTime, "start"],
      [group.maxTime, "end"],
    ] as const) {
      const tick = svg("text", {
        x: anchor === "start" ? "54" : "468",
        y: "153",
        "text-anchor": anchor,
        "font-size": "11",
        fill: "currentColor",
      });
      tick.textContent = stamp(time);
      frame.append(tick);
    }
    section.append(frame);
    const legend = text("div", "", "iw-chart-legend");
    group.series.forEach((series, index) => {
      const entry = text(
        "span",
        `● ${series.name} (${group.unit || "未知单位"})`,
      );
      entry.style.color = colors[index % colors.length];
      entry.style.marginInlineEnd = "12px";
      legend.append(entry);
    });
    section.append(legend);
    const dates = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    section.append(
      text(
        "small",
        `${monthOnly || dayOnly ? stamp(group.minTime) : dates.format(group.minTime)}—${monthOnly || dayOnly ? stamp(group.maxTime) : dates.format(group.maxTime)} · ${monthOnly ? "月份统计" : dayOnly ? "日期统计" : "上海时间"}${gaps ? ` · ${gaps} 个缺测点（断线／虚线）` : ""}${group.unknownDates ? ` · ${group.unknownDates} 点时间未知，未绘制` : ""}`,
        "iw-chart-note",
      ),
    );
    root.append(section);
  }
}
