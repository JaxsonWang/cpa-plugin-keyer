import { useCallback, useEffect, useState } from "react";
import { fetchUsageEvents } from "../api/usage";
import UsageControls from "../components/UsageControls";
import { useT } from "../i18n";
import type { UsageEventsResponse, UsageRange } from "../types";
import { formatCount, formatUSD } from "../utils/usageFormat";

function messageOf(error: unknown, fallback: string): string {
  const typed = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return typed.response?.data?.error?.message ?? typed.message ?? fallback;
}

export default function RequestEvents() {
  const t = useT();
  const [range, setRange] = useState<UsageRange>("7d");
  const [keyID, setKeyID] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [result, setResult] = useState<"" | "success" | "failed">("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsageEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchUsageEvents({
        range,
        key_id: keyID,
        provider,
        model,
        result: result || undefined,
        page,
        page_size: 50,
      }));
    } catch (cause) {
      setError(messageOf(cause, t("usage.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [keyID, model, page, provider, range, result, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeFilter = (setter: (value: string) => void, value: string) => {
    setPage(1);
    setter(value);
  };

  return (
    <div className="usage-page events-page">
      <div className="usage-page-head events-head">
        <div className="page-heading">
          <span>{t("usage.eyebrow")}</span>
          <div className="page-heading-title"><h1>{t("usage.eventsTitle")}</h1></div>
          <p>{t("usage.eventsHint")}</p>
        </div>
      </div>

      <div className="privacy-note"><span aria-hidden="true">i</span>{t("usage.eventsPrivacy")}</div>
      <UsageControls
        range={range}
        keyID={keyID}
        filters={data?.filters}
        disabled={loading}
        onRangeChange={(value) => { setPage(1); setRange(value); }}
        onKeyChange={(value) => changeFilter(setKeyID, value)}
        onRefresh={() => void load()}
      >
        <label>
          <span>{t("usage.provider")}</span>
          <select aria-label={t("usage.provider")} value={provider} disabled={loading} onChange={(event) => changeFilter(setProvider, event.target.value)}>
            <option value="">{t("usage.allProviders")}</option>
            {(data?.filters.providers ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>{t("usage.model")}</span>
          <select aria-label={t("usage.model")} value={model} disabled={loading} onChange={(event) => changeFilter(setModel, event.target.value)}>
            <option value="">{t("usage.allModels")}</option>
            {(data?.filters.models ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>{t("usage.result")}</span>
          <select aria-label={t("usage.result")} value={result} disabled={loading} onChange={(event) => { setPage(1); setResult(event.target.value as typeof result); }}>
            <option value="">{t("usage.allResults")}</option>
            <option value="success">{t("usage.success")}</option>
            <option value="failed">{t("usage.failed")}</option>
          </select>
        </label>
      </UsageControls>

      {error && <div className="error">{error}</div>}
      {!data && loading ? <div className="usage-loading muted">{t("usage.loading")}</div> : data && (
        <>
          <div className="events-summary">
            <span>{t("usage.eventsCount", { count: data.total })}</span>
            {loading && <span className="muted">{t("usage.refreshing")}</span>}
          </div>
          <div className="card table-wrap events-table-wrap">
            <table className="events-table">
              <thead>
                <tr>
                  <th>{t("usage.events.time")}</th>
                  <th>{t("usage.events.keyID")}</th>
                  <th>{t("usage.events.provider")}</th>
                  <th>{t("usage.events.model")}</th>
                  <th>{t("usage.events.result")}</th>
                  <th>{t("usage.events.tokens")}</th>
                  <th className="num">{t("usage.events.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((event) => (
                  <tr key={event.id}>
                    <td className="event-time"><strong>{new Date(event.timestamp).toLocaleString()}</strong><small>#{event.id}</small></td>
                    <td><code className="event-key-id">{event.key_id}</code></td>
                    <td>{event.provider || "—"}</td>
                    <td className="event-model">
                      <strong>{event.model}</strong>
                      {event.upstream_model && event.upstream_model !== event.model && <small>{t("usage.events.upstream")}: {event.upstream_model}</small>}
                    </td>
                    <td><span className={`event-result ${event.failed ? "failed" : "success"}`}><i />{event.failed ? t("usage.failed") : t("usage.success")}</span></td>
                    <td className="event-tokens">
                      <strong>{formatCount(event.total_tokens)}</strong>
                      <small>I {formatCount(event.input_tokens)} · O {formatCount(event.output_tokens)}{(event.cache_read_tokens || event.cached_tokens) ? ` · C ${formatCount(event.cache_read_tokens || event.cached_tokens || 0)}` : ""}</small>
                    </td>
                    <td className="num mono">{event.cost_available ? formatUSD(event.cost_usd) : "—"}</td>
                  </tr>
                ))}
                {data.events.length === 0 && <tr><td colSpan={7} className="events-empty muted">{t("usage.noData")}</td></tr>}
              </tbody>
            </table>
          </div>
          {data.total_pages > 1 && (
            <div className="events-pagination">
              <button className="btn sm" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t("usage.previous")}</button>
              <span>{t("usage.page", { page: data.page, total: data.total_pages })}</span>
              <button className="btn sm" disabled={loading || page >= data.total_pages} onClick={() => setPage((value) => value + 1)}>{t("usage.next")}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
