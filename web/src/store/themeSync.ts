import { isEmbedded } from "./panelAuth";

// THEME_ATTR 是当前文档和 CPA 父页面共用的主题属性名。
const THEME_ATTR = "data-theme";
// STANDALONE_STORAGE_KEY 是独立页主题偏好的本地存储键。
const STANDALONE_STORAGE_KEY = "cpa-keyer-theme";
// PANEL_STORAGE_KEY 是 CPA 内置主题选择写入的本地存储键。
const PANEL_STORAGE_KEY = "cli-proxy-theme";

/** ThemePreference 表示独立页可选的自动、白天和黑夜主题偏好。 */
export type ThemePreference = "auto" | "light" | "dark";
/** AppliedTheme 表示页面最终应用的浅色、纯白或深色主题。 */
export type AppliedTheme = "light" | "white" | "dark";

// listeners 保存需要响应主题变化的订阅回调。
const listeners = new Set<() => void>();
// preference 保存独立页当前主题偏好，初始值为自动。
let preference: ThemePreference = "auto";
// appliedTheme 保存当前文档实际应用的主题。
let appliedTheme: AppliedTheme = "light";
// started 表示主题同步是否已经初始化。
let started = false;
// embeddedMode 表示本轮初始化是否运行在 CPA 内嵌环境。
let embeddedMode = false;
// media 保存独立页监听系统深色模式的媒体查询对象。
let media: MediaQueryList | null = null;
// storageHandler 保存当前模式对应的本地存储事件回调。
let storageHandler: ((event: StorageEvent) => void) | null = null;

/**
 * 判断存储值是否为支持的独立页主题偏好。
 * @param value 表示待校验的存储字符串。
 * @returns 返回该值是否属于主题偏好联合类型。
 */
function isThemePreference(value: string | null): value is ThemePreference {
  return value === "auto" || value === "light" || value === "dark";
}

/**
 * 读取独立页保存的主题偏好。
 * @returns 返回已保存偏好；没有有效记录时返回自动。
 */
