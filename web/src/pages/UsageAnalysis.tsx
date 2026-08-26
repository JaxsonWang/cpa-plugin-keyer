import { useCallback, useEffect, useState } from "react";
import { fetchUsageAnalysis } from "../api/usage";
import UsageControls from "../components/UsageControls";
import { useT } from "../i18n";
import type { UsageAnalysisResponse, UsageBreakdown, UsageRange } from "../types";
import { formatCount, formatUSD, successRate } from "../utils/usageFormat";

function messageOf(error: unknown, fallback: string): string {
  const typed = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return typed.response?.data?.error?.message ?? typed.message ?? fallback;
}

function BreakdownPanel({ title, rows }: { title: string; rows: UsageBreakdown[] }) {
  const t = useT();
  const visible = rows.slice(0, 10);
  const max = Math.max(1, ...visible.map((row) => row.request_count));
  return (
    <section className="analysis-card">
      <div className="analysis-card-head"><h2>{title}</h2><span>{t("usage.analysis.requestShare")}</span></div>
      {visible.length === 0 ? <div className="analysis-empty muted">{t("usage.noData")}</div> : (
        <div className="analysis-bars">
          {visible.map((row) => {
            const rate = row.request_count ? (row.success_count / row.request_count) * 100 : 0;
            return (
              <div className="analysis-row" key={row.name}>
                <div className="analysis-row-top">
                  <strong title={row.name}>{row.name}</strong>
                  <span>{formatCount(row.request_count)} · {rate.toFixed(1)}%</span>
                </div>
                <div className="analysis-track"><span style={{ width: `${(row.request_count / max) * 100}%` }} /></div>
                <div className="analysis-row-meta">
                  <span>{formatCount(row.total_tokens)} {t("usage.analysis.tokensUnit")}</span>
                  <span>{formatUSD(row.cost_usd)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function UsageAnalysis() {
  const t = useT();
  const [range, setRange] = useState<UsageRange>("7d");
  const [keyID, setKeyID] = useState("");
  const [data, setData] = useState<UsageAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchUsageAnalysis({ range, key_id: keyID }));
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
          <div className="page-heading-title"><h1>{t("usage.analysisTitle")}</h1></div>
          <p>{t("usage.analysisHint")}</p>
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
      {!data && loading ? <div className="usage-loading muted">{t("usage.loading")}</div> : data && totals && (
        <>
          <div className="usage-stat-grid three">
            <article className="usage-stat-card accent"><span>{t("usage.stats.requests")}</span><strong>{formatCount(totals.request_count)}</strong><small>{t("usage.analysis.rangeTotal")}</small></article>
            <article className="usage-stat-card"><span>{t("usage.stats.successRate")}</span><strong>{successRate(totals)}</strong><small>{t("usage.stats.failureCount", { count: formatCount(totals.failure_count) })}</small></article>
            <article className="usage-stat-card"><span>{t("usage.stats.cost")}</span><strong>{formatUSD(totals.cost_usd)}</strong><small>{formatCount(totals.total_tokens)} {t("usage.analysis.tokensUnit")}</small></article>
          </div>
          <div className="analysis-grid">
            <BreakdownPanel title={t("usage.analysis.byModel")} rows={data.by_model} />
            <BreakdownPanel title={t("usage.analysis.byKey")} rows={data.by_key} />
            <BreakdownPanel title={t("usage.analysis.byProvider")} rows={data.by_provider} />
          </div>
        </>
      )}
    </div>
  );
}
