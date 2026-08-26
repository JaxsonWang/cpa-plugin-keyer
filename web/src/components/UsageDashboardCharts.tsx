import { useMemo } from "react";
import type { EChartsCoreOption } from "../charts/echarts";
import { useT } from "../i18n";
import type {
  UsageBreakdown,
  UsageHeatmapCell,
  UsageLatencyPoint,
  UsageTotals,
  UsageTrendPoint,
} from "../types";
import { cacheRateValue, formatCount, formatDuration, formatUSD } from "../utils/usageFormat";
import EChart, { type ChartPalette } from "./EChart";

interface TrendChartProps {
  points: UsageTrendPoint[];
  granularity?: "hour" | "day";
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

function rateSeries(points: UsageTrendPoint[], field: "request_count" | "total_tokens", granularity: "hour" | "day"): Array<[string, number]> {
  const minutes = granularity === "day" ? 1_440 : 60;
  return points.map((point) => [point.bucket, Number(point[field] ?? 0) / minutes]);
}

function timeLabel(value: number): string {
  return formatCount(value);
}

export function ActivityChart({ points, granularity = "hour" }: TrendChartProps) {
  const t = useT();
  const requestsLabel = "RPM";
  const tokensLabel = "TPM";
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
        data: rateSeries(points, "request_count", granularity),
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
        data: rateSeries(points, "total_tokens", granularity),
        showSymbol: false,
        smooth: 0.24,
        sampling: "lttb",
        lineStyle: { width: 2.2 },
        areaStyle: { opacity: 0.055 },
        emphasis: { focus: "series" },
      },
    ],
  }), [granularity, points, requestsLabel, tokensLabel]);

  return <EChart ariaLabel={ariaLabel} buildOption={buildOption} className="dashboard-main-chart" />;
}

