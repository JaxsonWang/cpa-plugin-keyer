import { useCallback, useEffect, useState } from "react";
import { fetchUsageAnalysis, fetchUsageOverview } from "../api/usage";
import { listKeys } from "../api/keys";
import KeyQuotaChart from "../components/KeyQuotaChart";
import UsageControls from "../components/UsageControls";
import {
  ActivityChart,
  CacheEfficiencyChart,
  CostBreakdownChart,
  DimensionShareChart,
  KeyUsageChart,
  LatencyScatterChart,
  LatencyTrendChart,
  ModelShareChart,
  ProviderShareChart,
  TokenCompositionChart,
  UsageHeatmapChart,
} from "../components/UsageDashboardCharts";
import { useT } from "../i18n";
import type {
  UsageAnalysisResponse,
  UsageBreakdown,
  UsageHeatmapCell,
  UsageLatencyPoint,
  UsageOverviewResponse,
  KeyPublic,
} from "../types";
import {
  averagePerMinute,
  cacheRate,
  cacheRateValue,
  costPerMillion,
  formatCount,
  formatDuration,
  formatExecutorName,
  formatMappedDimensionName,
  formatPercent,
  formatRate,
  formatRequestUSD,
  formatSummaryUSD,
  formatUSD,
  isUnrecordedDimension,
  successRate,
} from "../utils/usageFormat";
import { readUsageRange } from "../utils/usageSearchParams";
import { getSession, isViewerSession } from "../store/session";
import { useRememberedUsageFilters } from "../store/usageFilterMemory";
import { APP_VERSION } from "../version";

// OVERVIEW_FILTER_NAMES 是概览页需要跨刷新记忆的筛选字段。
const OVERVIEW_FILTER_NAMES = ["range", "key_id"] as const;

interface DashboardData {
  analysis: UsageAnalysisResponse;
  keys: KeyPublic[];
  overview: UsageOverviewResponse;
}

function messageOf(error: unknown, fallback: string): string {
  const typed = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return typed.response?.data?.error?.message ?? typed.message ?? fallback;
}

/**
 * 渲染概览页首屏加载骨架。
 * @returns 返回两块主要指标、四块次要指标和图表占位。
 */
function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-hidden="true">
      <div className="dashboard-skeleton-metrics">
        {/* _ 表示未使用的数组项，index 表示当前指标占位位置。 */}
        {Array.from({ length: 6 }, (_, index) => <span key={index} className={index < 2 ? "wide" : ""} />)}
      </div>
      <div className="dashboard-skeleton-charts"><span /><span /><span /></div>
    </div>
  );
}

function CompactBreakdown({ row }: { row: UsageBreakdown }) {
  const t = useT();
  return (
    <div className="single-dimension-summary">
      <div className="single-dimension-name"><strong title={row.name}>{row.name}</strong></div>
      <dl>
        <div><dt>{t("usage.stats.requests")}</dt><dd>{formatCount(row.request_count)}</dd></div>
        <div><dt>{t("usage.stats.tokens")}</dt><dd>{formatCount(row.total_tokens)}</dd></div>
        <div><dt>{t("usage.stats.cost")}</dt><dd>{formatSummaryUSD(row.cost_usd)}</dd></div>
      </dl>
    </div>
  );
}

function CompactHeatmap({ cell }: { cell: UsageHeatmapCell }) {
  const t = useT();
  return (
    <div className="single-dimension-summary heatmap-summary">
      <div className="single-dimension-name"><strong title={cell.key_id}>{cell.key_id}</strong><span>{cell.model}</span></div>
      <dl>
        <div><dt>{t("usage.stats.requests")}</dt><dd>{formatCount(cell.request_count)}</dd></div>
        <div><dt>{t("usage.stats.tokens")}</dt><dd>{formatCount(cell.total_tokens)}</dd></div>
        <div><dt>{t("usage.stats.cost")}</dt><dd>{formatSummaryUSD(cell.cost_usd)}</dd></div>
      </dl>
    </div>
  );
}

