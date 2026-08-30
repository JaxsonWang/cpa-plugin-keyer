import { act } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 以下模拟工厂提供可切换的 CPA 内嵌环境状态。
vi.mock("./store/panelAuth", () => ({
  isEmbedded: vi.fn(),
  readPanelAuth: vi.fn(() => null),
}));
// 以下页面模拟工厂让外壳测试只关注路由和导航状态。
vi.mock("./pages/KeyList", () => ({ default: () => <div data-testid="key-list">Key list content</div> }));
vi.mock("./pages/KeyNew", () => ({ default: () => <div>New key content</div> }));
vi.mock("./pages/KeyEdit", () => ({ default: () => <div>Edit key content</div> }));
// viewerKeyID 表示 Viewer 路由传入的当前 Key ID。
vi.mock("./pages/KeyUsage", () => ({ default: ({ viewerKeyID }: { viewerKeyID?: string }) => <div>Usage content {viewerKeyID}</div> }));
vi.mock("./pages/ModelPick", () => ({ default: () => <div>Model picker content</div> }));
vi.mock("./pages/Login", () => ({ default: () => <div>Login content</div> }));
vi.mock("./pages/UsageOverview", () => ({ default: () => <div>Overview content</div> }));
vi.mock("./pages/RequestEvents", () => ({ default: () => <div>Events content</div> }));

import App from "./App";
import { isEmbedded } from "./store/panelAuth";
import { clearSession, setSession, setViewerSession, verifySession } from "./store/session";

// container 是每个用例使用的页面挂载节点。
let container: HTMLDivElement;
// root 是 React 测试根节点。
let root: ReturnType<typeof createRoot>;

/**
 * 渲染管理模式应用外壳。
 * @param embedded 表示是否模拟 CPA 内嵌环境。
 * @param initialPath 表示初始业务路径。
 */
async function renderApp(embedded: boolean, initialPath = "/keys") {
  vi.mocked(isEmbedded).mockReturnValue(embedded);
  setSession("http://127.0.0.1:8317", "secret");
  await act(async () => {
    root = createRoot(container);
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>,
    );
  });
}

/**
 * 渲染单 Key Viewer 应用外壳。
 * @param initialPath 表示初始 Viewer 路径。
 */
async function renderViewerApp(initialPath = "/key/cpa_viewer") {
  vi.mocked(isEmbedded).mockReturnValue(false);
  setViewerSession("http://127.0.0.1:8317", "cpa_viewer", "direct");
  // 以下认证回调返回 Viewer 可读取的当前 Key。
  await verifySession(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ keys: [{ id: "team-a" }] }),
  } as Response));
  await act(async () => {
    root = createRoot(container);
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>,
    );
  });
}

// 以下前置回调为每个用例创建干净的路由和挂载节点。
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
});

