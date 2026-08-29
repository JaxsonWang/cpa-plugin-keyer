import { act } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./store/panelAuth", () => ({
  isEmbedded: vi.fn(),
  readPanelAuth: vi.fn(() => null),
}));
vi.mock("./pages/KeyList", () => ({ default: () => <div data-testid="key-list">Key list content</div> }));
vi.mock("./pages/KeyNew", () => ({ default: () => <div>New key content</div> }));
vi.mock("./pages/KeyEdit", () => ({ default: () => <div>Edit key content</div> }));
vi.mock("./pages/KeyUsage", () => ({ default: ({ viewerKeyID }: { viewerKeyID?: string }) => <div>Usage content {viewerKeyID}</div> }));
vi.mock("./pages/ModelPick", () => ({ default: () => <div>Model picker content</div> }));
vi.mock("./pages/Login", () => ({ default: () => <div>Login content</div> }));
vi.mock("./pages/UsageOverview", () => ({ default: () => <div>Overview content</div> }));
vi.mock("./pages/RequestEvents", () => ({ default: () => <div>Events content</div> }));

import App from "./App";
import { isEmbedded } from "./store/panelAuth";
import { clearSession, setSession, setViewerSession, verifySession } from "./store/session";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

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

async function renderViewerApp(initialPath = "/key/cpa_viewer") {
  vi.mocked(isEmbedded).mockReturnValue(false);
  setViewerSession("http://127.0.0.1:8317", "cpa_viewer", "direct");
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

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  clearSession();
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("App shell", () => {
  it("removes the standalone navigation and workspace header when embedded in CPA", async () => {
    await renderApp(true);

    expect(container.querySelector(".app")?.classList.contains("is-embedded")).toBe(true);
    expect(container.querySelector(".topnav")).toBeNull();
    expect(container.querySelector(".workspace-header")).toBeNull();
    const sectionLinks = Array.from(container.querySelectorAll(".section-nav a"), (link) => link.textContent);
    expect(sectionLinks).toEqual(["概览", "请求事件", "Key 列表", "新建 Key"]);
    expect(container.querySelector(".section-nav")?.textContent).not.toContain("分析");
    expect(container.textContent).toContain("Key list content");
  });

  it("keeps the embedded top navigation visible throughout the new-key flow", async () => {
    await renderApp(true, "/keys/new/models");

    const nav = container.querySelector(".section-nav");
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('a[href="/keys/new"]')?.classList.contains("active")).toBe(true);
    expect(container.textContent).toContain("Model picker content");
  });

  it("keeps the standalone shell without the redundant workspace header or a logout action", async () => {
    await renderApp(false);

    expect(container.querySelector(".app")?.classList.contains("is-embedded")).toBe(false);
    expect(container.querySelector("header.topnav")).not.toBeNull();
    expect(container.querySelector(".workspace-header")).toBeNull();
    expect(container.querySelector(".tn-title")?.textContent).toBe("Keyer");
    expect(container.querySelector(".tn-version")?.textContent).toBe("KEYER · v0.7.9");
    expect(container.querySelector(".tn-connection")).not.toBeNull();
    const topLinks = Array.from(container.querySelectorAll(".topnav-actions a"), (link) => link.textContent);
    expect(topLinks).toEqual(["概览", "请求事件", "Key 列表", "新建 Key"]);
    expect(container.querySelectorAll(".topnav-actions svg")).toHaveLength(4);
    expect(container.textContent).not.toContain("退出");
  });

  it("opens the overview from the Keyer root path", async () => {
    await renderApp(true, "/");

    expect(container.textContent).toContain("Overview content");
    expect(container.querySelector('.section-nav a[href="/overview"]')?.classList.contains("active")).toBe(true);
    expect(container.querySelector('[data-testid="key-list"]')).toBeNull();
  });

  it("limits a direct viewer session to key details, overview, and request events", async () => {
    await renderViewerApp();

    const topLinks = Array.from(container.querySelectorAll(".topnav-actions a"), (link) => link.textContent);
    const sectionLinks = Array.from(container.querySelectorAll(".section-nav a"), (link) => link.textContent);
    expect(topLinks).toEqual(["Key 详情", "概览", "请求事件"]);
    expect(sectionLinks).toEqual(["Key 详情", "概览", "请求事件"]);
    expect(container.textContent).toContain("Usage content team-a");
    expect(container.textContent).not.toContain("Key 列表");
    expect(container.textContent).not.toContain("新建 Key");
    expect(container.querySelector(".tn-connection")).toBeNull();
    expect(container.querySelector('a[href="/key/cpa_viewer"]')?.classList.contains("active")).toBe(true);
  });

  it("shows a dedicated error instead of the management login for an invalid viewer key", async () => {
    window.location.hash = "#/key/cpa_invalid";
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

  it("re-authenticates when the key in the direct hash URL changes", async () => {
    vi.mocked(isEmbedded).mockReturnValue(false);
    window.location.hash = "#/key/cpa_viewer";
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
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
