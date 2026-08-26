import { apiClient, pluginPath } from "./client";
import type {
  UsageAnalysisResponse,
  UsageEventsResponse,
  UsageOverviewResponse,
  UsageRange,
} from "../types";

export interface UsageQuery {
  range?: UsageRange;
  key_id?: string;
  provider?: string;
  model?: string;
  executor_type?: string;
  auth_type?: string;
  source?: string;
  service_tier?: string;
  status_code?: number;
  result?: "success" | "failed";
  page?: number;
  page_size?: number;
}

function cleanParams(query: UsageQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params[key] = value;
  }
  return params;
}

export async function fetchUsageOverview(query: UsageQuery): Promise<UsageOverviewResponse> {
  const { data } = await apiClient().get<UsageOverviewResponse>(pluginPath("/usage/overview"), {
    params: cleanParams(query),
  });
  return data;
}

export async function fetchUsageAnalysis(query: UsageQuery): Promise<UsageAnalysisResponse> {
  const { data } = await apiClient().get<UsageAnalysisResponse>(pluginPath("/usage/analysis"), {
    params: cleanParams(query),
  });
  return data;
}

export async function fetchUsageEvents(query: UsageQuery): Promise<UsageEventsResponse> {
  const { data } = await apiClient().get<UsageEventsResponse>(pluginPath("/usage/events"), {
    params: cleanParams(query),
  });
  return data;
}
