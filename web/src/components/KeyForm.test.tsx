import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyFormValues } from "../types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 以下异步模拟工厂保留真实价格状态逻辑，仅固定远程价格表为空。
vi.mock("../store/modelPrices", async () => {
  // actual 是模型价格模块的真实导出。
  const actual = await vi.importActual<typeof import("../store/modelPrices")>("../store/modelPrices");
  return { ...actual, getPriceTable: vi.fn().mockResolvedValue(null) };
});

import KeyForm from "./KeyForm";

// container 是测试页面挂载节点。
let container: HTMLDivElement;
// root 是 React 测试根节点。
let root: ReturnType<typeof createRoot>;
// tick 等待一轮异步任务；Promise 回调中的 resolve 用于结束等待。
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// 以下前置回调为每个用例创建独立挂载节点。
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

// 以下清理回调卸载页面并重置模拟调用记录。
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

// 以下测试组验证 KeyForm 的计划和 Key 共用策略字段。
describe("KeyForm", () => {
  // 以下用例回调验证任意精度的模型价格不会触发浏览器步长错误。
  it("accepts model prices with arbitrary decimal precision", async () => {
    // initial 是包含三类小数价格的初始策略数据。
    const initial: KeyFormValues = {
      id: "team-a",
      name: "Team A",
      enabled: true,
      rpm: 0,
      models: [{
        model: "gpt-5.3-codex-spark",
        input_price_per_million: 1.75,
        output_price_per_million: 14,
        cache_read_price_per_million: 0.175,
      }],
      daily_limit_usd: 0,
      weekly_limit_usd: 0,
      allow_models_endpoint: false,
    };

    await act(async () => {
      root = createRoot(container);
      root.render(
        <MemoryRouter>
          <KeyForm
            initial={initial}
            pickPath="/models"
            submitLabel="Create"
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
          />
        </MemoryRouter>,
      );
      await tick();
    });

    // tokenPriceInputs 保存桌面价格表中的三个按 Token 计费输入框。
    const tokenPriceInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('.mobile-hidden input[name$="_price_per_million"]'),
    );
    expect(tokenPriceInputs).toHaveLength(3);
    // input 表示当前检查的桌面价格输入框。
    expect(tokenPriceInputs.every((input) => input.step === "any")).toBe(true);

    // cacheReadInput 是桌面价格表中的缓存读取价格输入框。
    const cacheReadInput = container.querySelector<HTMLInputElement>(
      '.mobile-hidden input[name="models.gpt-5.3-codex-spark.cache_read_price_per_million"]',
    )!;
    expect(cacheReadInput.value).toBe("0.175");
    expect(cacheReadInput.validity.stepMismatch).toBe(false);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".kf-model-head")!.click();
      await tick();
    });
    // mobileTokenPriceInputs 保存移动端展开区域中的三个价格输入框。
    const mobileTokenPriceInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('.mobile-only input[name$="_price_per_million"]'),
    );
    expect(mobileTokenPriceInputs).toHaveLength(3);
    // input 表示当前检查的移动端价格输入框。
    expect(mobileTokenPriceInputs.every((input) => input.step === "any")).toBe(true);
    expect(
      container.querySelector<HTMLInputElement>(
        '.mobile-only input[name="models.gpt-5.3-codex-spark.cache_read_price_per_million"]',
      )!.validity.stepMismatch,
    ).toBe(false);
  });
});
