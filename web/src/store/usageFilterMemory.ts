import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { patchSearchParams } from "../utils/usageSearchParams";

/** UsageFilterMemoryScope 区分每个页面及管理/Viewer 会话的筛选记忆。 */
export type UsageFilterMemoryScope =
  | "overview-management"
  | "overview-viewer"
  | "events-management"
  | "events-viewer"
  | "key-usage-management"
  | "key-usage-viewer";

/** UsageFilterPatch 表示一次筛选变更需要写入的查询参数。 */
export type UsageFilterPatch = Readonly<Record<string, string | number | undefined>>;

// STORAGE_PREFIX 是用量筛选记忆使用的本地存储键前缀。
const STORAGE_PREFIX = "cpa-keyer-usage-filters";

/**
 * 构造指定页面和会话类型的本地存储键。
 * @param scope 表示页面与会话类型组合。
 * @returns 返回不包含管理密钥或 Viewer Key 的存储键。
 */
function storageKey(scope: UsageFilterMemoryScope): string {
  return `${STORAGE_PREFIX}:${scope}`;
}

/**
 * 判断查询参数是否明确包含当前页面的筛选字段。
 * @param params 表示当前路由查询参数。
 * @param names 表示当前页面允许记忆的筛选字段名。
 * @returns 返回路由是否已经提供筛选状态。
 */
function hasFilterParams(params: URLSearchParams, names: readonly string[]): boolean {
  // name 表示当前检查的筛选字段名。
  return names.some((name) => params.has(name));
}

/**
 * 只保留当前页面允许记忆的筛选字段。
 * @param params 表示待筛选的查询参数。
 * @param names 表示允许记忆的字段名。
 * @returns 返回只包含当前页面筛选字段的新查询参数。
 */
function selectFilterParams(params: URLSearchParams, names: readonly string[]): URLSearchParams {
  // selected 收集当前页面允许持久化的筛选字段。
  const selected = new URLSearchParams();
  // name 表示当前复制的筛选字段名。
  for (const name of names) {
    // value 是当前筛选字段在路由中的值。
    const value = params.get(name);
    if (value !== null) selected.set(name, value);
  }
  return selected;
}

/**
 * 读取指定页面保存的筛选参数。
 * @param scope 表示页面与会话类型组合。
 * @param names 表示当前页面允许记忆的字段名。
 * @returns 返回经过字段约束的筛选参数。
 */
function readFilterParams(scope: UsageFilterMemoryScope, names: readonly string[]): URLSearchParams {
  // stored 是本地存储中的查询参数字符串。
  const stored = localStorage.getItem(storageKey(scope)) ?? "";
  return selectFilterParams(new URLSearchParams(stored), names);
}

/**
 * 保存指定页面的当前筛选参数。
 * @param scope 表示页面与会话类型组合。
 * @param params 表示当前生效的完整查询参数。
 * @param names 表示当前页面允许记忆的字段名。
 */
function writeFilterParams(
  scope: UsageFilterMemoryScope,
  params: URLSearchParams,
  names: readonly string[],
): void {
  // selected 是剔除无关查询字段后的筛选参数。
  const selected = selectFilterParams(params, names);
  localStorage.setItem(storageKey(scope), selected.toString());
}

/**
 * 为用量页面提供“URL 优先、本地记忆补全”的筛选状态。
 * @param scope 表示页面与会话类型组合。
 * @param names 表示当前页面允许记忆的字段名。
 * @returns 返回当前生效参数和统一的筛选更新函数。
 */
export function useRememberedUsageFilters(
  scope: UsageFilterMemoryScope,
  names: readonly string[],
): readonly [URLSearchParams, (values: UsageFilterPatch) => void] {
  // routeParams 是 HashRouter 当前查询参数；setRouteParams 负责替换路由筛选状态。
  const [routeParams, setRouteParams] = useSearchParams();
  // namesKey 是筛选字段集合的稳定依赖标识。
  const namesKey = names.join("\u0000");
  // effectiveParams 是当前页面实际使用的筛选参数；显式 URL 始终优先于本地记忆。
  const effectiveParams = useMemo(() => {
    if (hasFilterParams(routeParams, names)) return routeParams;
    // remembered 是当前页面上次保存的筛选状态。
    const remembered = readFilterParams(scope, names);
    if (!hasFilterParams(remembered, names)) return routeParams;
    // restored 在保留无关查询字段的同时写入记忆筛选。
    const restored = new URLSearchParams(routeParams);
    // name 表示当前恢复的筛选字段名。
    for (const name of names) {
      // value 是记忆中当前筛选字段的值。
      const value = remembered.get(name);
      if (value !== null) restored.set(name, value);
    }
    return restored;
  }, [names, namesKey, routeParams, scope]);
  // routeSignature 是路由查询参数的稳定字符串。
  const routeSignature = routeParams.toString();
  // effectiveSignature 是实际筛选参数的稳定字符串。
  const effectiveSignature = effectiveParams.toString();

  // 以下副作用保存显式 URL 筛选，并把本地恢复值同步回 HashRouter。
  useEffect(() => {
    writeFilterParams(scope, effectiveParams, names);
    if (effectiveSignature !== routeSignature) {
      setRouteParams(effectiveParams, { replace: true });
    }
  }, [effectiveParams, effectiveSignature, names, namesKey, routeSignature, scope, setRouteParams]);

  /**
   * 更新当前筛选，同时同步 URL 和本地记忆。
   * @param values 表示本次需要修改或清除的筛选字段。
   */
  const updateFilters = useCallback((values: UsageFilterPatch) => {
    // next 是应用本次变更后的完整查询参数。
    const next = patchSearchParams(effectiveParams, values);
    writeFilterParams(scope, next, names);
    setRouteParams(next, { replace: true });
  }, [effectiveParams, names, namesKey, scope, setRouteParams]);

  return [effectiveParams, updateFilters] as const;
}
