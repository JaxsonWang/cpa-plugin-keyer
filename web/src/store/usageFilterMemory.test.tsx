import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useRememberedUsageFilters } from "./usageFilterMemory";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// FILTER_NAMES 是测试页允许记忆的概览筛选字段。
const FILTER_NAMES = ["range", "key_id"] as const;
// container 是测试组件挂载节点。
let container: HTMLDivElement;
// root 是 React 测试根节点。
let root: ReturnType<typeof createRoot>;
// tick 等待一轮异步任务；Promise 回调中的 resolve 用于结束等待。
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 渲染使用管理概览筛选记忆的测试组件。
 * @returns 返回当前筛选、当前路由及筛选修改入口。
 */
function FilterProbe() {
  // params 是恢复记忆后的筛选参数；updateFilters 同步路由和本地记忆。
  const [params, updateFilters] = useRememberedUsageFilters("overview-management", FILTER_NAMES);
  // location 保存当前 MemoryRouter 路由位置。
  const location = useLocation();
  // handleChange 将测试筛选修改为最近 24 小时和 team-b。
  const handleChange = () => updateFilters({ range: "24h", key_id: "team-b" });
  return (
    <div>
      <span data-testid="range">{params.get("range") ?? "7d"}</span>
      <span data-testid="key">{params.get("key_id") ?? ""}</span>
      <span data-testid="search">{location.search}</span>
      <button type="button" onClick={handleChange}>change filters</button>
    </div>
  );
}

// 以下前置回调为每个用例创建空存储和独立挂载节点。
beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

// 以下清理回调卸载测试组件并移除挂载节点。
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// 以下测试组验证筛选记忆与 HashRouter 查询参数的单向恢复规则。
describe("usage filter memory", () => {
  // 以下用例回调验证无查询参数时恢复记忆，并在修改后同步两处状态。
  it("restores remembered filters and persists later changes", async () => {
    localStorage.setItem("cpa-keyer-usage-filters:overview-management", "range=30d&key_id=team-a");
    await act(async () => {
      root = createRoot(container);
      root.render(<MemoryRouter initialEntries={["/overview"]}><FilterProbe /></MemoryRouter>);
      await tick();
    });

    expect(container.querySelector('[data-testid="range"]')?.textContent).toBe("30d");
    expect(container.querySelector('[data-testid="key"]')?.textContent).toBe("team-a");
    expect(container.querySelector('[data-testid="search"]')?.textContent).toContain("range=30d");

    // changeButton 是触发筛选修改的测试按钮。
    const changeButton = container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      changeButton.click();
      await tick();
    });
    expect(localStorage.getItem("cpa-keyer-usage-filters:overview-management")).toBe("range=24h&key_id=team-b");
  });

  // 以下用例回调验证显式 URL 筛选优先，并覆盖该页面的旧记忆。
  it("prefers explicit URL filters over remembered values", async () => {
    localStorage.setItem("cpa-keyer-usage-filters:overview-management", "range=30d&key_id=team-a");
    await act(async () => {
      root = createRoot(container);
      root.render(<MemoryRouter initialEntries={["/overview?range=90d"]}><FilterProbe /></MemoryRouter>);
      await tick();
    });

    expect(container.querySelector('[data-testid="range"]')?.textContent).toBe("90d");
    expect(container.querySelector('[data-testid="key"]')?.textContent).toBe("");
    expect(localStorage.getItem("cpa-keyer-usage-filters:overview-management")).toBe("range=90d");
  });
});
