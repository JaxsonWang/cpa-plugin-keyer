import { useCallback, useEffect, useState } from "react";
import { fetchUsageEvents } from "../api/usage";
import UsageControls from "../components/UsageControls";
import { useT } from "../i18n";
import type { UsageEvent, UsageEventsResponse, UsageRange } from "../types";
import { formatCount, formatDuration, formatRate, formatUSD, tokensPerSecond } from "../utils/usageFormat";

function messageOf(error: unknown, fallback: string): string {
  const typed = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return typed.response?.data?.error?.message ?? typed.message ?? fallback;
}

function usageEventStats(event: UsageEvent) {
  const cached = Math.max(event.cache_read_tokens ?? 0, event.cached_tokens ?? 0);
  const cacheRate = event.input_tokens
    ? `${(Math.min(1, cached / event.input_tokens) * 100).toFixed(1)}%`
    : "—";
  const speedTPS = tokensPerSecond(event.output_tokens, event.latency_ms, event.ttft_ms);
  return { cached, cacheRate, speedTPS };
}

export default function RequestEvents() {
  const t = useT();
  const [range, setRange] = useState<UsageRange>("7d");
  const [keyID, setKeyID] = useState("");
  const [provider, setProvider] = useState("");
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
        result: result || undefined,
        page,
        page_size: 50,
      }));
    } catch (cause) {
      setError(messageOf(cause, t("usage.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [keyID, page, provider, range, result, t]);

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
          <div className="page-heading-title">
            <h1>{t("usage.eventsTitle")}</h1>
            {data && <span className="heading-count-tag">{t("usage.eventsCount", { count: data.total })}</span>}
            {loading && data && <span className="heading-refreshing">{t("usage.refreshing")}</span>}
          </div>
          <p>{t("usage.eventsHint")}</p>
        </div>
      </div>

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
          <div className="card table-wrap events-table-wrap">
            <table className="events-table">
              <thead>
                <tr>
                  <th>{t("usage.events.time")}</th>
                  <th>{t("usage.events.keyID")}</th>
                  <th>{t("usage.events.source")}</th>
                  <th>{t("usage.events.model")}</th>
                  <th>{t("usage.events.executor")}</th>
                  <th>{t("usage.events.result")}</th>
                  <th>{t("usage.events.performance")}</th>
                  <th>{t("usage.events.billing")}</th>
                  <th className="num">{t("usage.stats.input")}</th>
                  <th className="num">{t("usage.stats.output")}</th>
                  <th className="event-reasoning-effort">{t("usage.events.reasoningEffort")}</th>
                  <th className="num">{t("usage.stats.cacheRead")}</th>
                  <th className="num">{t("usage.events.cache")}</th>
                  <th className="num">{t("usage.events.tokens")}</th>
                  <th className="num">{t("usage.events.cost")}</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((event) => {
                  const { cached, cacheRate, speedTPS } = usageEventStats(event);
                  return (
                    <tr key={event.id}>
                      <td className="event-time"><strong>{new Date(event.timestamp).toLocaleString()}</strong><small>#{event.id}</small></td>
                      <td><code className="event-key-id">{event.key_id}</code></td>
                      <td className="event-source">
                        <code>{event.key_preview || "—"}</code>
                        <small>{event.provider || "—"}</small>
                        {event.source && <small>{event.source}</small>}
                      </td>
                      <td className="event-model">
                        <strong>{event.model}</strong>
                        {event.upstream_model && event.upstream_model !== event.model && <small>{t("usage.events.upstream")}: {event.upstream_model}</small>}
                      </td>
                      <td className="event-execution">
                        <strong>{event.executor_type || "—"}</strong>
                        <small>{[event.auth_type, event.auth_index].filter(Boolean).join(" · ") || "—"}</small>
                      </td>
                      <td className="event-result-cell">
                        <span className={`event-result ${event.failed ? "failed" : "success"}`}><i />{event.failed ? t("usage.failed") : t("usage.success")}</span>
                        {event.status_code ? <small>HTTP {event.status_code}</small> : null}
                      </td>
                      <td className="event-performance">
                        <strong>{formatDuration(event.latency_ms)}</strong>
                        <small>TTFT {formatDuration(event.ttft_ms)} · {speedTPS === undefined ? "—" : `${formatRate(speedTPS)} TPS`}</small>
                      </td>
                      <td className="event-billing"><span className="billing-badge">{event.billing_mode === "per_call" ? t("usage.events.perCall") : t("usage.events.byToken")}</span><small>{event.service_tier || "—"}</small></td>
                      <td className="num mono">{formatCount(event.input_tokens)}</td>
                      <td className="num mono">{formatCount(event.output_tokens)}</td>
                      <td className="event-reasoning-effort">{event.reasoning_effort || "—"}</td>
                      <td className="num mono">{formatCount(cached)}</td>
                      <td
                        className="num mono event-cache"
                        title={event.cache_creation_tokens ? undefined : t("usage.events.cacheCreationUnavailable")}
                      >
                        <strong>{cacheRate}</strong>
                        <small>R {formatCount(cached)} · W {event.cache_creation_tokens ? formatCount(event.cache_creation_tokens) : "—"}</small>
                      </td>
                      <td className="num mono event-total-token">{formatCount(event.total_tokens)}</td>
                      <td className="num mono">{event.cost_available ? formatUSD(event.cost_usd) : "—"}</td>
                    </tr>
                  );
                })}
                {data.events.length === 0 && <tr><td colSpan={15} className="events-empty muted">{t("usage.noData")}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="events-mobile-list mobile-only">
            {data.events.map((event) => {
              const { cached, cacheRate, speedTPS } = usageEventStats(event);
              return (
                <article className="event-mobile-card" key={event.id}>
                  <header>
                    <div className="event-mobile-time">
                      <strong>{new Date(event.timestamp).toLocaleString()}</strong>
                      <small>#{event.id}</small>
                    </div>
                    <span className={`event-result ${event.failed ? "failed" : "success"}`}>
                      <i />{event.failed ? t("usage.failed") : t("usage.success")}
                    </span>
                  </header>
                  <div className="event-mobile-model">
                    <strong>{event.model}</strong>
                    {event.upstream_model && event.upstream_model !== event.model && (
                      <small>{t("usage.events.upstream")}: {event.upstream_model}</small>
                    )}
                  </div>
                  <div className="event-mobile-identity">
                    <div>
                      <span>{t("usage.events.keyID")}</span>
                      <code>{event.key_id}</code>
                    </div>
                    <div className="event-source">
                      <span>{t("usage.events.source")}</span>
                      <code>{event.key_preview || "—"}</code>
                      <small>{event.provider || "—"}</small>
                      {event.source && <small>{event.source}</small>}
                    </div>
                  </div>
                  <dl className="event-mobile-stats">
                    <div><dt>{t("usage.stats.input")}</dt><dd>{formatCount(event.input_tokens)}</dd></div>
                    <div><dt>{t("usage.stats.output")}</dt><dd>{formatCount(event.output_tokens)}</dd></div>
                    <div><dt>{t("usage.events.reasoningEffort")}</dt><dd>{event.reasoning_effort || "—"}</dd></div>
                    <div><dt>{t("usage.stats.cacheRead")}</dt><dd>{formatCount(cached)} · {cacheRate}</dd></div>
                    <div title={event.cache_creation_tokens ? undefined : t("usage.events.cacheCreationUnavailable")}>
                      <dt>{t("usage.stats.cacheCreation")}</dt>
                      <dd>{event.cache_creation_tokens ? formatCount(event.cache_creation_tokens) : "—"}</dd>
                    </div>
                    <div><dt>{t("usage.events.tokens")}</dt><dd>{formatCount(event.total_tokens)}</dd></div>
                    <div><dt>{t("usage.stats.latency")}</dt><dd>{formatDuration(event.latency_ms)}</dd></div>
                    <div><dt>{t("usage.stats.ttft")}</dt><dd>{formatDuration(event.ttft_ms)}</dd></div>
                    <div><dt>TPS</dt><dd>{speedTPS === undefined ? "—" : formatRate(speedTPS)}</dd></div>
                  </dl>
                  <div className="event-mobile-runtime">
                    <span>{event.executor_type || "—"}</span>
                    <span>{[event.auth_type, event.auth_index].filter(Boolean).join(" · ") || "—"}</span>
                    <span>{event.service_tier || "—"}</span>
                    {event.status_code ? <span>HTTP {event.status_code}</span> : null}
                  </div>
                  <footer>
                    <span className="billing-badge">{event.billing_mode === "per_call" ? t("usage.events.perCall") : t("usage.events.byToken")}</span>
                    <strong>{event.cost_available ? formatUSD(event.cost_usd) : "—"}</strong>
                  </footer>
                </article>
              );
            })}
            {data.events.length === 0 && <div className="event-mobile-empty muted">{t("usage.noData")}</div>}
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
