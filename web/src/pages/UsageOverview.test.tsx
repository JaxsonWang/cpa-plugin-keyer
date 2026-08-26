import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetLocale } from "../i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api/usage", () => ({ fetchUsageAnalysis: vi.fn(), fetchUsageOverview: vi.fn() }));
vi.mock("../components/UsageDashboardCharts", () => ({
  ActivityChart: () => <div data-testid="activity-chart" />,
  KeyUsageChart: () => <div data-testid="key-usage-chart" />,
  ModelShareChart: () => <div data-testid="model-share-chart" />,
  ProviderShareChart: () => <div data-testid="provider-share-chart" />,
  TokenCompositionChart: () => <div data-testid="token-composition-chart" />,
}));

import { fetchUsageAnalysis, fetchUsageOverview } from "../api/usage";
import UsageOverview from "./UsageOverview";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  _resetLocale("zh-CN");
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("UsageOverview", () => {
  it("renders the merged dashboard from overview and analysis data", async () => {
    vi.mocked(fetchUsageOverview).mockResolvedValue({
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-26T10:00:00Z",
      granularity: "hour",
      totals: {
        request_count: 4_595, success_count: 4_500, failure_count: 95,
        input_tokens: 404_230_000, output_tokens: 150_000_000, reasoning_tokens: 51_000_000,
        cached_tokens: 325_000_000, cache_read_tokens: 325_000_000, cache_creation_tokens: 0,
        total_tokens: 605_230_000, cost_usd: 429.32,
      },
      series: [{
        bucket: "2026-08-26T09:00:00Z", request_count: 4_595, success_count: 4_500, failure_count: 95,
        input_tokens: 404_230_000, output_tokens: 150_000_000, reasoning_tokens: 51_000_000,
        cached_tokens: 325_000_000, cache_read_tokens: 325_000_000, cache_creation_tokens: 0,
        total_tokens: 605_230_000, cost_usd: 429.32,
      }],
      filters: { key_ids: ["team-a"], providers: ["codex"], models: ["gpt-5.4"] },
    });
    const breakdown = {
      name: "gpt-5.4",
      request_count: 4_595,
      success_count: 4_500,
      failure_count: 95,
      input_tokens: 404_230_000,
      output_tokens: 150_000_000,
      reasoning_tokens: 51_000_000,
      cached_tokens: 325_000_000,
      cache_read_tokens: 325_000_000,
      cache_creation_tokens: 0,
      total_tokens: 605_230_000,
      cost_usd: 429.32,
    };
    vi.mocked(fetchUsageAnalysis).mockResolvedValue({
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-26T10:00:00Z",
      totals: { ...breakdown },
      by_model: [breakdown],
      by_key: [{ ...breakdown, name: "team-a" }],
      by_provider: [{ ...breakdown, name: "codex" }],
      filters: { key_ids: ["team-a"], providers: ["codex"], models: ["gpt-5.4"] },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<UsageOverview />);
      await tick();
    });

    expect(fetchUsageOverview).toHaveBeenCalledWith({ range: "7d", key_id: "" });
    expect(fetchUsageAnalysis).toHaveBeenCalledWith({ range: "7d", key_id: "" });
    expect(container.querySelector("h1")?.textContent).toBe("概览");
    expect(container.querySelectorAll(".dashboard-kpi")).toHaveLength(6);
    expect(container.textContent).toContain("请求与 Token 趋势");
    expect(container.textContent).toContain("Token 构成趋势");
    expect(container.textContent).toContain("模型效率");
    expect(container.textContent).toContain("Key 使用排行");
    expect(container.textContent).toContain("来源请求占比");
    expect(container.textContent).toContain("605.2M");
    expect(container.textContent).toContain("$429.3");
    expect(container.querySelector('[data-testid="activity-chart"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="token-composition-chart"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="model-share-chart"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="provider-share-chart"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="key-usage-chart"]')).not.toBeNull();
  });
});
