import { useMemo } from "react";
import type { EChartsCoreOption } from "../charts/echarts";
import { useT } from "../i18n";
import type { UsageBreakdown, UsageTrendPoint } from "../types";
import { formatCount } from "../utils/usageFormat";
import EChart, { type ChartPalette } from "./EChart";

interface TrendChartProps {
  points: UsageTrendPoint[];
}

interface BreakdownChartProps {
  rows: UsageBreakdown[];
}

function baseOption(palette: ChartPalette): EChartsCoreOption {
  return {
    animation: !palette.reducedMotion,
    animationDuration: 900,
    animationDurationUpdate: 420,
    animationEasing: "cubicOut",
    aria: { enabled: true },
    backgroundColor: "transparent",
    textStyle: {
      color: palette.text,
      fontFamily: '"Source Sans 3", system-ui, sans-serif',
      fontSize: 11,
    },
  };
}

function axisStyle(palette: ChartPalette) {
  return {
    axisLabel: { color: palette.muted, fontSize: 10, hideOverlap: true },
    axisLine: { lineStyle: { color: palette.border } },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: palette.border, opacity: 0.72 } },
  };
}

function timeSeries(points: UsageTrendPoint[], field: keyof UsageTrendPoint): Array<[string, number]> {
  return points.map((point) => [point.bucket, Number(point[field] ?? 0)]);
}

function timeLabel(value: number): string {
  return formatCount(value);
}

