import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./store/panelAuth", () => ({
  isEmbedded: vi.fn(),
  readPanelAuth: vi.fn(() => null),
}));
vi.mock("./pages/KeyList", () => ({ default: () => <div data-testid="key-list">Key list content</div> }));
vi.mock("./pages/KeyNew", () => ({ default: () => <div>New key content</div> }));
vi.mock("./pages/KeyEdit", () => ({ default: () => <div>Edit key content</div> }));
vi.mock("./pages/KeyUsage", () => ({ default: () => <div>Usage content</div> }));
vi.mock("./pages/ModelPick", () => ({ default: () => <div>Model picker content</div> }));
vi.mock("./pages/Login", () => ({ default: () => <div>Login content</div> }));
vi.mock("./pages/UsageOverview", () => ({ default: () => <div>Overview content</div> }));
vi.mock("./pages/RequestEvents", () => ({ default: () => <div>Events content</div> }));

import App from "./App";
import { isEmbedded } from "./store/panelAuth";
import { clearSession, setSession } from "./store/session";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function renderApp(embedded: boolean) {
  vi.mocked(isEmbedded).mockReturnValue(embedded);
  setSession("http://127.0.0.1:8317", "secret");
  await act(async () => {
    root = createRoot(container);
    root.render(
      <MemoryRouter initialEntries={["/keys"]}>
        <App />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  clearSession();
  container.remove();
  vi.clearAllMocks();
});

describe("App shell", () => {
  it("removes the standalone navigation and workspace header when embedded in CPA", async () => {
    await renderApp(true);

    expect(container.querySelector(".app")?.classList.contains("is-embedded")).toBe(true);
    expect(container.querySelector(".topnav")).toBeNull();
    expect(container.querySelector(".workspace-header")).toBeNull();
    const sectionLinks = Array.from(container.querySelectorAll(".section-nav a"), (link) => link.textContent);
    expect(sectionLinks).toEqual(["概览", "请求事件", "Key 列表"]);
    expect(container.querySelector(".section-nav")?.textContent).not.toContain("分析");
    expect(container.textContent).toContain("Key list content");
  });

  it("keeps the standalone shell without a logout action when opened directly", async () => {
    await renderApp(false);

    expect(container.querySelector(".app")?.classList.contains("is-embedded")).toBe(false);
    expect(container.querySelector(".topnav")).not.toBeNull();
    expect(container.querySelector(".workspace-header")).not.toBeNull();
    expect(container.querySelector(".tn-title")?.textContent).toBe("Keyer");
    expect(container.querySelector(".tn-version")?.textContent).toBe("KEYER · v0.7.3");
    const topLinks = Array.from(container.querySelectorAll(".topnav-actions a"), (link) => link.textContent);
    expect(topLinks).toEqual(["概览", "请求事件", "Key 列表", "新建 Key"]);
    expect(container.querySelectorAll(".topnav-actions svg")).toHaveLength(4);
    expect(container.textContent).not.toContain("退出");
  });
});
