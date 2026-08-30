import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAppliedTheme,
  getThemePreference,
  initThemeSync,
  setThemePreference,
  _resolveParentTheme,
  _teardownThemeSync,
} from "./themeSync";

// realSelf 保存测试前浏览器窗口的 self 引用。
const realSelf = window.self;
// realTop 保存测试前浏览器窗口的 top 引用。
const realTop = window.top;
// realParentDescriptor 保存测试前 parent 属性描述符。
const realParentDescriptor = Object.getOwnPropertyDescriptor(window, "parent");
// dark 表示系统深色媒体查询的当前结果。
let dark = false;
// changeListener 保存主题模块注册的系统主题变化回调。
let changeListener: (() => void) | undefined;

/**
 * 切换测试中的独立页或 CPA 内嵌环境。
 * @param embedded 表示是否模拟 CPA 内嵌环境。
 * @param parentHtml 表示 CPA 父页面的根元素。
 */
function setEmbedded(embedded: boolean, parentHtml: HTMLElement): void {
  Object.defineProperty(window, "self", { value: window, configurable: true });
  Object.defineProperty(window, "top", {
    value: embedded ? ({} as Window) : window,
    configurable: true,
  });
  Object.defineProperty(window, "parent", {
    configurable: true,
    get: () => ({ document: { documentElement: parentHtml } }),
  });
}

// 以下前置回调清理存储并提供可控制的系统主题媒体查询。
beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  localStorage.clear();
  dark = false;
  changeListener = undefined;
  setEmbedded(false, document.documentElement);
  // 以下 matchMedia 模拟回调返回可随 dark 更新的媒体查询对象。
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return dark; },
    media: "(prefers-color-scheme: dark)",
    // _event 是未使用的媒体事件名称，listener 是主题模块注册的变化回调。
    addEventListener: (_event: string, listener: () => void) => { changeListener = listener; },
    removeEventListener: vi.fn(),
  })));
});

// 以下清理回调移除主题监听并恢复浏览器窗口属性。
afterEach(() => {
  _teardownThemeSync();
  Object.defineProperty(window, "self", { value: realSelf, configurable: true });
  Object.defineProperty(window, "top", { value: realTop, configurable: true });
  if (realParentDescriptor) Object.defineProperty(window, "parent", realParentDescriptor);
  localStorage.clear();
  vi.unstubAllGlobals();
});

// 以下测试组验证独立页自动、白天和黑夜主题偏好。
describe("standalone theme preference", () => {
  // 以下用例回调验证默认自动模式跟随系统浅色主题。
  it("defaults to auto and follows the light system theme", () => {
    initThemeSync();
    expect(getThemePreference()).toBe("auto");
    expect(getAppliedTheme()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  // 以下用例回调验证首屏初始化读取已保存的黑夜偏好。
  it("applies a saved dark preference before rendering", () => {
    localStorage.setItem("cpa-keyer-theme", "dark");
    initThemeSync();
    expect(getThemePreference()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  // 以下用例回调验证显式主题选择写入存储并立即应用。
  it("persists explicit light and dark choices", () => {
    initThemeSync();
    setThemePreference("dark");
    expect(localStorage.getItem("cpa-keyer-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    setThemePreference("light");
    expect(localStorage.getItem("cpa-keyer-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  // 以下用例回调验证自动模式响应操作系统主题变化。
  it("updates auto when the system color scheme changes", () => {
    initThemeSync();
    dark = true;
    changeListener?.();
    expect(getAppliedTheme()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  // 以下用例回调验证显式选择不被系统主题变化覆盖。
  it("does not let system changes override an explicit choice", () => {
    initThemeSync();
    setThemePreference("light");
    dark = true;
    changeListener?.();
    expect(getAppliedTheme()).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  // 以下用例回调验证其他独立页标签的主题选择可同步到当前页面。
  it("synchronizes a choice made in another standalone tab", () => {
    initThemeSync();
    window.dispatchEvent(new StorageEvent("storage", { key: "cpa-keyer-theme", newValue: "dark" }));
    expect(getThemePreference()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

// 以下测试组验证 CPA 父页面实际主题的解析规则。
describe("embedded parent theme resolver", () => {
  // 以下用例回调验证独立页不会读取父页面主题。
  it("returns null when the page is standalone", () => {
    expect(_resolveParentTheme()).toBeNull();
  });

  // 以下用例回调验证 CPA 纯白主题属性保持不变。
  it("reads white from the parent html", () => {
    // parentHtml 表示带纯白主题的 CPA 根元素。
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "white");
    setEmbedded(true, parentHtml);
    expect(_resolveParentTheme()).toBe("white");
  });

  // 以下用例回调验证 CPA 深色主题属性保持不变。
  it("reads dark from the parent html", () => {
    // parentHtml 表示带深色主题的 CPA 根元素。
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "dark");
    setEmbedded(true, parentHtml);
    expect(_resolveParentTheme()).toBe("dark");
  });

  // 以下用例回调验证 CPA 未设置属性时使用默认浅色主题。
  it("maps an absent parent attribute to light", () => {
    // parentHtml 表示使用默认浅色主题的 CPA 根元素。
    const parentHtml = document.createElement("html");
    setEmbedded(true, parentHtml);
    expect(_resolveParentTheme()).toBe("light");
  });
});

// 以下测试组验证内嵌页只跟随 CPA 内置主题来源。
describe("embedded CPA theme synchronization", () => {
  // 以下用例回调验证 CPA 纯白主题在首屏前同步到内嵌页。
  it("applies the parent white theme before rendering", () => {
    // parentHtml 表示带纯白主题的 CPA 根元素。
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "white");
    setEmbedded(true, parentHtml);
    initThemeSync();
    expect(getAppliedTheme()).toBe("white");
    expect(document.documentElement.getAttribute("data-theme")).toBe("white");
  });

  // 以下用例回调验证独立页历史偏好不会覆盖 CPA 深色主题。
  it("ignores the standalone preference while embedded", () => {
    // parentHtml 表示带深色主题的 CPA 根元素。
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "dark");
    localStorage.setItem("cpa-keyer-theme", "light");
    setEmbedded(true, parentHtml);
    initThemeSync();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  // 以下用例回调验证 CPA 内置切换写入后同步新的实际主题。
  it("follows the CPA theme storage event", () => {
    // parentHtml 表示可在测试中切换主题的 CPA 根元素。
    const parentHtml = document.createElement("html");
    setEmbedded(true, parentHtml);
    initThemeSync();
    parentHtml.setAttribute("data-theme", "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: "cli-proxy-theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  // 以下用例回调验证独立页存储事件不会修改 CPA 内嵌主题。
  it("ignores standalone theme storage events", () => {
    // parentHtml 表示带纯白主题的 CPA 根元素。
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "white");
    setEmbedded(true, parentHtml);
    initThemeSync();
    parentHtml.setAttribute("data-theme", "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: "cpa-keyer-theme", newValue: "dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("white");
  });

  // 以下用例回调验证 Keyer 主题设置接口不会越过 CPA 主题边界。
  it("does not let the Keyer preference override the CPA theme", () => {
    // parentHtml 表示带深色主题的 CPA 根元素。
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "dark");
    setEmbedded(true, parentHtml);
    initThemeSync();
    setThemePreference("light");
    expect(localStorage.getItem("cpa-keyer-theme")).toBeNull();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