export function ActivityChart({ points }: TrendChartProps) {
  const t = useT();
  const requestsLabel = t("usage.stats.requests");
  const tokensLabel = t("usage.stats.tokens");
  const ariaLabel = t("usage.chart.activityTitle");
  const buildOption = useMemo(() => (palette: ChartPalette): EChartsCoreOption => ({
    ...baseOption(palette),
    color: [palette.accentStrong, palette.ok],
    grid: { left: 10, right: 10, top: 46, bottom: 10, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    legend: {
      top: 6,
      right: 6,
      itemHeight: 8,
      itemWidth: 16,
      textStyle: { color: palette.muted, fontSize: 10 },
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      renderMode: "richText",
      valueFormatter: (value: unknown) => formatCount(Number(value)),
    },
    xAxis: {
      ...axisStyle(palette),
      type: "time",
      boundaryGap: false,
      splitLine: { show: false },
    },
    yAxis: [
      {
        ...axisStyle(palette),
        type: "value",
        minInterval: 1,
        axisLabel: { color: palette.muted, fontSize: 10, formatter: timeLabel },
      },
      {
        ...axisStyle(palette),
        type: "value",
        axisLabel: { color: palette.muted, fontSize: 10, formatter: timeLabel },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: requestsLabel,
        type: "line",
        yAxisIndex: 0,
        data: timeSeries(points, "request_count"),
        showSymbol: false,
        smooth: 0.24,
        sampling: "lttb",
        lineStyle: { width: 2.2 },
        areaStyle: { opacity: 0.08 },
        emphasis: { focus: "series" },
      },
      {
        name: tokensLabel,
        type: "line",
        yAxisIndex: 1,
        data: timeSeries(points, "total_tokens"),
        showSymbol: false,
        smooth: 0.24,
        sampling: "lttb",
        lineStyle: { width: 2.2 },
        areaStyle: { opacity: 0.055 },
        emphasis: { focus: "series" },
      },
    ],
  }), [points, requestsLabel, tokensLabel]);

  return <EChart ariaLabel={ariaLabel} buildOption={buildOption} className="dashboard-main-chart" />;
}

export function TokenCompositionChart({ points }: TrendChartProps) {
  const t = useT();
  const labels = {
    input: t("usage.stats.input"),
    output: t("usage.stats.output"),
    reasoning: t("usage.stats.reasoning"),
    cache: t("usage.stats.cacheRead"),
  };
  const ariaLabel = t("usage.chart.tokenComposition");
  const buildOption = useMemo(() => (palette: ChartPalette): EChartsCoreOption => ({
    ...baseOption(palette),
    color: [palette.accentStrong, palette.ok, palette.warn, palette.muted],
    grid: { left: 10, right: 10, top: 50, bottom: 10, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    legend: {
      top: 5,
      right: 5,
      itemHeight: 8,
      itemWidth: 14,
      textStyle: { color: palette.muted, fontSize: 10 },
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      renderMode: "richText",
      valueFormatter: (value: unknown) => formatCount(Number(value)),
    },
    xAxis: { ...axisStyle(palette), type: "time", boundaryGap: false, splitLine: { show: false } },
    yAxis: {
      ...axisStyle(palette),
      type: "value",
      axisLabel: { color: palette.muted, fontSize: 10, formatter: timeLabel },
    },
    series: [
      { name: labels.input, type: "line", data: timeSeries(points, "input_tokens"), showSymbol: false, smooth: 0.22, sampling: "lttb", lineStyle: { width: 2 }, emphasis: { focus: "series" } },
      { name: labels.output, type: "line", data: timeSeries(points, "output_tokens"), showSymbol: false, smooth: 0.22, sampling: "lttb", lineStyle: { width: 2 }, emphasis: { focus: "series" } },
      { name: labels.reasoning, type: "line", data: timeSeries(points, "reasoning_tokens"), showSymbol: false, smooth: 0.22, sampling: "lttb", lineStyle: { width: 2 }, emphasis: { focus: "series" } },
      { name: labels.cache, type: "line", data: timeSeries(points, "cache_read_tokens"), showSymbol: false, smooth: 0.22, sampling: "lttb", lineStyle: { width: 1.8, type: "dashed" }, emphasis: { focus: "series" } },
    ],
  }), [labels.cache, labels.input, labels.output, labels.reasoning, points]);

  return <EChart ariaLabel={ariaLabel} buildOption={buildOption} className="dashboard-main-chart" />;
}

export function ModelShareChart({ rows }: BreakdownChartProps) {
  const t = useT();
  const ariaLabel = t("usage.chart.modelShare");
  const buildOption = useMemo(() => (palette: ChartPalette): EChartsCoreOption => ({
    ...baseOption(palette),
    color: [palette.accentStrong, palette.ok, palette.warn, palette.danger, palette.muted],
    legend: {
      type: "scroll",
      bottom: 2,
      left: "center",
      itemHeight: 8,
      itemWidth: 10,
      textStyle: { color: palette.muted, fontSize: 9 },
    },
    tooltip: { trigger: "item", confine: true, renderMode: "richText", formatter: "{b}\n{c} Token · {d}%" },
    series: [{
      type: "pie",
      radius: ["54%", "78%"],
      center: ["50%", "44%"],
      minAngle: 3,
      padAngle: 2,
      itemStyle: { borderColor: palette.panel, borderWidth: 2, borderRadius: 3 },
      label: { show: false },
      emphasis: { scaleSize: 5, label: { show: true, color: palette.text, fontSize: 11, formatter: "{b}\n{d}%" } },
      data: rows.slice(0, 8).map((row) => ({ name: row.name, value: row.total_tokens })),
    }],
  }), [rows]);

  return <EChart ariaLabel={ariaLabel} buildOption={buildOption} className="dashboard-donut-chart" />;
}

export function KeyUsageChart({ rows }: BreakdownChartProps) {
  const t = useT();
  const ariaLabel = t("usage.chart.keyUsage");
  const visible = rows.slice(0, 8);
  const buildOption = useMemo(() => (palette: ChartPalette): EChartsCoreOption => ({
    ...baseOption(palette),
    color: [palette.accentStrong],
    grid: { left: 8, right: 12, top: 8, bottom: 8, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      confine: true,
      renderMode: "richText",
      valueFormatter: (value: unknown) => formatCount(Number(value)),
    },
    xAxis: {
      ...axisStyle(palette),
      type: "value",
      axisLabel: { color: palette.muted, fontSize: 10, formatter: timeLabel },
    },
    yAxis: {
      ...axisStyle(palette),
      type: "category",
      inverse: true,
      data: visible.map((row) => row.name),
      axisLabel: { color: palette.text, fontSize: 10, width: 92, overflow: "truncate" },
      splitLine: { show: false },
    },
    series: [{
      type: "bar",
      data: visible.map((row) => row.total_tokens),
      barMaxWidth: 18,
      itemStyle: { borderRadius: [0, 4, 4, 0] },
      emphasis: { focus: "series" },
      showBackground: true,
      backgroundStyle: { color: palette.border, opacity: 0.36, borderRadius: 4 },
    }],
  }), [visible]);

  return <EChart ariaLabel={ariaLabel} buildOption={buildOption} className="dashboard-bar-chart" />;
}

export function ProviderShareChart({ rows }: BreakdownChartProps) {
  const t = useT();
  const ariaLabel = t("usage.chart.providerShare");
  const buildOption = useMemo(() => (palette: ChartPalette): EChartsCoreOption => ({
    ...baseOption(palette),
    color: [palette.accentStrong, palette.ok, palette.warn, palette.danger, palette.muted],
    legend: {
      type: "scroll",
      bottom: 2,
      left: "center",
      itemHeight: 8,
      itemWidth: 10,
      textStyle: { color: palette.muted, fontSize: 9 },
    },
    tooltip: { trigger: "item", confine: true, renderMode: "richText", formatter: "{b}\n{c} · {d}%" },
    series: [{
      type: "pie",
      radius: ["48%", "72%"],
      center: ["50%", "43%"],
      minAngle: 4,
      padAngle: 3,
      itemStyle: { borderColor: palette.panel, borderWidth: 2, borderRadius: 3 },
      label: { show: true, color: palette.muted, fontSize: 9, formatter: "{b}  {d}%" },
      labelLine: { length: 6, length2: 6, lineStyle: { color: palette.border } },
      emphasis: { scaleSize: 5 },
      data: rows.slice(0, 8).map((row) => ({ name: row.name, value: row.request_count })),
    }],
  }), [rows]);

  return <EChart ariaLabel={ariaLabel} buildOption={buildOption} className="dashboard-donut-chart" />;
}
