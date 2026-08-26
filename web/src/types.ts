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
  usage: UsageSummary;
  created_at?: string;
  updated_at?: string;
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
}

export interface UsageTrendPoint {
  bucket: string;
  request_count: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  cost_usd: number;
}

export interface UsageOverviewResponse {
  from: string;
  to: string;
  granularity: "hour" | "day";
  totals: UsageTotals;
  series: UsageTrendPoint[];
  filters: UsageFilters;
}

export interface UsageBreakdown {
  name: string;
  request_count: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  cost_usd: number;
}

export interface UsageAnalysisResponse {
  from: string;
  to: string;
  totals: UsageTotals;
  by_model: UsageBreakdown[];
  by_key: UsageBreakdown[];
  by_provider: UsageBreakdown[];
  filters: UsageFilters;
}

export interface UsageEvent {
  id: number;
  timestamp: string;
  key_id: string;
  provider?: string;
  model: string;
  upstream_model?: string;
  failed: boolean;
  billing_mode?: "tokens" | "per_call";
  cost_available: boolean;
  cost_usd: number;
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
