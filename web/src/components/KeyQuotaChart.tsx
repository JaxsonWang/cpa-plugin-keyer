import { useMemo } from "react";
import type { EChartsCoreOption } from "../charts/echarts";
import { useT } from "../i18n";
import type { KeyPublic } from "../types";
import { formatUSD } from "../utils/usageFormat";
import EChart, { type ChartPalette } from "./EChart";

interface KeyQuotaChartProps {
  keys: KeyPublic[];
}

interface QuotaRow {
  id: string;
  name: string;
  dailyLimit: number;
  dailyUsed: number;
  weeklyLimit: number;
  weeklyUsed: number;
}

function utilization(used: number, limit: number): number {
  return limit > 0 ? (used / limit) * 100 : 0;
}

function labelOf(row: QuotaRow): string {
  return row.name.trim() || row.id;
}

export default function KeyQuotaChart({ keys }: KeyQuotaChartProps) {
  const t = useT();
  const rows = useMemo<QuotaRow[]>(() => keys
    .filter((key) => key.daily_limit_usd > 0 || key.weekly_limit_usd > 0)
    .map((key) => ({
      id: key.id,
      name: key.name,
      dailyLimit: key.daily_limit_usd,
      dailyUsed: key.usage.daily_usd,
      weeklyLimit: key.weekly_limit_usd,
      weeklyUsed: key.usage.weekly_usd,
    }))
    .sort((left, right) => Math.max(
      utilization(right.dailyUsed, right.dailyLimit),
      utilization(right.weeklyUsed, right.weeklyLimit),
    ) - Math.max(
      utilization(left.dailyUsed, left.dailyLimit),
      utilization(left.weeklyUsed, left.weeklyLimit),
    )), [keys]);

  const dailyLabel = t("usage.quota.daily");
  const weeklyLabel = t("usage.quota.weekly");
  const unlimitedLabel = t("usage.unlimited");
  const buildOption = useMemo(() => (palette: ChartPalette): EChartsCoreOption => {
    const dailyValues = rows.map((row) => utilization(row.dailyUsed, row.dailyLimit));
    const weeklyValues = rows.map((row) => utilization(row.weeklyUsed, row.weeklyLimit));
    const maxValue = Math.max(100, ...dailyValues, ...weeklyValues);

    return {
      animation: !palette.reducedMotion,
      animationDuration: 700,
      aria: { enabled: true },
      backgroundColor: "transparent",
      color: [palette.accentStrong, palette.ok],
      textStyle: { color: palette.text, fontFamily: '"Source Sans 3", system-ui, sans-serif', fontSize: 11 },
      grid: { left: 10, right: 18, top: 48, bottom: 8, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
      legend: { top: 5, right: 5, itemHeight: 8, itemWidth: 14, textStyle: { color: palette.muted, fontSize: 10 } },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        confine: true,
        renderMode: "richText",
        backgroundColor: palette.panel,
        borderColor: palette.border,
        borderWidth: 1,
        textStyle: { color: palette.text, fontSize: 11 },
        formatter: (params: unknown) => {
          const points = params as Array<{ dataIndex: number }>;
          const row = rows[points[0]?.dataIndex ?? 0];
          if (!row) return "";
          const line = (label: string, used: number, limit: number) => limit > 0
            ? `${label}: ${formatUSD(used)} / ${formatUSD(limit)} (${utilization(used, limit).toFixed(1)}%)`
            : `${label}: ${formatUSD(used)} / ${unlimitedLabel}`;
          return `${labelOf(row)}\n${line(dailyLabel, row.dailyUsed, row.dailyLimit)}\n${line(weeklyLabel, row.weeklyUsed, row.weeklyLimit)}`;
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        max: Math.ceil(maxValue / 25) * 25,
        axisLabel: { color: palette.muted, fontSize: 10, formatter: "{value}%" },
        axisLine: { lineStyle: { color: palette.border } },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: palette.border, opacity: 0.72 } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: rows.map(labelOf),
        axisLabel: { color: palette.text, fontSize: 10, width: 132, overflow: "truncate" },
        axisLine: { lineStyle: { color: palette.border } },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      series: [
        {
          name: dailyLabel,
          type: "bar",
          data: dailyValues.map((value) => ({ value, itemStyle: { color: value >= 100 ? palette.danger : palette.accentStrong } })),
          barMaxWidth: 14,
          itemStyle: { borderRadius: [0, 3, 3, 0] },
          emphasis: { focus: "series" },
        },
        {
          name: weeklyLabel,
          type: "bar",
          data: weeklyValues.map((value) => ({ value, itemStyle: { color: value >= 100 ? palette.danger : palette.ok } })),
          barMaxWidth: 14,
          itemStyle: { borderRadius: [0, 3, 3, 0] },
          emphasis: { focus: "series" },
        },
      ],
    };
  }, [dailyLabel, rows, unlimitedLabel, weeklyLabel]);

  const height = Math.max(240, Math.min(560, rows.length * 42 + 76));
  return (
    <div style={{ height }}>
      <EChart ariaLabel={t("usage.quota.chartTitle")} buildOption={buildOption} className="key-quota-chart" />
    </div>
  );
}
