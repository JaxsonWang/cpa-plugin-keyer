import { apiClient, pluginPath } from "./client";
import type { KeyPublic, SubscriptionPlan, SubscriptionPlanWriteRequest } from "../types";

/**
 * 读取全部订阅计划。
 * @returns 返回管理接口中的订阅计划列表。
 */
export async function listSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  // c 是带当前管理会话认证信息的 API 客户端。
  const c = apiClient();
  // data 是计划列表接口返回的响应体。
  const { data } = await c.get<{ subscription_plans: SubscriptionPlan[] }>(pluginPath("/subscription-plans"));
  return data.subscription_plans ?? [];
}

/**
 * 创建一个订阅计划。
 * @param request 表示计划策略和初始 Key 绑定集合。
 * @returns 返回服务端持久化后的订阅计划。
 */
export async function createSubscriptionPlan(request: SubscriptionPlanWriteRequest): Promise<SubscriptionPlan> {
  // c 是带当前管理会话认证信息的 API 客户端。
  const c = apiClient();
  // data 是新建计划接口返回的响应体。
  const { data } = await c.post<{ subscription_plan: SubscriptionPlan }>(pluginPath("/subscription-plans"), request);
  return data.subscription_plan;
}

/**
 * 更新一个订阅计划及其完整 Key 绑定集合。
 * @param request 表示需要持久化的完整计划数据。
 * @returns 返回服务端更新后的订阅计划。
 */
export async function updateSubscriptionPlan(request: SubscriptionPlanWriteRequest): Promise<SubscriptionPlan> {
  // c 是带当前管理会话认证信息的 API 客户端。
  const c = apiClient();
  // data 是更新计划接口返回的响应体。
  const { data } = await c.patch<{ subscription_plan: SubscriptionPlan }>(pluginPath("/subscription-plans"), request);
  return data.subscription_plan;
}

/**
 * 删除指定订阅计划。
 * @param id 表示需要删除的计划 ID。
 */
export async function deleteSubscriptionPlan(id: string): Promise<void> {
  // c 是带当前管理会话认证信息的 API 客户端。
  const c = apiClient();
  await c.delete(pluginPath("/subscription-plans"), { params: { id } });
}

/**
 * 从 Key 列表直接修改一个 Key 的订阅计划。
 * @param keyID 表示需要调整的 Key ID。
 * @param subscriptionPlanID 表示目标计划 ID，空字符串表示解除绑定。
 * @returns 返回重新计算有效策略后的 Key。
 */
export async function setKeySubscriptionPlan(keyID: string, subscriptionPlanID: string): Promise<KeyPublic> {
  // c 是带当前管理会话认证信息的 API 客户端。
  const c = apiClient();
  // data 是 Key 订阅计划修改接口返回的响应体。
  const { data } = await c.patch<{ key: KeyPublic }>(pluginPath("/keys/subscription-plan"), {
    key_id: keyID,
    subscription_plan_id: subscriptionPlanID,
  });
  return data.key;
}
