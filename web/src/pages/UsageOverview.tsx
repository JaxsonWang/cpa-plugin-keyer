import { useCallback, useEffect, useState } from "react";
import { fetchUsageAnalysis, fetchUsageOverview } from "../api/usage";
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
import type { UsageAnalysisResponse, UsageOverviewResponse, UsageRange } from "../types";
import {
  averagePerMinute,
  cacheRate,
  cacheRateValue,
  costPerMillion,
  formatCount,
  formatDuration,
  formatPercent,
  formatRate,
  formatSummaryUSD,
  formatUSD,
  successRate,
} from "../utils/usageFormat";

interface DashboardData {
  analysis: UsageAnalysisResponse;
  overview: UsageOverviewResponse;
}

function messageOf(error: unknown, fallback: string): string {
  const typed = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return typed.response?.data?.error?.message ?? typed.message ?? fallback;
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-hidden="true">
      <div className="dashboard-skeleton-metrics">
        {Array.from({ length: 8 }, (_, index) => <span key={index} className={index < 2 ? "wide" : ""} />)}
      </div>
      <div className="dashboard-skeleton-charts"><span /><span /><span /></div>
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
                <td>{row.request_count ? formatUSD(row.cost_usd / row.request_count) : "—"}</td>
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
  const [range, setRange] = useState<UsageRange>("7d");
  const [keyID, setKeyID] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = { range, key_id: keyID };
      const [overview, analysis] = await Promise.all([
        fetchUsageOverview(query),
        fetchUsageAnalysis(query),
      ]);
      setData({ overview, analysis });
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
  const totals = overview?.totals;
  const cacheTokens = totals ? Math.max(totals.cache_read_tokens, totals.cached_tokens) : 0;
  const rpm = overview && totals ? averagePerMinute(totals.request_count, overview.from, overview.to) : 0;
  const tpm = overview && totals ? averagePerMinute(totals.total_tokens, overview.from, overview.to) : 0;
  const performance = overview?.performance;

  return (
    <div className="usage-page dashboard-page">
      <div className="usage-page-head dashboard-head">
        <div className="page-heading">
          <span>{t("usage.eyebrow")}</span>
          <div className="page-heading-title"><h1>{t("usage.overviewTitle")}</h1></div>
          <p>{t("usage.overviewHint")}</p>
        </div>
        <UsageControls
          range={range}
          keyID={keyID}
          filters={overview?.filters}
          disabled={loading}
          onRangeChange={setRange}
          onKeyChange={setKeyID}
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
              {analysis.by_model.length > 0 ? <ModelShareChart rows={analysis.by_model} /> : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>

            <section className="dashboard-chart-card dashboard-span-2">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.latencyTrend")}</h2><p>{t("usage.chart.latencyTrendHint")}</p></div><span>P95 {formatDuration(performance?.p95_latency_ms)}</span></div>
              <LatencyTrendChart points={overview.series} />
            </section>
            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.latencyScatter")}</h2><p>{t("usage.chart.latencyScatterHint")}</p></div><span>{formatCount(analysis.latency_points.length)}</span></div>
              {analysis.latency_points.length > 0 ? <LatencyScatterChart points={analysis.latency_points} /> : <div className="analysis-empty muted">{t("usage.noLatencyData")}</div>}
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
              {analysis.by_executor.length > 0 ? <DimensionShareChart rows={analysis.by_executor} ariaLabel={t("usage.chart.executorShare")} /> : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>

            <section className="dashboard-chart-card dashboard-span-2">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.heatmap")}</h2><p>{t("usage.chart.heatmapHint")}</p></div><span>{formatCount(analysis.heatmap.length)}</span></div>
              {analysis.heatmap.length > 0 ? <UsageHeatmapChart cells={analysis.heatmap} /> : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>
            <section className="dashboard-chart-card dimension-stack-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.runtimeProfile")}</h2><p>{t("usage.chart.runtimeProfileHint")}</p></div></div>
              <div className="dimension-stack">
                <div><span>{t("usage.provider")}</span><strong>{analysis.by_provider[0]?.name ?? "—"}</strong><small>{formatCount(analysis.by_provider[0]?.request_count ?? 0)} {t("usage.stats.requests")}</small></div>
                <div><span>{t("usage.events.authType")}</span><strong>{analysis.by_auth_type[0]?.name ?? "—"}</strong><small>{formatCount(analysis.by_auth_type[0]?.request_count ?? 0)} {t("usage.stats.requests")}</small></div>
                <div><span>{t("usage.events.serviceTier")}</span><strong>{analysis.by_service_tier[0]?.name ?? "—"}</strong><small>{formatCount(analysis.by_service_tier[0]?.request_count ?? 0)} {t("usage.stats.requests")}</small></div>
                <div><span>{t("usage.events.requestSource")}</span><strong>{analysis.by_source[0]?.name ?? "—"}</strong><small>{formatCount(analysis.by_source[0]?.request_count ?? 0)} {t("usage.stats.requests")}</small></div>
              </div>
            </section>

            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.keyUsage")}</h2><p>{t("usage.chart.keyUsageHint")}</p></div></div>
              {analysis.by_key.length > 0 ? <KeyUsageChart rows={analysis.by_key} /> : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>
            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.providerShare")}</h2><p>{t("usage.chart.providerShareHint")}</p></div></div>
              {analysis.by_provider.length > 0 ? <ProviderShareChart rows={analysis.by_provider} /> : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>
            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.authShare")}</h2><p>{t("usage.chart.authShareHint")}</p></div></div>
              {analysis.by_auth_type.length > 0 ? <DimensionShareChart rows={analysis.by_auth_type} ariaLabel={t("usage.chart.authShare")} /> : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>
            <ModelEfficiency data={analysis} />
          </div>
        </>
      )}
    </div>
  );
}
