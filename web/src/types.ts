export interface ModelRule {
  model: string;
  input_price_per_million?: number;
  output_price_per_million?: number;
  cache_read_price_per_million?: number;
  billing_mode?: "tokens" | "per_call";
  per_call_usd?: number;
}

export interface UsageSummary {
  daily_usd: number;
  weekly_usd: number;
  daily_limit_usd: number;
  weekly_limit_usd: number;
  daily_reset_at?: string;
  weekly_reset_at?: string;
  daily_cache_cost_usd?: number;
  weekly_cache_cost_usd?: number;
  daily_cache_read_tokens?: number;
  weekly_cache_read_tokens?: number;
  daily_input_tokens?: number;
  weekly_input_tokens?: number;
  daily_call_count?: number;
  weekly_call_count?: number;
}

export interface KeyPublic {
  id: string;
  name: string;
  enabled: boolean;
  key_preview: string;
  rpm: number;
  models: ModelRule[];
  daily_limit_usd: number;
  weekly_limit_usd: number;
  allow_models_endpoint?: boolean;
  /** subscription_plan_id 是当前 Key 绑定的订阅计划 ID。 */
  subscription_plan_id?: string;
  /** subscription_plan_name 是当前 Key 绑定的订阅计划名称。 */
  subscription_plan_name?: string;
  /** subscription_expires_at 是当前绑定计划的到期时间。 */
  subscription_expires_at?: string;
  /** base_policy 是未应用订阅计划前的 Key 自有策略。 */
  base_policy?: KeyPolicy;
  usage: UsageSummary;
  created_at?: string;
  updated_at?: string;
}

/** KeyPolicy 表示 Key 与订阅计划共用的访问策略字段。 */
export interface KeyPolicy {
  /** rpm 是每分钟允许的请求数量，零表示不限。 */
  rpm: number;
  /** models 是当前策略允许访问的模型规则。 */
  models: ModelRule[];
  /** daily_limit_usd 是每日美元用量上限，零表示不限。 */
  daily_limit_usd: number;
  /** weekly_limit_usd 是每周美元用量上限，零表示不限。 */
  weekly_limit_usd: number;
  /** allow_models_endpoint 表示是否允许访问 `/v1/models`。 */
  allow_models_endpoint?: boolean;
}

/** SubscriptionPlan 表示可被多个 Key 复用的订阅计划。 */
export interface SubscriptionPlan extends KeyPolicy {
  /** id 是订阅计划的稳定标识。 */
  id: string;
  /** name 是订阅计划的展示名称。 */
  name: string;
  /** expires_at 是订阅计划的 RFC3339 到期时间。 */
  expires_at?: string;
  /** key_ids 是当前绑定该计划的完整 Key ID 集合。 */
  key_ids: string[];
  /** created_at 是计划创建时间。 */
  created_at?: string;
  /** updated_at 是计划最后更新时间。 */
  updated_at?: string;
}

/** SubscriptionPlanWriteRequest 表示订阅计划写接口需要的完整数据。 */
export interface SubscriptionPlanWriteRequest extends KeyPolicy {
  /** id 是待创建或更新的订阅计划 ID。 */
  id: string;
  /** name 是订阅计划展示名称。 */
  name: string;
  /** expires_at 是 RFC3339 到期时间，空字符串表示永久有效。 */
  expires_at: string;
  /** key_ids 是写入后应绑定该计划的完整 Key ID 集合。 */
  key_ids: string[];
}

export interface KeyFormValues {
  id: string;
  name: string;
  enabled: boolean;
  rpm: number;
  models: ModelRule[];
  daily_limit_usd: number;
  weekly_limit_usd: number;
  allow_models_endpoint?: boolean;
}

export interface KeyWriteRequest {
  id: string;
  name?: string;
  enabled?: boolean;
  key?: string;
  rpm?: number;
  models?: ModelRule[];
  daily_limit_usd?: number;
  weekly_limit_usd?: number;
  allow_models_endpoint?: boolean;
}

export interface CreateKeyResponse {
  key: KeyPublic;
  plain_key: string;
  generated: boolean;
}

export interface RotateKeyResponse {
  key: KeyPublic;
  plain_key: string;
  generated: boolean;
}