export function LatencyTrendChart({ points }: TrendChartProps) {
  const t = useT();
  const latencyLabel = t("usage.stats.latency");
  const ttftLabel = t("usage.stats.ttft");
  const buildOption = useMemo(() => (palette: ChartPalette): EChartsCoreOption => ({
    ...baseOption(palette),
    color: [palette.accentStrong, palette.ok],
    grid: { left: 10, right: 10, top: 46, bottom: 10, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    legend: { top: 6, right: 6, itemHeight: 8, itemWidth: 16, textStyle: { color: palette.muted, fontSize: 10 } },
    tooltip: {
      trigger: "axis",
      confine: true,
      renderMode: "richText",
      valueFormatter: (value: unknown) => formatDuration(Number(value)),
    },
    xAxis: { ...axisStyle(palette), type: "time", boundaryGap: false, splitLine: { show: false } },
    yAxis: {
      ...axisStyle(palette),
      type: "value",
      axisLabel: { color: palette.muted, fontSize: 10, formatter: (value: number) => formatDuration(value) },
    },
    series: [
      {
        name: latencyLabel,
        type: "line",
        data: points.filter((point) => point.average_latency_ms !== undefined).map((point) => [point.bucket, point.average_latency_ms]),
        showSymbol: false,
        smooth: 0.24,
        sampling: "lttb",
        lineStyle: { width: 2.2 },
        areaStyle: { opacity: 0.07 },
      },
      {
        name: ttftLabel,
        type: "line",
        data: points.filter((point) => point.average_ttft_ms !== undefined).map((point) => [point.bucket, point.average_ttft_ms]),
        showSymbol: false,
        smooth: 0.24,
        sampling: "lttb",
        lineStyle: { width: 2 },
      },
    ],
  }), [latencyLabel, points, ttftLabel]);

  return <EChart ariaLabel={t("usage.chart.latencyTrend")} buildOption={buildOption} className="dashboard-main-chart" />;
}

export function CacheEfficiencyChart({ points }: TrendChartProps) {
  const t = useT();
  const readLabel = t("usage.stats.cacheRead");
  const writeLabel = t("usage.stats.cacheCreation");
  const rateLabel = t("usage.stats.cache");
  const buildOption = useMemo(() => (palette: ChartPalette): EChartsCoreOption => ({
    ...baseOption(palette),
    color: [palette.accentStrong, palette.warn, palette.ok],
    grid: { left: 10, right: 10, top: 48, bottom: 10, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    legend: { top: 5, right: 5, itemHeight: 8, itemWidth: 14, textStyle: { color: palette.muted, fontSize: 10 } },
    tooltip: { trigger: "axis", confine: true, renderMode: "richText" },
    xAxis: { ...axisStyle(palette), type: "time", splitLine: { show: false } },
    yAxis: [
      { ...axisStyle(palette), type: "value", axisLabel: { color: palette.muted, fontSize: 10, formatter: timeLabel } },
      { ...axisStyle(palette), type: "value", min: 0, max: 100, axisLabel: { color: palette.muted, fontSize: 10, formatter: "{value}%" }, splitLine: { show: false } },
    ],
    series: [
      { name: readLabel, type: "bar", data: timeSeries(points, "cache_read_tokens"), barMaxWidth: 18, itemStyle: { borderRadius: [3, 3, 0, 0] } },
      { name: writeLabel, type: "bar", data: timeSeries(points, "cache_creation_tokens"), barMaxWidth: 18, itemStyle: { borderRadius: [3, 3, 0, 0] } },
      {
        name: rateLabel,
        type: "line",
        yAxisIndex: 1,
        data: points.map((point) => [point.bucket, (cacheRateValue(point) ?? 0) * 100]),
        showSymbol: false,
        smooth: 0.22,
        lineStyle: { width: 2 },
      },
    ],
  }), [points, rateLabel, readLabel, writeLabel]);

  return <EChart ariaLabel={t("usage.chart.cacheTrend")} buildOption={buildOption} className="dashboard-main-chart" />;
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

export function CostBreakdownChart({ totals }: { totals: UsageTotals }) {
  const t = useT();
  const rows = useMemo(() => [
    { name: t("usage.analysis.uncachedInput"), value: totals.uncached_input_cost_usd },
    { name: t("usage.analysis.cacheReadCost"), value: totals.cache_read_cost_usd },
    { name: t("usage.analysis.cacheWriteCost"), value: totals.cache_creation_cost_usd },
    { name: t("usage.analysis.outputCost"), value: totals.output_cost_usd },
    { name: t("usage.analysis.otherCost"), value: totals.other_cost_usd },
  ].filter((row) => row.value > 0), [t, totals]);
  const buildOption = useMemo(() => (palette: ChartPalette): EChartsCoreOption => ({
    ...baseOption(palette),
    color: [palette.accentStrong, palette.ok, palette.warn, palette.danger, palette.muted],
    legend: { type: "scroll", bottom: 2, left: "center", itemHeight: 8, itemWidth: 10, textStyle: { color: palette.muted, fontSize: 9 } },
    tooltip: {
      trigger: "item",
      confine: true,
      renderMode: "richText",
      formatter: (params: unknown) => {
        const item = params as { name?: string; value?: number; percent?: number };
        return `${item.name ?? ""}\n${formatUSD(Number(item.value ?? 0))} · ${Number(item.percent ?? 0).toFixed(1)}%`;
      },
    },
    series: [{
      type: "pie",
      radius: ["48%", "74%"],
      center: ["50%", "43%"],
      padAngle: 2,
      itemStyle: { borderColor: palette.panel, borderWidth: 2, borderRadius: 3 },
      label: { show: false },
      emphasis: { scaleSize: 5 },
      data: rows,
    }],
  }), [rows]);

  return <EChart ariaLabel={t("usage.chart.costBreakdown")} buildOption={buildOption} className="dashboard-donut-chart" />;
}

export function UsageHeatmapChart({ cells }: { cells: UsageHeatmapCell[] }) {
  const t = useT();
  const { keys, models, values, maximum } = useMemo(() => {
    const keyTotals = new Map<string, number>();
    const modelTotals = new Map<string, number>();
    for (const cell of cells) {
      keyTotals.set(cell.key_id, (keyTotals.get(cell.key_id) ?? 0) + cell.total_tokens);
      modelTotals.set(cell.model, (modelTotals.get(cell.model) ?? 0) + cell.total_tokens);
    }
    const orderedKeys = [...keyTotals].sort((left, right) => right[1] - left[1]).slice(0, 10).map(([key]) => key);
    const orderedModels = [...modelTotals].sort((left, right) => right[1] - left[1]).slice(0, 12).map(([model]) => model);
    const keyIndexes = new Map(orderedKeys.map((key, index) => [key, index]));
    const modelIndexes = new Map(orderedModels.map((model, index) => [model, index]));
    const chartValues = cells.flatMap((cell) => {
      const keyIndex = keyIndexes.get(cell.key_id);
      const modelIndex = modelIndexes.get(cell.model);
      return keyIndex === undefined || modelIndex === undefined
        ? []
        : [[modelIndex, keyIndex, cell.total_tokens, cell.request_count, cell.cost_usd]];
    });
    return {
      keys: orderedKeys,
      models: orderedModels,
      values: chartValues,
      maximum: Math.max(1, ...chartValues.map((value) => Number(value[2]))),
    };
  }, [cells]);
  const buildOption = useMemo(() => (palette: ChartPalette): EChartsCoreOption => ({
    ...baseOption(palette),
    grid: { left: 8, right: 18, top: 12, bottom: 58, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    tooltip: {
      trigger: "item",
      confine: true,
      renderMode: "richText",
      formatter: (params: unknown) => {
        const value = (params as { value?: Array<number> }).value ?? [];
        return `${keys[value[1]] ?? ""} × ${models[value[0]] ?? ""}\n${formatCount(value[2] ?? 0)} Token · ${formatCount(value[3] ?? 0)} ${t("usage.stats.requests")}\n${formatUSD(value[4] ?? 0)}`;
      },
    },
    xAxis: {
      ...axisStyle(palette),
      type: "category",
      data: models,
      axisLabel: { color: palette.muted, fontSize: 9, interval: 0, rotate: models.length > 6 ? 28 : 0, width: 94, overflow: "truncate" },
      splitArea: { show: true, areaStyle: { color: ["transparent", palette.panel] } },
    },
    yAxis: {
      ...axisStyle(palette),
      type: "category",
      data: keys,
      axisLabel: { color: palette.text, fontSize: 9, width: 90, overflow: "truncate" },
      splitArea: { show: true, areaStyle: { color: ["transparent", palette.panel] } },
    },
    visualMap: {
      min: 0,
      max: maximum,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 4,
      itemWidth: 12,
      itemHeight: 92,
      text: [formatCount(maximum), "0"],
      textStyle: { color: palette.muted, fontSize: 9 },
      inRange: { color: [palette.panel, palette.border, palette.accentStrong] },
    },
    series: [{
      type: "heatmap",
      data: values,
      label: { show: values.length <= 40, color: palette.text, fontSize: 8, formatter: (params: unknown) => formatCount(Number((params as { value?: number[] }).value?.[2] ?? 0)) },
      emphasis: { itemStyle: { borderColor: palette.text, borderWidth: 1 } },
    }],
  }), [keys, maximum, models, t, values]);

  return <EChart ariaLabel={t("usage.chart.heatmap")} buildOption={buildOption} className="dashboard-heatmap-chart" />;
}

export function LatencyScatterChart({ points }: { points: UsageLatencyPoint[] }) {
  const t = useT();
  const buildOption = useMemo(() => (palette: ChartPalette): EChartsCoreOption => ({
    ...baseOption(palette),
    color: [palette.accentStrong],
    grid: { left: 10, right: 12, top: 12, bottom: 12, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    tooltip: {
      trigger: "item",
      confine: true,
      renderMode: "richText",
      formatter: (params: unknown) => {
        const value = (params as { value?: number[] }).value ?? [];
        return `${t("usage.stats.ttft")} ${formatDuration(value[0])}\n${t("usage.stats.latency")} ${formatDuration(value[1])}`;
      },
    },
    xAxis: {
      ...axisStyle(palette),
      type: "value",
      name: t("usage.stats.ttft"),
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { color: palette.muted, fontSize: 9 },
      axisLabel: { color: palette.muted, fontSize: 9, formatter: (value: number) => formatDuration(value) },
    },
    yAxis: {
      ...axisStyle(palette),
      type: "value",
      name: t("usage.stats.latency"),
      nameLocation: "middle",
      nameGap: 48,
      nameTextStyle: { color: palette.muted, fontSize: 9 },
      axisLabel: { color: palette.muted, fontSize: 9, formatter: (value: number) => formatDuration(value) },
    },
    series: [{
      type: "scatter",
      data: points.map((point) => [point.ttft_ms, point.latency_ms]),
      symbolSize: 7,
      large: points.length > 300,
      itemStyle: { opacity: 0.52 },
      emphasis: { scale: 1.45, itemStyle: { opacity: 0.9 } },
    }],
  }), [points, t]);

  return <EChart ariaLabel={t("usage.chart.latencyScatter")} buildOption={buildOption} className="dashboard-scatter-chart" />;
}

export function DimensionShareChart({ rows, ariaLabel }: BreakdownChartProps & { ariaLabel: string }) {
  const visible = rows.slice(0, 7);
  const buildOption = useMemo(() => (palette: ChartPalette): EChartsCoreOption => ({
    ...baseOption(palette),
    color: [palette.accentStrong],
    grid: { left: 8, right: 12, top: 8, bottom: 8, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, confine: true, renderMode: "richText", valueFormatter: (value: unknown) => formatCount(Number(value)) },
    xAxis: { ...axisStyle(palette), type: "value", axisLabel: { color: palette.muted, fontSize: 9, formatter: timeLabel } },
    yAxis: {
      ...axisStyle(palette),
      type: "category",
      inverse: true,
      data: visible.map((row) => row.name),
      axisLabel: { color: palette.text, fontSize: 9, width: 110, overflow: "truncate" },
      splitLine: { show: false },
    },
    series: [{ type: "bar", data: visible.map((row) => row.request_count), barMaxWidth: 17, itemStyle: { borderRadius: [0, 4, 4, 0] } }],
  }), [visible]);

  return <EChart ariaLabel={ariaLabel} buildOption={buildOption} className="dashboard-bar-chart" />;
}
