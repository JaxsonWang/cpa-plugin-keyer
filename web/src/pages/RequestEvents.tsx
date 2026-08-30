import { Fragment, useCallback, useEffect, useState } from "react";
import { fetchUsageEvents } from "../api/usage";
import UsageControls from "../components/UsageControls";
import { useT } from "../i18n";
import type { UsageEvent, UsageEventsResponse } from "../types";
import {
  formatAuthIndex,
  formatCount,
  formatDuration,
  formatMappedDimensionName,
  formatRate,
  formatRequestUSD,
  tokensPerSecond,
} from "../utils/usageFormat";
import { readPositivePage, readUsageRange } from "../utils/usageSearchParams";
import { getSession, isViewerSession } from "../store/session";
import { useRememberedUsageFilters } from "../store/usageFilterMemory";
import { APP_VERSION } from "../version";

// EVENT_FILTER_NAMES 是请求事件页需要跨刷新记忆的筛选字段，分页不作为筛选记忆。
const EVENT_FILTER_NAMES = ["range", "key_id", "provider", "result"] as const;

/**
 * 从接口错误中读取可展示消息。
 * @param error 表示接口抛出的未知错误。
 * @param fallback 表示接口未携带消息时使用的文案。
 * @returns 返回当前页面可展示的错误文本。
 */
function messageOf(error: unknown, fallback: string): string {
  // typed 是带有 Axios 错误响应字段的局部错误视图。
  const typed = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return typed.response?.data?.error?.message ?? typed.message ?? fallback;
}

/**
 * 计算单条请求事件的缓存命中率和输出速度。
 * @param event 表示当前请求事件。
 * @returns 返回缓存 Token、缓存命中率和每秒输出 Token。
 */
function usageEventStats(event: UsageEvent) {
  // cached 是兼容两类事件字段后得到的缓存读取 Token 数。
  const cached = Math.max(event.cache_read_tokens ?? 0, event.cached_tokens ?? 0);
  // cacheRate 是按输入 Token 计算的缓存命中率文本。
  const cacheRate = event.input_tokens
    ? `${(Math.min(1, cached / event.input_tokens) * 100).toFixed(1)}%`
    : "—";
  // speedTPS 是扣除首字延迟后得到的每秒输出 Token 数。
  const speedTPS = tokensPerSecond(event.output_tokens, event.latency_ms, event.ttft_ms);
  return { cached, cacheRate, speedTPS };
}