export interface UsageWindow {
  total_usd: number;
  window_start?: string;
  cache_read_tokens?: number;
  cache_cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  call_count?: number;
}

export interface ModelUsageEntry {
  model: string;
  billing_mode?: "tokens" | "per_call";
  per_call_usd?: number;
  in_config: boolean;
  daily: UsageWindow;
  weekly: UsageWindow;
}

export interface KeyUsageResponse {
  key_id: string;
  key_name: string;
  daily_limit_usd: number;
  weekly_limit_usd: number;
  models: ModelUsageEntry[];
}

export interface CatalogModel {
  provider: string;
  model: string;
}

export interface StatusResponse {
  enabled: boolean;
  state_file: string;
  key_count: number;
  rpm_usage?: Record<string, unknown>;
}

export type UsageRange = "24h" | "7d" | "30d" | "90d";

export interface UsageFilters {
  key_ids: string[];
  providers: string[];
  models: string[];
  executor_types: string[];
  auth_types: string[];
  sources: string[];
  service_tiers: string[];
  status_codes: number[];
}

export interface UsageTotals {
  request_count: number;
  success_count: number;
  failure_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  cost_usd: number;
  uncached_input_cost_usd: number;
  cache_read_cost_usd: number;
  cache_creation_cost_usd: number;
  output_cost_usd: number;
  other_cost_usd: number;
}

export interface UsageTrendPoint {
  bucket: string;
  request_count: number;
  success_count: number;
  failure_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  cost_usd: number;
  uncached_input_cost_usd: number;
  cache_read_cost_usd: number;
  cache_creation_cost_usd: number;
  output_cost_usd: number;
  other_cost_usd: number;
  average_latency_ms?: number;
  average_ttft_ms?: number;
}

export interface UsagePerformance {
  latency_samples: number;
  average_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  max_latency_ms: number;
  ttft_samples: number;
  average_ttft_ms: number;
  p50_ttft_ms: number;
  p95_ttft_ms: number;
  max_ttft_ms: number;
}

export interface UsageOverviewResponse {
  from: string;
  to: string;
  granularity: "hour" | "day";
  totals: UsageTotals;
  series: UsageTrendPoint[];
  performance: UsagePerformance;
  filters: UsageFilters;
}

export interface UsageBreakdown {
  name: string;
  request_count: number;
  success_count: number;
  failure_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  cost_usd: number;
  uncached_input_cost_usd: number;
  cache_read_cost_usd: number;
  cache_creation_cost_usd: number;
  output_cost_usd: number;
  other_cost_usd: number;
}

export interface UsageHeatmapCell {
  key_id: string;
  model: string;
  request_count: number;
  total_tokens: number;
  cost_usd: number;
}

export interface UsageLatencyPoint {
  ttft_ms: number;
  latency_ms: number;
}

export interface UsageAnalysisResponse {
  from: string;
  to: string;
  totals: UsageTotals;
  by_model: UsageBreakdown[];
  by_key: UsageBreakdown[];
  by_provider: UsageBreakdown[];
  by_executor: UsageBreakdown[];
  by_auth_type: UsageBreakdown[];
  by_source: UsageBreakdown[];
  by_service_tier: UsageBreakdown[];
  heatmap: UsageHeatmapCell[];
  latency_points: UsageLatencyPoint[];
  filters: UsageFilters;
}

export interface UsageEvent {
  id: number;
  timestamp: string;
  key_id: string;
  key_preview?: string;
  provider?: string;
  model: string;
  upstream_model?: string;
  reasoning_effort?: string;
  executor_type?: string;
  auth_type?: string;
  auth_index?: string;
  source?: string;
  service_tier?: string;
  generate: boolean;
  latency_ms: number;
  ttft_ms?: number;
  status_code?: number;
  failed: boolean;
  billing_mode?: "tokens" | "per_call";
  cost_available: boolean;
  cost_usd: number;
  uncached_input_cost_usd: number;
  cache_read_cost_usd: number;
  cache_creation_cost_usd: number;
  output_cost_usd: number;
  other_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  total_tokens: number;
}

export interface UsageEventsResponse {
  events: UsageEvent[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  filters: UsageFilters;
}
