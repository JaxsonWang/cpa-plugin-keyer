import { useCallback, useEffect, useState } from "react";
import { fetchUsageAnalysis, fetchUsageOverview } from "../api/usage";
import UsageControls from "../components/UsageControls";
import {
  ActivityChart,
  KeyUsageChart,
  ModelShareChart,
  ProviderShareChart,
  TokenCompositionChart,
} from "../components/UsageDashboardCharts";
import { useT } from "../i18n";
import type { UsageAnalysisResponse, UsageOverviewResponse, UsageRange } from "../types";
import {
  averagePerMinute,
  cacheRate,
  costPerMillion,
  formatCount,
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
        {Array.from({ length: 6 }, (_, index) => <span key={index} className={index < 2 ? "wide" : ""} />)}
      </div>
      <div className="dashboard-skeleton-charts"><span /><span /><span /></div>
    </div>
  );
}

function ModelEfficiency({ data }: { data: UsageAnalysisResponse }) {
  const t = useT();
  return (
    <section className="dashboard-chart-card dashboard-span-2 model-efficiency-card">
      <div className="dashboard-card-head">
        <div><h2>{t("usage.analysis.modelEfficiency")}</h2><p>{t("usage.analysis.modelEfficiencyHint")}</p></div>
        <span>{t("usage.analysis.byModel")}</span>
      </div>
      <div className="analysis-table-wrap">
        <table className="analysis-table">
          <thead><tr>
            <th>#</th><th>{t("usage.events.model")}</th><th>{t("usage.stats.requests")}</th>
            <th>{t("usage.stats.successRate")}</th><th>{t("usage.stats.tokens")}</th>
            <th>{t("usage.stats.cost")}</th><th>{t("usage.analysis.costPerMillion")}</th>
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
                <td>{costPerMillion(row.cost_usd, row.total_tokens)}</td>
              </tr>
            ))}
            {data.by_model.length === 0 && <tr><td colSpan={7} className="analysis-empty muted">{t("usage.noData")}</td></tr>}
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
          </section>

          <div className="usage-section-head dashboard-section-head">
            <div><h2>{t("usage.dashboard.activity")}</h2><p>{t("usage.dashboard.activityHint")}</p></div>
            <span>{new Date(overview.from).toLocaleString()} – {new Date(overview.to).toLocaleString()}</span>
          </div>

          <div className="dashboard-grid">
            <section className="dashboard-chart-card dashboard-span-2">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.activityTitle")}</h2><p>{t("usage.chart.activityHint")}</p></div><span>{formatCount(totals.request_count)} / {formatCount(totals.total_tokens)}</span></div>
              <ActivityChart points={overview.series} />
            </section>
            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.modelShare")}</h2><p>{t("usage.chart.modelShareHint")}</p></div></div>
              {analysis.by_model.length > 0 ? <ModelShareChart rows={analysis.by_model} /> : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>

            <section className="dashboard-chart-card dashboard-span-2">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.tokenComposition")}</h2><p>{t("usage.chart.tokenCompositionHint")}</p></div><span>{formatCount(totals.total_tokens)}</span></div>
              <TokenCompositionChart points={overview.series} />
            </section>
            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.providerShare")}</h2><p>{t("usage.chart.providerShareHint")}</p></div></div>
              {analysis.by_provider.length > 0 ? <ProviderShareChart rows={analysis.by_provider} /> : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>

            <section className="dashboard-chart-card">
              <div className="dashboard-card-head"><div><h2>{t("usage.chart.keyUsage")}</h2><p>{t("usage.chart.keyUsageHint")}</p></div></div>
              {analysis.by_key.length > 0 ? <KeyUsageChart rows={analysis.by_key} /> : <div className="analysis-empty muted">{t("usage.noData")}</div>}
            </section>
            <ModelEfficiency data={analysis} />
          </div>
        </>
      )}
    </div>
  );
}
