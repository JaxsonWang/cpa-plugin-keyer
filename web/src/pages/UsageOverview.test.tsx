import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetLocale } from "../i18n";
import { clearSession, setViewerSession } from "../store/session";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api/usage", () => ({ fetchUsageAnalysis: vi.fn(), fetchUsageOverview: vi.fn() }));
vi.mock("../api/keys", () => ({ listKeys: vi.fn() }));
vi.mock("../components/KeyQuotaChart", () => ({ default: () => <div data-testid="key-quota-chart" /> }));
vi.mock("../components/UsageDashboardCharts", () => ({
  ActivityChart: () => <div data-testid="activity-chart" />,
  CacheEfficiencyChart: () => <div data-testid="cache-efficiency-chart" />,
  CostBreakdownChart: () => <div data-testid="cost-breakdown-chart" />,
  DimensionShareChart: ({ ariaLabel, rows }: { ariaLabel: string; rows: Array<{ name: string }> }) => (
    <div data-testid={`dimension-share-${ariaLabel}`}>{rows.map((row) => row.name).join(" · ")}</div>
  ),
  KeyUsageChart: () => <div data-testid="key-usage-chart" />,
  LatencyScatterChart: () => <div data-testid="latency-scatter-chart" />,
  LatencyTrendChart: () => <div data-testid="latency-trend-chart" />,
  ModelShareChart: () => <div data-testid="model-share-chart" />,
  ProviderShareChart: () => <div data-testid="provider-share-chart" />,
  TokenCompositionChart: () => <div data-testid="token-composition-chart" />,
  UsageHeatmapChart: () => <div data-testid="usage-heatmap-chart" />,
}));

import { fetchUsageAnalysis, fetchUsageOverview } from "../api/usage";
import { listKeys } from "../api/keys";
import UsageOverview from "./UsageOverview";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  _resetLocale("zh-CN");
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  clearSession();
  container.remove();
  vi.clearAllMocks();
});