function CompactLatency({ point }: { point: UsageLatencyPoint }) {
  const t = useT();
  return (
    <div className="single-dimension-summary latency-summary">
      <dl>
        <div><dt>{t("usage.stats.ttft")}</dt><dd>{formatDuration(point.ttft_ms)}</dd></div>
        <div><dt>{t("usage.stats.latency")}</dt><dd>{formatDuration(point.latency_ms)}</dd></div>
      </dl>
    </div>
  );
}

function ModelEfficiency({ data }: { data: UsageAnalysisResponse }) {
  const t = useT();
  return (
    <section className="dashboard-chart-card dashboard-span-3 model-efficiency-card">
      <div className="dashboard-card-head">
        <div><h2>{t("usage.analysis.modelEfficiency")}</h2><p>{t("usage.analysis.modelEfficiencyHint")}</p></div>
        <span>{t("usage.analysis.byModel")}</span>
      </div>
      <div className="analysis-table-wrap">
        <table className="analysis-table">
          <thead><tr>
            <th>#</th><th>{t("usage.events.model")}</th><th>{t("usage.stats.requests")}</th>
            <th>{t("usage.stats.successRate")}</th><th>{t("usage.stats.tokens")}</th>
            <th>{t("usage.stats.cost")}</th><th>{t("usage.analysis.costPerRequest")}</th>
            <th>{t("usage.analysis.outputPerRequest")}</th><th>{t("usage.stats.cache")}</th>
          </tr></thead>
          <tbody>
            {data.by_model.slice(0, 10).map((row, index) => (
              <tr key={row.name}>
                <td className="rank-cell">{index + 1}</td>
                <td>
                  <strong title={row.name}>{row.name}</strong>
                  <small>I {formatCount(row.input_tokens)} · O {formatCount(row.output_tokens)} · C {formatCount(Math.max(row.cache_read_tokens, row.cached_tokens))}</small>
                </td>
                <td>{formatCount(row.request_count)}</td>
                <td>{successRate(row)}</td>
                <td>{formatCount(row.total_tokens)}</td>
                <td>{formatUSD(row.cost_usd)}</td>
                <td>{row.request_count ? formatRequestUSD(row.cost_usd / row.request_count) : "—"}</td>
                <td>{row.request_count ? formatCount(row.output_tokens / row.request_count) : "—"}</td>
                <td>{formatPercent(cacheRateValue(row) ?? Number.NaN)}</td>
              </tr>
            ))}
            {data.by_model.length === 0 && <tr><td colSpan={9} className="analysis-empty muted">{t("usage.noData")}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function UsageOverview() {
  const t = useT();
  const viewer = isViewerSession(getSession());
  // filterScope 区分管理模式和 Viewer 模式的概览筛选记忆。
  const filterScope = viewer ? "overview-viewer" : "overview-management";
  // searchParams 是恢复记忆后的筛选参数；updateQuery 同步路由和本地记忆。
  const [searchParams, updateQuery] = useRememberedUsageFilters(filterScope, OVERVIEW_FILTER_NAMES);
  const range = readUsageRange(searchParams);
  const keyID = searchParams.get("key_id") ?? "";
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = { range, key_id: keyID };
      const [overview, analysis, keys] = await Promise.all([
        fetchUsageOverview(query),
        fetchUsageAnalysis(query),
        listKeys(),
      ]);
      setData({ overview, analysis, keys });
    } catch (cause) {
      setError(messageOf(cause, t("usage.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [keyID, range, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const overview = data?.overview;
  const analysis = data?.analysis;
  const keys = data?.keys ?? [];
  const totals = overview?.totals;
  const cacheTokens = totals ? Math.max(totals.cache_read_tokens, totals.cached_tokens) : 0;
  const rpm = overview && totals ? averagePerMinute(totals.request_count, overview.from, overview.to) : 0;
  const tpm = overview && totals ? averagePerMinute(totals.total_tokens, overview.from, overview.to) : 0;
  const performance = overview?.performance;
  const unrecordedLabel = t("usage.unrecorded");
  const codexExecutorLabel = t("usage.executorLabels.codex");
  const runtimeLabels = {
    apikey: t("usage.runtimeLabels.apikey"),
    oauth: t("usage.runtimeLabels.oauth"),
    "openai-responses": t("usage.runtimeLabels.openaiResponses"),
    priority: t("usage.runtimeLabels.priority"),
    flex: t("usage.runtimeLabels.flex"),
    default: t("usage.runtimeLabels.defaultTier"),
  };
  const runtimeLabel = (value?: string) => formatMappedDimensionName(value, unrecordedLabel, runtimeLabels);
  const runtimeDimensionRows = analysis ? [
    ...analysis.by_executor,
    ...analysis.by_auth_type,
    ...analysis.by_source,
    ...analysis.by_service_tier,
  ] : [];
  const hasUnrecordedRuntimeDimensions = runtimeDimensionRows.some((row) => isUnrecordedDimension(row.name));
  const labelDimensionRows = (rows: typeof runtimeDimensionRows) => rows.map((row) => ({
    ...row,
    name: runtimeLabel(row.name),
  }));
  const executorRows = analysis?.by_executor.map((row) => ({
    ...row,
    name: formatExecutorName(row.name, unrecordedLabel, codexExecutorLabel),
  })) ?? [];
  const providerRows = analysis?.by_provider.map((row) => ({ ...row, name: runtimeLabel(row.name) })) ?? [];
  const authRows = analysis ? labelDimensionRows(analysis.by_auth_type) : [];
  const sourceRows = analysis ? labelDimensionRows(analysis.by_source) : [];
  const serviceTierRows = analysis ? labelDimensionRows(analysis.by_service_tier) : [];
  const visibleKeys = keyID ? keys.filter((key) => key.id === keyID) : keys;
  const limitedKeys = visibleKeys.filter((key) => key.daily_limit_usd > 0 || key.weekly_limit_usd > 0);
  const overQuotaKeys = limitedKeys.filter((key) => (
    (key.daily_limit_usd > 0 && key.usage.daily_usd >= key.daily_limit_usd)
    || (key.weekly_limit_usd > 0 && key.usage.weekly_usd >= key.weekly_limit_usd)
  ));

  return (
    <div className="usage-page dashboard-page">
      <div className="usage-page-head dashboard-head">
        <div className="page-heading">
          <span>{t("usage.eyebrow")} · v{APP_VERSION}</span>
          <div className="page-heading-title"><h1>{t("usage.overviewTitle")}</h1></div>
          <p>{t("usage.overviewHint")}</p>
        </div>
        <UsageControls
          range={range}
          keyID={keyID}
          filters={overview?.filters}
          disabled={loading}
          onRangeChange={(value) => updateQuery({ range: value })}
          onKeyChange={(value) => updateQuery({ key_id: value })}
          onRefresh={() => void load()}
        />
      </div>

      {loading && data && <div className="dashboard-refresh-line" aria-label={t("usage.refreshing")} />}
      {error && <div className="error">{error}</div>}
      {!data && loading ? <DashboardSkeleton /> : overview && analysis && totals && (
        <>
          <section className="dashboard-kpi-grid" aria-label={t("usage.stats.summary")}>
            <article className="dashboard-kpi hero request-tone">
              <span>{t("usage.stats.requests")}</span>
              <strong>{formatCount(totals.request_count)}</strong>
              <div className="dashboard-kpi-meta">
                <span className="ok-text">{t("usage.stats.successCount", { count: formatCount(totals.success_count) })}</span>
                <span className={totals.failure_count > 0 ? "danger-text" : ""}>{t("usage.stats.failureCount", { count: formatCount(totals.failure_count) })}</span>
                <span>{successRate(totals)}</span>
              </div>
            </article>
            <article className="dashboard-kpi hero token-tone">
              <span>{t("usage.stats.tokens")}</span>
              <strong>{formatCount(totals.total_tokens)}</strong>
              <div className="dashboard-kpi-meta">
                <span>{t("usage.stats.input")} {formatCount(totals.input_tokens)}</span>
                <span>{t("usage.stats.output")} {formatCount(totals.output_tokens)}</span>
                <span>{t("usage.stats.cacheRead")} {formatCount(cacheTokens)}</span>
              </div>
            </article>
            <article className="dashboard-kpi compact"><span>RPM</span><strong>{formatRate(rpm)}</strong><small>{t("usage.stats.requests")}</small></article>
            <article className="dashboard-kpi compact"><span>TPM</span><strong>{formatRate(tpm)}</strong><small>{t("usage.stats.tokens")}</small></article>
            <article className="dashboard-kpi compact"><span>{t("usage.stats.cache")}</span><strong>{cacheRate(totals)}</strong><small>{formatCount(cacheTokens)} Token</small></article>
            <article className="dashboard-kpi compact"><span>{t("usage.stats.cost")}</span><strong>{formatSummaryUSD(totals.cost_usd)}</strong><small>{costPerMillion(totals.cost_usd, totals.total_tokens)} / 1M</small></article>
            <article className="dashboard-kpi compact latency-tone"><span>{t("usage.stats.latencyP95")}</span><strong>{formatDuration(performance?.p95_latency_ms)}</strong><small>{t("usage.stats.samples", { count: formatCount(performance?.latency_samples ?? 0) })}</small></article>
            <article className="dashboard-kpi compact ttft-tone"><span>{t("usage.stats.ttftP95")}</span><strong>{formatDuration(performance?.p95_ttft_ms)}</strong><small>{t("usage.stats.samples", { count: formatCount(performance?.ttft_samples ?? 0) })}</small></article>
          </section>

          {!viewer && <>
            <div className="usage-section-head dashboard-section-head">
              <div><h2>{t("usage.quota.title")}</h2><p>{t("usage.quota.hint")}</p></div>
              <span>{t("usage.quota.keyCount", { count: visibleKeys.length })}</span>
            </div>

            <section className="key-quota-layout">
              <div className="key-quota-summary" aria-label={t("usage.quota.summary")}>
                <article><span>{t("usage.quota.limitedKeys")}</span><strong>{limitedKeys.length}</strong></article>
                <article><span>{t("usage.quota.unlimitedKeys")}</span><strong>{visibleKeys.length - limitedKeys.length}</strong></article>
                <article className={overQuotaKeys.length > 0 ? "danger" : ""}><span>{t("usage.quota.exhaustedKeys")}</span><strong>{overQuotaKeys.length}</strong></article>
              </div>
              <div className="dashboard-chart-card key-quota-card">
                <div className="dashboard-card-head"><div><h2>{t("usage.quota.chartTitle")}</h2><p>{t("usage.quota.chartHint")}</p></div><span>{t("usage.quota.percentage")}</span></div>
                {limitedKeys.length > 0
                  ? <KeyQuotaChart keys={visibleKeys} />
                  : <div className="analysis-empty muted">{t("usage.quota.noLimits")}</div>}
              </div>
            </section>
          </>}

          <div className="usage-section-head dashboard-section-head">
            <div><h2>{t("usage.dashboard.activity")}</h2><p>{t("usage.dashboard.activityHint")}</p></div>
            <span>{new Date(overview.from).toLocaleString()} – {new Date(overview.to).toLocaleString()}</span>
          </div>

          <div className="dashboard-grid">
            <section className="dashboard-chart-card dashboard-span-2">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.activityTitle")}</h2><p>{t("usage.chart.activityHint")}</p></div><span>{formatCount(totals.request_count)} / {formatCount(totals.total_tokens)}</span></div>
              <ActivityChart points={overview.series} granularity={overview.granularity} />
            </section>
            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.modelShare")}</h2><p>{t("usage.chart.modelShareHint")}</p></div></div>
              {analysis.by_model.length === 1
                ? <CompactBreakdown row={analysis.by_model[0]} />
                : analysis.by_model.length > 1
                  ? <ModelShareChart rows={analysis.by_model} />
                  : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>

            <section className="dashboard-chart-card dashboard-span-2">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.latencyTrend")}</h2><p>{t("usage.chart.latencyTrendHint")}</p></div><span>P95 {formatDuration(performance?.p95_latency_ms)}</span></div>
              <LatencyTrendChart points={overview.series} />
            </section>
            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.latencyScatter")}</h2><p>{t("usage.chart.latencyScatterHint")}</p></div><span>{formatCount(analysis.latency_points.length)}</span></div>
              {analysis.latency_points.length === 1
                ? <CompactLatency point={analysis.latency_points[0]} />
                : analysis.latency_points.length > 1
                  ? <LatencyScatterChart points={analysis.latency_points} />
                  : <div className="analysis-empty muted">{t("usage.noLatencyData")}</div>}
            </section>

            <section className="dashboard-chart-card dashboard-span-2">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.tokenComposition")}</h2><p>{t("usage.chart.tokenCompositionHint")}</p></div><span>{formatCount(totals.total_tokens)}</span></div>
              <TokenCompositionChart points={overview.series} />
            </section>
            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.costBreakdown")}</h2><p>{t("usage.chart.costBreakdownHint")}</p></div><span>{formatSummaryUSD(totals.cost_usd)}</span></div>
              {totals.cost_usd > 0 ? <CostBreakdownChart totals={totals} /> : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>

            <section className="dashboard-chart-card dashboard-span-2">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.cacheTrend")}</h2><p>{t("usage.chart.cacheTrendHint")}</p></div><span>{cacheRate(totals)}</span></div>
              <CacheEfficiencyChart points={overview.series} />
            </section>
            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.executorShare")}</h2><p>{t("usage.chart.executorShareHint")}</p></div></div>
              {executorRows.length === 1
                ? <CompactBreakdown row={executorRows[0]} />
                : executorRows.length > 1
                  ? <DimensionShareChart rows={executorRows} ariaLabel={t("usage.chart.executorShare")} />
                  : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>

            <section className="dashboard-chart-card dashboard-span-2">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.heatmap")}</h2><p>{t("usage.chart.heatmapHint")}</p></div><span>{formatCount(analysis.heatmap.length)}</span></div>
              {analysis.heatmap.length === 1
                ? <CompactHeatmap cell={analysis.heatmap[0]} />
                : analysis.heatmap.length > 1
                  ? <UsageHeatmapChart cells={analysis.heatmap} />
                  : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>
            <section className="dashboard-chart-card dimension-stack-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.runtimeProfile")}</h2><p>{t("usage.chart.runtimeProfileHint")}</p></div></div>
              <div className="dimension-stack">
                <div><span>{t("usage.provider")}</span><strong>{providerRows[0]?.name ?? "—"}</strong><small>{formatCount(providerRows[0]?.request_count ?? 0)} {t("usage.stats.requests")}</small></div>
                <div><span>{t("usage.events.authType")}</span><strong>{authRows[0]?.name ?? "—"}</strong><small>{formatCount(authRows[0]?.request_count ?? 0)} {t("usage.stats.requests")}</small></div>
                <div><span>{t("usage.events.serviceTier")}</span><strong>{serviceTierRows[0]?.name ?? "—"}</strong><small>{formatCount(serviceTierRows[0]?.request_count ?? 0)} {t("usage.stats.requests")}</small></div>
                <div><span>{t("usage.events.requestSource")}</span><strong>{sourceRows[0]?.name ?? "—"}</strong><small>{formatCount(sourceRows[0]?.request_count ?? 0)} {t("usage.stats.requests")}</small></div>
              </div>
              {hasUnrecordedRuntimeDimensions && <p className="dimension-data-note">{t("usage.unrecordedHint")}</p>}
            </section>

            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.keyUsage")}</h2><p>{t("usage.chart.keyUsageHint")}</p></div></div>
              {analysis.by_key.length === 1
                ? <CompactBreakdown row={analysis.by_key[0]} />
                : analysis.by_key.length > 1
                  ? <KeyUsageChart rows={analysis.by_key} />
                  : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>
            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.providerShare")}</h2><p>{t("usage.chart.providerShareHint")}</p></div></div>
              {providerRows.length === 1
                ? <CompactBreakdown row={providerRows[0]} />
                : providerRows.length > 1
                  ? <ProviderShareChart rows={providerRows} />
                  : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>
            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.authShare")}</h2><p>{t("usage.chart.authShareHint")}</p></div></div>
              {authRows.length === 1
                ? <CompactBreakdown row={authRows[0]} />
                : authRows.length > 1
                  ? <DimensionShareChart rows={authRows} ariaLabel={t("usage.chart.authShare")} />
                  : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>
            <ModelEfficiency data={analysis} />
          </div>
        </>
      )}
    </div>
  );
}
