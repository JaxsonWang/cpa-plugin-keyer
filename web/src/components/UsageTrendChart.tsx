import type { UsageTrendPoint } from "../types";
import { useT } from "../i18n";

type Metric = "request_count" | "total_tokens" | "cost_usd";

interface UsageTrendChartProps {
  points: UsageTrendPoint[];
  metric: Metric;
  granularity: "hour" | "day";
}

const WIDTH = 760;
const HEIGHT = 224;
const PADDING_X = 42;
const PADDING_TOP = 18;
const PADDING_BOTTOM = 34;

function compact(value: number): string {
  return Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function metricValue(point: UsageTrendPoint, metric: Metric): number {
  return Number(point[metric] ?? 0);
}

export default function UsageTrendChart({ points, metric, granularity }: UsageTrendChartProps) {
  const t = useT();
  const values = points.map((point) => metricValue(point, metric));
  const max = Math.max(1, ...values);
  const innerWidth = WIDTH - PADDING_X * 2;
  const innerHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const xOf = (index: number) => PADDING_X + (points.length <= 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const yOf = (value: number) => PADDING_TOP + innerHeight - (value / max) * innerHeight;
  const path = values.map((value, index) => `${index === 0 ? "M" : "L"}${xOf(index).toFixed(2)},${yOf(value).toFixed(2)}`).join(" ");
  const area = path
    ? `${path} L${xOf(values.length - 1).toFixed(2)},${(PADDING_TOP + innerHeight).toFixed(2)} L${xOf(0).toFixed(2)},${(PADDING_TOP + innerHeight).toFixed(2)} Z`
    : "";
  const labelIndexes = points.length <= 6
    ? points.map((_, index) => index)
    : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const formatTime = (value: string) => {
    const date = new Date(value);
    return granularity === "hour"
      ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString([], { month: "2-digit", day: "2-digit" });
  };
  const formatAxis = (value: number) => metric === "cost_usd" ? `$${value.toFixed(value < 1 ? 3 : 2)}` : compact(value);

  if (points.length === 0) return <div className="usage-chart-empty">{t("usage.noData")}</div>;

  return (
    <svg className={`usage-trend-chart metric-${metric}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t(`usage.chart.${metric}`)}>
      <defs>
        <linearGradient id={`usage-area-${metric}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((ratio) => {
        const y = PADDING_TOP + ratio * innerHeight;
        const value = max * (1 - ratio);
        return (
          <g key={ratio}>
            <line className="chart-gridline" x1={PADDING_X} x2={WIDTH - PADDING_X} y1={y} y2={y} />
            <text className="chart-axis-label" x={PADDING_X - 8} y={y + 4} textAnchor="end">{formatAxis(value)}</text>
          </g>
        );
      })}
      <path className="chart-area" d={area} fill={`url(#usage-area-${metric})`} />
      <path className="chart-line" d={path} />
      {values.map((value, index) => value > 0 ? <circle key={index} className="chart-point" cx={xOf(index)} cy={yOf(value)} r="2.6" /> : null)}
      {labelIndexes.map((index) => (
        <text key={index} className="chart-axis-label" x={xOf(index)} y={HEIGHT - 9} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>
          {formatTime(points[index].bucket)}
        </text>
      ))}
    </svg>
  );
}
