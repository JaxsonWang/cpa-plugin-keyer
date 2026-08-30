import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyFormValues, KeyPublic, SubscriptionPlan } from "../types";
import { _resetLocale } from "../i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 以下模拟工厂提供可控的 Key 列表接口。
vi.mock("../api/keys", () => ({ listKeys: vi.fn() }));
// 以下模拟工厂提供可控的订阅计划接口。
vi.mock("../api/subscriptionPlans", () => ({
  createSubscriptionPlan: vi.fn(),
  listSubscriptionPlans: vi.fn(),
  updateSubscriptionPlan: vi.fn(),
}));
// 以下模拟工厂用单按钮替代策略表单，便于验证提交数据。
vi.mock("../components/KeyForm", () => ({
  // initial 是编辑页传入的完整计划策略，onSubmit 是计划保存回调。
  default: ({ initial, onSubmit }: {
    initial?: KeyFormValues;
    onSubmit: (values: KeyFormValues) => Promise<void>;
  }) => {
    // handleSubmit 提交固定策略字段，绑定 Key 仍由被测页面组装。
    const handleSubmit = () => void onSubmit({
      id: "standard",
      name: "Standard updated",
      enabled: true,
      rpm: 180,
      models: [{
        model: "gpt-5.4",
        input_price_per_million: 2.5,
        output_price_per_million: 15,
        cache_read_price_per_million: 0.25,
      }],
      daily_limit_usd: 12,
      weekly_limit_usd: 60,
      allow_models_endpoint: true,
    });
    return (
      <>
        <output data-testid="plan-models">{JSON.stringify(initial?.models ?? [])}</output>
        <button type="button" onClick={handleSubmit}>
          submit mocked plan
        </button>
      </>
    );
  },
}));

import { listKeys } from "../api/keys";
import { listSubscriptionPlans, updateSubscriptionPlan } from "../api/subscriptionPlans";
import SubscriptionPlanEdit from "./SubscriptionPlanEdit";

// container 是测试页面挂载节点。
let container: HTMLDivElement;
// root 是 React 测试根节点。
let root: ReturnType<typeof createRoot>;
// tick 等待一轮异步任务；Promise 回调中的 resolve 用于结束等待。
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 构造用于绑定场景的公开 Key 数据。
 * @param id 表示 Key ID。
 * @param subscriptionPlanID 表示已有的订阅计划 ID。
 * @returns 返回满足编辑页接口的 Key 数据。
 */
function key(id: string, subscriptionPlanID = ""): KeyPublic {
  return {
    id,
    name: `Key ${id}`,
    enabled: true,
    key_preview: `cpa_${id}...`,
    rpm: 60,
    models: [{ model: "gpt-5.4" }],
    daily_limit_usd: 10,
    weekly_limit_usd: 50,
    subscription_plan_id: subscriptionPlanID || undefined,
    subscription_plan_name: subscriptionPlanID || undefined,
    usage: { daily_usd: 0, weekly_usd: 0, daily_limit_usd: 10, weekly_limit_usd: 50 },
  };
}

// 以下前置回调为每个用例创建独立挂载节点。
beforeEach(() => {
  _resetLocale("zh-CN");
  container = document.createElement("div");
  document.body.appendChild(container);
});

// 以下清理回调卸载页面并重置模拟调用记录。
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

// 以下测试组验证订阅计划编辑页的 Key 绑定规则。
describe("SubscriptionPlanEdit", () => {
  // 以下用例回调验证归属限制、全选状态和完整绑定集合提交。
  it("loads bindings, protects keys owned by another plan, and submits the complete key set", async () => {
    // plan 是接口返回的当前订阅计划。
    const plan: SubscriptionPlan = {
      id: "standard",
      name: "Standard",
      rpm: 120,
      models: [{
        model: "gpt-5.4",
        input_price_per_million: 2,
        output_price_per_million: 12,
        cache_read_price_per_million: 0.2,
      }],
      daily_limit_usd: 10,
      weekly_limit_usd: 50,
      allow_models_endpoint: true,
      expires_at: "2030-08-30T04:00:00Z",
      key_ids: ["team-a"],
    };
    vi.mocked(listSubscriptionPlans).mockResolvedValue([plan]);
    vi.mocked(listKeys).mockResolvedValue([
      key("team-a", "standard"),
      key("team-b", "premium"),
      key("team-c"),
    ]);
    vi.mocked(updateSubscriptionPlan).mockResolvedValue(plan);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <MemoryRouter initialEntries={["/plans/standard/edit"]}>
          <Routes>
            <Route path="/plans/:id/edit" element={<SubscriptionPlanEdit />} />
            <Route path="/plans" element={<div>plans route</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await tick();
      await tick();
    });

    // teamA 是当前计划已经绑定的 Key 复选框。
    const teamA = container.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled)')!;
    // teamB 是被其他计划占用的 Key；查找回调中的 checkbox 表示当前复选框。
    const teamB = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find((checkbox) => checkbox.parentElement?.textContent?.includes("team-b"))!;
    // teamC 是尚未绑定计划的可选 Key；查找回调中的 checkbox 表示当前复选框。
    const teamC = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find((checkbox) => checkbox.parentElement?.textContent?.includes("team-c"))!;
    expect(teamA.checked).toBe(true);
    expect(teamB.disabled).toBe(true);
    expect(teamB.parentElement?.textContent).toContain("premium");
    expect(container.querySelector(".page-heading > span")?.textContent).toBe("KEYER USAGE · v0.7.10");
    expect(container.querySelector('[data-testid="plan-models"]')?.textContent).toContain(
      '"input_price_per_million":2,"output_price_per_million":12,"cache_read_price_per_million":0.2',
    );

    // selectAllButton 是绑定区的全选按钮；查找回调中的 button 表示当前按钮。
    const selectAllButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("全选"))!;
    await act(async () => {
      selectAllButton.click();
    });
    expect(teamC.checked).toBe(true);
    expect(selectAllButton.textContent).toContain("取消全选");

    // submitButton 是模拟策略表单的提交按钮；查找回调中的 button 表示当前按钮。
    const submitButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes("submit mocked plan"))!;
    await act(async () => {
      submitButton.click();
      await tick();
    });

    expect(updateSubscriptionPlan).toHaveBeenCalledTimes(1);
    expect(updateSubscriptionPlan).toHaveBeenCalledWith(expect.objectContaining({
      id: "standard",
      rpm: 180,
      models: [{
        model: "gpt-5.4",
        input_price_per_million: 2.5,
        output_price_per_million: 15,
        cache_read_price_per_million: 0.25,
      }],
      allow_models_endpoint: true,
      key_ids: ["team-a", "team-c"],
    }));
    expect(container.textContent).toContain("plans route");
  });
});