describe("UsageOverview", () => {
  // 以下用例回调验证共享概览骨架不再渲染突兀的末尾两个指标占位块。
  it("keeps the initial metric skeleton to two wide and four compact blocks", async () => {
    // 以下三个未完成请求让页面保持在首屏骨架状态。
    vi.mocked(fetchUsageOverview).mockReturnValue(new Promise<never>(() => {}));
    vi.mocked(fetchUsageAnalysis).mockReturnValue(new Promise<never>(() => {}));
    vi.mocked(listKeys).mockReturnValue(new Promise<never>(() => {}));
    await act(async () => {
      root = createRoot(container);
      root.render(<MemoryRouter><UsageOverview /></MemoryRouter>);
      await Promise.resolve();
    });

    expect(container.querySelectorAll(".dashboard-skeleton-metrics > span")).toHaveLength(6);
    expect(container.querySelectorAll(".dashboard-skeleton-metrics > span.wide")).toHaveLength(2);
  });

  it("renders the quota dashboard for management and hides it for viewer sessions", async () => {
    vi.mocked(listKeys).mockResolvedValue([
      {
        id: "team-a", name: "Team A", enabled: true, key_preview: "cpa_…demo", rpm: 60, models: [],
        daily_limit_usd: 100, weekly_limit_usd: 500,
        usage: { daily_usd: 75, weekly_usd: 520, daily_limit_usd: 100, weekly_limit_usd: 500 },
      },
      {
        id: "team-b", name: "Team B", enabled: true, key_preview: "cpa_…demo", rpm: 60, models: [],
        daily_limit_usd: 0, weekly_limit_usd: 0,
        usage: { daily_usd: 5, weekly_usd: 20, daily_limit_usd: 0, weekly_limit_usd: 0 },
      },
    ]);
    vi.mocked(fetchUsageOverview).mockResolvedValue({
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-26T10:00:00Z",
      granularity: "hour",
      totals: {
        request_count: 4_595, success_count: 4_500, failure_count: 95,
        input_tokens: 404_230_000, output_tokens: 150_000_000, reasoning_tokens: 51_000_000,
        cached_tokens: 325_000_000, cache_read_tokens: 325_000_000, cache_creation_tokens: 0,
        total_tokens: 605_230_000, cost_usd: 429.32,
        uncached_input_cost_usd: 44.32, cache_read_cost_usd: 81.25, cache_creation_cost_usd: 0,
        output_cost_usd: 303.75, other_cost_usd: 0,
      },
      series: [{
        bucket: "2026-08-26T09:00:00Z", request_count: 4_595, success_count: 4_500, failure_count: 95,
        input_tokens: 404_230_000, output_tokens: 150_000_000, reasoning_tokens: 51_000_000,
        cached_tokens: 325_000_000, cache_read_tokens: 325_000_000, cache_creation_tokens: 0,
        total_tokens: 605_230_000, cost_usd: 429.32,
        uncached_input_cost_usd: 44.32, cache_read_cost_usd: 81.25, cache_creation_cost_usd: 0,
        output_cost_usd: 303.75, other_cost_usd: 0,
        average_latency_ms: 2_400, average_ttft_ms: 430,
      }],
      performance: {
        latency_samples: 4_500, average_latency_ms: 2_400, p50_latency_ms: 1_900,
        p95_latency_ms: 5_800, max_latency_ms: 9_800,
        ttft_samples: 4_300, average_ttft_ms: 430, p50_ttft_ms: 320,
        p95_ttft_ms: 920, max_ttft_ms: 1_800,
      },
      filters: {
        key_ids: ["team-a"], providers: ["codex"], models: ["gpt-5.4"],
        executor_types: ["codex"], auth_types: ["apikey"], sources: ["openai-responses"],
        service_tiers: ["priority"], status_codes: [429],
      },
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
      uncached_input_cost_usd: 44.32,
      cache_read_cost_usd: 81.25,
      cache_creation_cost_usd: 0,
      output_cost_usd: 303.75,
      other_cost_usd: 0,
    };
    vi.mocked(fetchUsageAnalysis).mockResolvedValue({
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-26T10:00:00Z",
      totals: { ...breakdown },
      by_model: [breakdown],
      by_key: [{ ...breakdown, name: "team-a" }],
      by_provider: [{ ...breakdown, name: "codex" }],
      by_executor: [{ ...breakdown, name: "CodexExecutor" }],
      by_auth_type: [{ ...breakdown, name: "unknown" }],
      by_source: [{ ...breakdown, name: "unknown" }],
      by_service_tier: [{ ...breakdown, name: "unknown" }],
      heatmap: [{ key_id: "team-a", model: "gpt-5.4", request_count: 4_595, total_tokens: 605_230_000, cost_usd: 429.32 }],
      latency_points: [{ ttft_ms: 430, latency_ms: 2_400 }],
      filters: {
        key_ids: ["team-a"], providers: ["codex"], models: ["gpt-5.4"],
        executor_types: ["codex"], auth_types: ["apikey"], sources: ["openai-responses"],
        service_tiers: ["priority"], status_codes: [429],
      },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<MemoryRouter><UsageOverview /></MemoryRouter>);
      await tick();
    });

    expect(fetchUsageOverview).toHaveBeenCalledWith({ range: "7d", key_id: "" });
    expect(fetchUsageAnalysis).toHaveBeenCalledWith({ range: "7d", key_id: "" });
    expect(listKeys).toHaveBeenCalledOnce();
    expect(container.querySelector("h1")?.textContent).toBe("概览");
    expect(container.querySelector(".page-heading > span")?.textContent).toBe("KEYER USAGE · v0.7.11");
    expect(container.querySelectorAll(".dashboard-kpi")).toHaveLength(8);
    expect(container.textContent).toContain("请求与 Token 趋势");
    expect(container.textContent).toContain("Token 构成趋势");
    expect(container.textContent).toContain("模型效率");
    expect(container.textContent).toContain("Key 使用排行");
    expect(container.textContent).toContain("来源请求占比");
    expect(container.textContent).toContain("605.2M");
    expect(container.textContent).toContain("$429.3");
    expect(container.textContent).toContain("P95 总延迟");
    expect(container.textContent).toContain("P95 首字延迟");
    expect(container.textContent).toContain("Key 额度");
    expect(container.textContent).toContain("受限 Key");
    expect(container.textContent).toContain("不限额 Key");
    expect(container.textContent).toContain("已达额度");
    expect(container.querySelector('[data-testid="key-quota-chart"]')).not.toBeNull();
    const quotaSection = container.querySelector(".key-quota-layout");
    const usageHeading = Array.from(container.querySelectorAll(".usage-section-head h2")).find((node) => node.textContent === "用量分析");
    expect(quotaSection).not.toBeNull();
    expect(usageHeading).toBeDefined();
    expect(quotaSection!.compareDocumentPosition(usageHeading!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[data-testid="activity-chart"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="latency-trend-chart"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="latency-scatter-chart"]')).toBeNull();
    expect(container.querySelector('[data-testid="cost-breakdown-chart"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="cache-efficiency-chart"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="usage-heatmap-chart"]')).toBeNull();
    expect(container.querySelector('[data-testid="token-composition-chart"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="model-share-chart"]')).toBeNull();
    expect(container.querySelector('[data-testid="provider-share-chart"]')).toBeNull();
    expect(container.querySelector('[data-testid="key-usage-chart"]')).toBeNull();
    expect(container.querySelectorAll(".single-dimension-summary").length).toBeGreaterThanOrEqual(6);
    expect(container.textContent).not.toContain("unknown");
    expect(container.textContent).not.toContain("CodexExecutor");
    expect(container.textContent).toContain("Codex 执行器");
    expect(container.textContent).toContain("未记录");
    expect(container.textContent).toContain("旧请求事件没有采集这些运行字段");

    act(() => root.unmount());
    setViewerSession("https://cpa.example.com", "cpa_viewer", "direct");
    await act(async () => {
      root = createRoot(container);
      root.render(<MemoryRouter><UsageOverview /></MemoryRouter>);
      await tick();
    });

    expect(container.textContent).not.toContain("Key 额度");
    expect(container.textContent).not.toContain("受限 Key");
    expect(container.querySelector(".key-quota-layout")).toBeNull();
    expect(container.querySelector('[data-testid="key-quota-chart"]')).toBeNull();
    expect(container.textContent).toContain("用量分析");
  });
});
