import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyPublic, SubscriptionPlanWriteRequest } from "../types";

// clientMocks 保存计划接口测试使用的 HTTP 方法模拟函数。
const clientMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

// 以下模拟工厂固定管理 API 客户端及插件路径拼接结果；suffix 表示接口相对路径。
vi.mock("./client", () => ({
  apiClient: () => clientMocks,
  pluginPath: (suffix: string) => `/v0/management/plugins/cpa-keyer${suffix}`,
}));

import {
  createSubscriptionPlan,
  deleteSubscriptionPlan,
  listSubscriptionPlans,
  setKeySubscriptionPlan,
  updateSubscriptionPlan,
} from "./subscriptionPlans";

// 以下前置回调在每个用例开始前清空所有 HTTP 模拟；mock 表示当前模拟函数。
beforeEach(() => {
  Object.values(clientMocks).forEach((mock) => mock.mockReset());
});

// request 是创建和更新接口共用的完整计划请求。
const request: SubscriptionPlanWriteRequest = {
  id: "standard",
  name: "Standard",
  rpm: 120,
  models: [{
    model: "gpt-5.4",
    input_price_per_million: 2.5,
    output_price_per_million: 15,
    cache_read_price_per_million: 0.25,
  }],
  daily_limit_usd: 10,
  weekly_limit_usd: 50,
  allow_models_endpoint: true,
  expires_at: "2026-09-30T00:00:00.000Z",
  key_ids: ["team-a"],
};

// 以下测试组验证订阅计划管理 API 的请求方法、路径和参数。
describe("subscription plan API", () => {
  // 以下用例回调验证计划集合的读取、新建、更新和删除请求。
  it("uses the plan collection for list, create, update, and delete", async () => {
    // plan 是管理接口返回的计划数据。
    const plan = { ...request, key_ids: ["team-a"] };
    clientMocks.get.mockResolvedValue({ data: { subscription_plans: [plan] } });
    clientMocks.post.mockResolvedValue({ data: { subscription_plan: plan } });
    clientMocks.patch.mockResolvedValue({ data: { subscription_plan: plan } });
    clientMocks.delete.mockResolvedValue({ data: {} });

    await expect(listSubscriptionPlans()).resolves.toEqual([plan]);
    await expect(createSubscriptionPlan(request)).resolves.toEqual(plan);
    await expect(updateSubscriptionPlan(request)).resolves.toEqual(plan);
    await expect(deleteSubscriptionPlan("standard")).resolves.toBeUndefined();

    // path 是订阅计划集合的完整管理接口路径。
    const path = "/v0/management/plugins/cpa-keyer/subscription-plans";
    expect(clientMocks.get).toHaveBeenCalledWith(path);
    expect(clientMocks.post).toHaveBeenCalledWith(path, request);
    expect(clientMocks.patch).toHaveBeenCalledWith(path, request);
    expect(clientMocks.delete).toHaveBeenCalledWith(path, { params: { id: "standard" } });
  });

  // 以下用例回调验证 Key 列表中的计划绑定入口使用专用接口。
  it("rebinds a Key through the dedicated list action endpoint", async () => {
    // updated 是服务端重新计算有效策略后返回的 Key。
    const updated = { id: "team-a", subscription_plan_id: "standard" } as KeyPublic;
    clientMocks.patch.mockResolvedValue({ data: { key: updated } });

    await expect(setKeySubscriptionPlan("team-a", "standard")).resolves.toBe(updated);
    expect(clientMocks.patch).toHaveBeenCalledWith(
      "/v0/management/plugins/cpa-keyer/keys/subscription-plan",
      { key_id: "team-a", subscription_plan_id: "standard" },
    );
  });
});