function readPreference(): ThemePreference {
  try {
    // stored 是独立页本地存储中的主题偏好字符串。
    const stored = localStorage.getItem(STANDALONE_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

/**
 * 读取 CPA 父页面当前已经应用的主题。
 * @returns 返回父页面的浅色、纯白或深色主题；独立页返回空值。
 */
function readParentTheme(): AppliedTheme | null {
  if (!isEmbedded()) return null;
  // parentElement 保存可读取的同源 CPA 根元素。
  let parentElement: HTMLElement;
  try {
    parentElement = window.parent.document.documentElement;
  } catch {
    return null;
  }
  // rawTheme 是 CPA 根元素当前写入的主题属性。
  const rawTheme = parentElement.getAttribute(THEME_ATTR);
  if (rawTheme === "white" || rawTheme === "dark") return rawTheme;
  return "light";
}

/**
 * 读取操作系统当前是否偏好深色主题。
 * @returns 返回系统媒体查询是否匹配深色模式。
 */
function systemDark(): boolean {
  if (media) return media.matches;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * 将独立页偏好解析为实际主题。
 * @param value 表示用户选择的主题偏好。
 * @returns 返回独立页当前应应用的浅色或深色主题。
 */
function resolveStandaloneTheme(value: ThemePreference): AppliedTheme {
  if (value === "auto") return systemDark() ? "dark" : "light";
  return value;
}

/**
 * 将实际主题写入当前文档根元素。
 * @param next 表示需要应用的浅色、纯白或深色主题。
 */
function applyTheme(next: AppliedTheme): void {
  // rootElement 是 Keyer 当前文档的根元素。
  const rootElement = document.documentElement;
  appliedTheme = next;
  if (next === "white" || next === "dark") rootElement.setAttribute(THEME_ATTR, next);
  else rootElement.removeAttribute(THEME_ATTR);
  rootElement.style.colorScheme = next === "dark" ? "dark" : "light";
}

/** 同步独立页偏好解析出的实际主题。 */
function syncStandaloneTheme(): void {
  applyTheme(resolveStandaloneTheme(preference));
}

/** 同步 CPA 父页面已经应用的实际主题。 */
function syncEmbeddedTheme(): void {
  applyTheme(readParentTheme() ?? "light");
}

/** 向全部主题订阅者广播当前状态变化。 */
function emit(): void {
  // listener 表示当前执行的主题订阅回调。
  for (const listener of listeners) listener();
}

/** 在系统主题变化时更新独立页自动模式。 */
function onSystemThemeChange(): void {
  if (preference !== "auto") return;
  syncStandaloneTheme();
  emit();
}

/** 初始化主题来源：内嵌页跟随 CPA，独立页使用自己的主题偏好。 */
export function initThemeSync(): void {
  if (started) return;
  started = true;
  embeddedMode = isEmbedded();

  if (embeddedMode) {
    syncEmbeddedTheme();
    // 以下回调在 CPA 内置主题变化后重新读取父页面实际主题。
    storageHandler = (event: StorageEvent) => {
      if (event.key !== PANEL_STORAGE_KEY) return;
      syncEmbeddedTheme();
      emit();
    };
    window.addEventListener("storage", storageHandler);
    return;
  }

  preference = readPreference();
  if (typeof window.matchMedia === "function") {
    media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener?.("change", onSystemThemeChange);
  }
  syncStandaloneTheme();
  // 以下回调同步其他独立页标签写入的主题偏好。
  storageHandler = (event: StorageEvent) => {
    if (event.key !== STANDALONE_STORAGE_KEY) return;
    // next 是存储事件携带的新主题偏好。
    const next = isThemePreference(event.newValue) ? event.newValue : "auto";
    if (next === preference) return;
    preference = next;
    syncStandaloneTheme();
    emit();
  };
  window.addEventListener("storage", storageHandler);
}

/**
 * 读取独立页当前主题偏好。
 * @returns 返回自动、白天或黑夜偏好。
 */
export function getThemePreference(): ThemePreference {
  return preference;
}

/**
 * 读取当前文档实际应用的主题。
 * @returns 返回浅色、纯白或深色主题。
 */
export function getAppliedTheme(): AppliedTheme {
  return appliedTheme;
}

/**
 * 设置并持久化独立页主题偏好；内嵌页的主题仅由 CPA 管理。
 * @param next 表示用户选择的新主题偏好。
 */
export function setThemePreference(next: ThemePreference): void {
  if (embeddedMode || !isThemePreference(next)) return;
  preference = next;
  try {
    localStorage.setItem(STANDALONE_STORAGE_KEY, next);
  } catch {
    // 当前独立页继续应用已选择主题，不中断后续渲染更新。
  }
  syncStandaloneTheme();
  emit();
}

/**
 * 订阅主题状态变化。
 * @param listener 表示主题变化后执行的回调。
 * @returns 返回取消当前订阅的函数。
 */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  // 以下返回回调从订阅集合中移除当前 listener。
  return () => listeners.delete(listener);
}

/** 清理主题事件监听并恢复测试初始状态。 */
export function _teardownThemeSync(): void {
  media?.removeEventListener?.("change", onSystemThemeChange);
  media = null;
  if (storageHandler) window.removeEventListener("storage", storageHandler);
  storageHandler = null;
  listeners.clear();
  preference = "auto";
  appliedTheme = "light";
  started = false;
  embeddedMode = false;
  document.documentElement.removeAttribute(THEME_ATTR);
  document.documentElement.style.colorScheme = "";
}

/**
 * 读取 CPA 父页面主题，供同步边界测试使用。
 * @returns 返回父页面实际主题；独立页返回空值。
 */
export function _resolveParentTheme(): AppliedTheme | null {
  return readParentTheme();
}