// 以下清理回调卸载页面并清除会话、节点和模拟状态。
afterEach(() => {
  act(() => root.unmount());
  clearSession();
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// 以下测试组验证独立页和 CPA 内嵌页的外壳、导航与 Viewer 边界。
describe("App shell", () => {
  // 以下用例回调验证内嵌页只保留统一的业务导航。
  it("removes the standalone navigation and workspace header when embedded in CPA", async () => {
    await renderApp(true);

    expect(container.querySelector(".app")?.classList.contains("is-embedded")).toBe(true);
    expect(container.querySelector(".topnav")).toBeNull();
    expect(container.querySelector(".workspace-header")).toBeNull();
    expect(container.querySelector(".theme-control")).toBeNull();
    // sectionLinks 保存内嵌导航文案；映射回调中的 link 表示当前导航链接。
    const sectionLinks = Array.from(container.querySelectorAll(".section-nav a"), (link) => link.textContent);
    expect(sectionLinks).toEqual(["概览", "请求事件", "订阅计划", "Key 列表", "新建 Key"]);
    expect(container.querySelector(".section-nav")?.textContent).not.toContain("分析");
    expect(container.textContent).toContain("Key list content");
  });

  // 以下用例回调验证新建 Key 子流程持续显示内嵌导航。
  it("keeps the embedded top navigation visible throughout the new-key flow", async () => {
    await renderApp(true, "/keys/new/models");

    // nav 是 CPA 内嵌页的业务导航节点。
    const nav = container.querySelector(".section-nav");
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('a[href="/keys/new"]')?.classList.contains("active")).toBe(true);
    expect(container.textContent).toContain("Model picker content");
  });

  // 以下用例回调验证独立页导航包含完整入口且不重复旧页面头部。
  it("keeps the standalone shell without the redundant workspace header or a logout action", async () => {
    await renderApp(false);

    expect(container.querySelector(".app")?.classList.contains("is-embedded")).toBe(false);
    expect(container.querySelector("header.topnav")).not.toBeNull();
    expect(container.querySelector(".workspace-header")).toBeNull();
    expect(container.querySelector(".tn-title")?.textContent).toBe("Keyer");
    expect(container.querySelector(".tn-version")?.textContent).toBe("KEYER · v0.7.10");
    expect(container.querySelector(".tn-connection")).not.toBeNull();
    expect(container.querySelector("header.topnav .theme-control")).not.toBeNull();
    expect(container.querySelector(".theme-mobile-slot .theme-control")).not.toBeNull();
    // topLinks 保存独立页导航文案；映射回调中的 link 表示当前导航链接。
    const topLinks = Array.from(container.querySelectorAll(".topnav-actions a"), (link) => link.textContent);
    expect(topLinks).toEqual(["概览", "请求事件", "订阅计划", "Key 列表", "新建 Key"]);
    expect(container.querySelectorAll(".topnav-actions svg")).toHaveLength(5);
    expect(container.textContent).not.toContain("退出");
  });

  // 以下用例回调验证根路径进入概览并标记正确入口。
  it("opens the overview from the Keyer root path", async () => {
    await renderApp(true, "/");

    expect(container.textContent).toContain("Overview content");
    expect(container.querySelector('.section-nav a[href="/overview"]')?.classList.contains("active")).toBe(true);
    expect(container.querySelector('[data-testid="key-list"]')).toBeNull();
  });

  // 以下用例回调验证 Viewer 仅获得当前 Key 的三个只读入口。
  it("limits a direct viewer session to key details, overview, and request events", async () => {
    await renderViewerApp();

    // topLinks 保存 Viewer 独立页导航文案；映射回调中的 link 表示当前链接。
    const topLinks = Array.from(container.querySelectorAll(".topnav-actions a"), (link) => link.textContent);
    // sectionLinks 保存 Viewer 内嵌页导航文案；映射回调中的 link 表示当前链接。
    const sectionLinks = Array.from(container.querySelectorAll(".section-nav a"), (link) => link.textContent);
    expect(topLinks).toEqual(["Key 详情", "概览", "请求事件"]);
    expect(sectionLinks).toEqual(["Key 详情", "概览", "请求事件"]);
    expect(container.textContent).toContain("Usage content team-a");
    expect(container.textContent).not.toContain("Key 列表");
    expect(container.textContent).not.toContain("新建 Key");
    expect(container.querySelector(".tn-connection")).toBeNull();
    expect(container.querySelector('a[href="/key/cpa_viewer"]')?.classList.contains("active")).toBe(true);
  });

  // 以下用例回调验证无效 Viewer Key 显示专用错误而非管理登录。
  it("shows a dedicated error instead of the management login for an invalid viewer key", async () => {
    window.location.hash = "#/key/cpa_invalid";
    // 以下 fetch 模拟回调返回下游 Key 未授权响应。
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401 } as Response)));
    await act(async () => {
      root = createRoot(container);
      root.render(
        <MemoryRouter initialEntries={["/key/cpa_invalid"]}>
          <App />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Key 无效或已失效");
    expect(container.textContent).not.toContain("Login content");
  });

  // 以下用例回调验证 URL Key 变化后重新认证且不保留旧 Viewer 数据。
  it("re-authenticates when the key in the direct hash URL changes", async () => {
    vi.mocked(isEmbedded).mockReturnValue(false);
    window.location.hash = "#/key/cpa_viewer";
    // 以下 fetch 模拟回调中，_input 是未使用的请求地址，init 保存认证请求配置。
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      // authorization 是本次验证请求携带的 Bearer 头。
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (authorization === "Bearer cpa_viewer") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ keys: [{ id: "team-a" }] }),
        } as Response;
      }
      return { ok: false, status: 401 } as Response;
    }));
    await act(async () => {
      root = createRoot(container);
      root.render(<HashRouter><App /></HashRouter>);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Usage content team-a");

    await act(async () => {
      window.location.hash = "#/key/cpa_invalid";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Key 无效或已失效");
    expect(container.textContent).not.toContain("Usage content team-a");
  });
});