/** 渲染支持筛选记忆和事件详情展开的请求事件页面。 */
export default function RequestEvents() {
  // t 负责读取当前语言的界面文案。
  const t = useT();
  // viewer 表示当前是否为单 Key Viewer 会话。
  const viewer = isViewerSession(getSession());
  // filterScope 区分管理模式和 Viewer 模式的请求事件筛选记忆。
  const filterScope = viewer ? "events-viewer" : "events-management";
  // searchParams 是恢复记忆后的筛选参数；updateQuery 同步路由和本地记忆。
  const [searchParams, updateQuery] = useRememberedUsageFilters(filterScope, EVENT_FILTER_NAMES);
  // range 是当前查询使用的统计时间范围。
  const range = readUsageRange(searchParams);
  // keyID 是管理模式下选中的 Key ID 筛选值。
  const keyID = searchParams.get("key_id") ?? "";
  // provider 是当前选中的上游来源筛选值。
  const provider = searchParams.get("provider") ?? "";
  // resultParam 是 URL 中尚未校验的请求结果筛选值。
  const resultParam = searchParams.get("result");
  // result 是限制为成功、失败或全部的有效结果筛选值。
  const result: "" | "success" | "failed" = resultParam === "success" || resultParam === "failed" ? resultParam : "";
  // page 是当前请求事件分页页码。
  const page = readPositivePage(searchParams);
  // runtimeLabels 保存运行时字段到当前语言显示文本的映射。
  const runtimeLabels = {
    apikey: t("usage.runtimeLabels.apikey"),
    oauth: t("usage.runtimeLabels.oauth"),
    "openai-responses": t("usage.runtimeLabels.openaiResponses"),
    priority: t("usage.runtimeLabels.priority"),
    flex: t("usage.runtimeLabels.flex"),
    default: t("usage.runtimeLabels.defaultTier"),
    xhigh: t("usage.runtimeLabels.xhigh"),
    high: t("usage.runtimeLabels.high"),
    medium: t("usage.runtimeLabels.medium"),
    low: t("usage.runtimeLabels.low"),
    minimal: t("usage.runtimeLabels.minimal"),
    none: t("usage.runtimeLabels.none"),
  };
  // runtimeLabel 将认证、来源、层级和推理强度转换为界面文案；value 是原始运行时字符串。
  const runtimeLabel = (value?: string) => formatMappedDimensionName(value, t("usage.unrecorded"), runtimeLabels);
  // authReference 拼接认证类型和认证序号；event 是当前请求事件。
  const authReference = (event: UsageEvent) => [
    event.auth_type ? runtimeLabel(event.auth_type) : "",
    formatAuthIndex(event.auth_index),
  ].filter(Boolean).join(" · ") || "—";
  // executionReference 保留执行器原始字符串并拼接认证引用；event 是当前请求事件。
  const executionReference = (event: UsageEvent) => [
    event.executor_type ?? "",
    authReference(event),
  ].filter((value) => value && value !== "—").join(" · ") || "—";
  // expandedEventID 是当前展开详情的事件 ID；setExpandedEventID 更新展开状态。
  const [expandedEventID, setExpandedEventID] = useState<number | null>(null);
  // data 保存请求事件接口响应；setData 更新当前页面数据。
  const [data, setData] = useState<UsageEventsResponse | null>(null);
  // loading 表示页面是否正在加载；setLoading 更新加载状态。
  const [loading, setLoading] = useState(true);
  // error 保存页面错误；setError 更新错误信息。
  const [error, setError] = useState("");

  // load 根据当前筛选和分页重新读取请求事件。
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
      // cause 表示请求事件接口抛出的错误。
      setError(messageOf(cause, t("usage.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [keyID, page, provider, range, result, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="usage-page events-page">
      <div className="usage-page-head events-head">
        <div className="page-heading">
          <span>{t("usage.eyebrow")} · v{APP_VERSION}</span>
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
        onRangeChange={(value) => updateQuery({ range: value, page: undefined })}
        onKeyChange={(value) => updateQuery({ key_id: value, page: undefined })}
        onRefresh={() => void load()}
      >
        <label>
          <span>{t("usage.provider")}</span>
          <select aria-label={t("usage.provider")} value={provider} disabled={loading} onChange={(event) => updateQuery({ provider: event.target.value, page: undefined })}>
            <option value="">{t("usage.allProviders")}</option>
            {(data?.filters.providers ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>{t("usage.result")}</span>
          <select aria-label={t("usage.result")} value={result} disabled={loading} onChange={(event) => updateQuery({ result: event.target.value, page: undefined })}>
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
                  <th className="event-reasoning-effort">{t("usage.events.reasoningEffort")}</th>
                  <th>{t("usage.events.result")}</th>
                  <th>{t("usage.events.performance")}</th>
                  <th className="num">{t("usage.events.cost")}</th>
                  <th aria-label={t("usage.events.details")} />
                </tr>
              </thead>
              <tbody>
                {data.events.map((event) => {
                  const { cached, cacheRate, speedTPS } = usageEventStats(event);
                  const expanded = expandedEventID === event.id;
                  return (
                    <Fragment key={event.id}>
                      <tr>
                        <td className="event-time"><strong>{new Date(event.timestamp).toLocaleString()}</strong><small>#{event.id}</small></td>
                        <td><code className="event-key-id">{event.key_id}</code></td>
                        <td className="event-source">
                          <code>{event.key_preview || "—"}</code>
                          <small>{event.provider || "—"}</small>
                          {event.source && <small>{runtimeLabel(event.source)}</small>}
                        </td>
                        <td className="event-model">
                          <strong>{event.model}</strong>
                          {event.upstream_model && event.upstream_model !== event.model && <small>{t("usage.events.upstream")}: {event.upstream_model}</small>}
                        </td>
                        <td className="event-reasoning-effort">{event.reasoning_effort ? runtimeLabel(event.reasoning_effort) : "—"}</td>
                        <td className="event-result-cell">
                          <span className={`event-result ${event.failed ? "failed" : "success"}`}><i />{event.failed ? t("usage.failed") : t("usage.success")}</span>
                          {event.status_code ? <small>HTTP {event.status_code}</small> : null}
                        </td>
                        <td className="event-performance">
                          <strong>{formatDuration(event.latency_ms)}</strong>
                          <small>TTFT {formatDuration(event.ttft_ms)} · {speedTPS === undefined ? "—" : `${formatRate(speedTPS)} TPS`}</small>
                        </td>
                        <td className="num mono event-cost">{event.cost_available ? formatRequestUSD(event.cost_usd) : "—"}</td>
                        <td className="event-detail-action">
                          <button
                            className="btn sm"
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={`event-details-${event.id}`}
                            aria-label={t(expanded ? "usage.events.collapseDetails" : "usage.events.toggleDetails", { id: event.id })}
                            onClick={() => setExpandedEventID(expanded ? null : event.id)}
                          >
                            {t(expanded ? "usage.events.hideDetails" : "usage.events.details")}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr id={`event-details-${event.id}`} className="event-details-row">
                          <td colSpan={9}>
                            <dl className="event-detail-grid">
                              <div><dt>{t("usage.events.billing")}</dt><dd>{event.billing_mode === "per_call" ? t("usage.events.perCall") : t("usage.events.byToken")}</dd></div>
                              <div title={event.auth_index}>
                                <dt>{t("usage.events.executor")}</dt>
                                <dd>{executionReference(event)}</dd>
                              </div>
                              <div><dt>{t("usage.events.serviceTier")}</dt><dd>{event.service_tier ? runtimeLabel(event.service_tier) : "—"}</dd></div>
                              <div><dt>{t("usage.stats.input")}</dt><dd>{formatCount(event.input_tokens)}</dd></div>
                              <div><dt>{t("usage.stats.output")}</dt><dd>{formatCount(event.output_tokens)}</dd></div>
                              <div><dt>{t("usage.stats.reasoning")}</dt><dd>{formatCount(event.reasoning_tokens ?? 0)}</dd></div>
                              <div><dt>{t("usage.stats.cacheRead")}</dt><dd>{formatCount(cached)} · {cacheRate}</dd></div>
                              <div title={event.cache_creation_tokens ? undefined : t("usage.events.cacheCreationUnavailable")}><dt>{t("usage.stats.cacheCreation")}</dt><dd>{event.cache_creation_tokens ? formatCount(event.cache_creation_tokens) : "—"}</dd></div>
                              <div><dt>{t("usage.events.tokens")}</dt><dd>{formatCount(event.total_tokens)}</dd></div>
                              <div><dt>{t("usage.analysis.uncachedInput")}</dt><dd>{formatRequestUSD(event.uncached_input_cost_usd)}</dd></div>
                              <div><dt>{t("usage.analysis.cacheReadCost")}</dt><dd>{formatRequestUSD(event.cache_read_cost_usd)}</dd></div>
                              <div><dt>{t("usage.analysis.outputCost")}</dt><dd>{formatRequestUSD(event.output_cost_usd)}</dd></div>
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {data.events.length === 0 && <tr><td colSpan={9} className="events-empty muted">{t("usage.noData")}</td></tr>}
              </tbody>
            </table>
          </div>
          {data.total_pages > 1 && (
            <div className="events-pagination">
              <button className="btn sm" disabled={loading || page <= 1} onClick={() => updateQuery({ page: Math.max(1, page - 1) })}>{t("usage.previous")}</button>
              <span>{t("usage.page", { page: data.page, total: data.total_pages })}</span>
              <button className="btn sm" disabled={loading || page >= data.total_pages} onClick={() => updateQuery({ page: page + 1 })}>{t("usage.next")}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
