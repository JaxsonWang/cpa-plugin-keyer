import { useCallback, useEffect, useState } from "react";
import { fetchUsageOverview } from "../api/usage";
import UsageControls from "../components/UsageControls";
import UsageTrendChart from "../components/UsageTrendChart";
import { useT } from "../i18n";
import type { UsageOverviewResponse, UsageRange } from "../types";
import { cacheRate, formatCount, formatUSD, successRate } from "../utils/usageFormat";

function messageOf(error: unknown, fallback: string): string {
  const typed = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return typed.response?.data?.error?.message ?? typed.message ?? fallback;
}

export default function UsageOverview() {
  const t = useT();
  const [range, setRange] = useState<UsageRange>("7d");
  const [keyID, setKeyID] = useState("");
  const [data, setData] = useState<UsageOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchUsageOverview({ range, key_id: keyID }));
    } catch (cause) {
      setError(messageOf(cause, t("usage.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [keyID, range, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = data?.totals;
  return (
    <div className="usage-page">
      <div className="usage-page-head">
        <div className="page-heading">
          <span>{t("usage.eyebrow")}</span>
          <div className="page-heading-title"><h1>{t("usage.overviewTitle")}</h1></div>
          <p>{t("usage.overviewHint")}</p>
        </div>
        <UsageControls
          range={range}
          keyID={keyID}
          filters={data?.filters}
          disabled={loading}
          onRangeChange={setRange}
          onKeyChange={setKeyID}
          onRefresh={() => void load()}
        />
      </div>

      {error && <div className="error">{error}</div>}
      {!data && loading ? <div className="usage-loading muted">{t("usage.loading")}</div> : totals && (
        <>
          <div className="usage-stat-grid">
            <article className="usage-stat-card accent">
              <span>{t("usage.stats.requests")}</span>
              <strong>{formatCount(totals.request_count)}</strong>
              <small>{t("usage.stats.successCount", { count: formatCount(totals.success_count) })}</small>
            </article>
            <article className="usage-stat-card">
              <span>{t("usage.stats.successRate")}</span>
              <strong>{successRate(totals)}</strong>
              <small className={totals.failure_count > 0 ? "danger-text" : ""}>{t("usage.stats.failureCount", { count: formatCount(totals.failure_count) })}</small>
            </article>
            <article className="usage-stat-card">
              <span>{t("usage.stats.tokens")}</span>
              <strong>{formatCount(totals.total_tokens)}</strong>
              <small>{t("usage.stats.ioTokens", { input: formatCount(totals.input_tokens), output: formatCount(totals.output_tokens) })}</small>
            </article>
            <article className="usage-stat-card">
              <span>{t("usage.stats.cost")}</span>
              <strong>{formatUSD(totals.cost_usd)}</strong>
              <small>{t("usage.stats.cacheRate", { rate: cacheRate(totals) })}</small>
            </article>
          </div>

          <section className="usage-chart-card usage-chart-wide">
            <div className="usage-card-heading">
              <div><span>{t("usage.chart.requests")}</span><small>{t("usage.chart.requestsHint")}</small></div>
              <strong>{formatCount(totals.request_count)}</strong>
            </div>
            <UsageTrendChart points={data.series} metric="request_count" granularity={data.granularity} />
          </section>

          <div className="usage-chart-grid">
            <section className="usage-chart-card">
              <div className="usage-card-heading">
                <div><span>{t("usage.chart.total_tokens")}</span><small>{t("usage.chart.tokensHint")}</small></div>
                <strong>{formatCount(totals.total_tokens)}</strong>
              </div>
              <UsageTrendChart points={data.series} metric="total_tokens" granularity={data.granularity} />
            </section>
            <section className="usage-chart-card">
              <div className="usage-card-heading">
                <div><span>{t("usage.chart.cost_usd")}</span><small>{t("usage.chart.costHint")}</small></div>
                <strong>{formatUSD(totals.cost_usd)}</strong>
              </div>
              <UsageTrendChart points={data.series} metric="cost_usd" granularity={data.granularity} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
