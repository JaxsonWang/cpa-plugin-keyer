import { describe, expect, it } from "vitest";
import {
  averagePerMinute,
  cacheRate,
  costPerMillion,
  formatAuthIndex,
  formatCount,
  formatDimensionName,
  formatDuration,
  formatExecutorName,
  formatMappedDimensionName,
  formatPercentValue,
  formatRate,
  formatRequestUSD,
  formatSummaryUSD,
  formatUSD,
  tokensPerSecond,
} from "./usageFormat";

describe("usage formatting", () => {
  it("uses universal M units instead of locale-specific ten-thousand units", () => {
    expect(formatCount(20_317)).toBe("0.02M");
    expect(formatCount(203_177)).toBe("0.2M");
    expect(formatCount(605_230_000)).toBe("605.2M");
    expect(formatCount(4_589)).toBe("4,589");
  });

  it("derives range averages and blended cost from real totals", () => {
    expect(averagePerMinute(1_440, "2026-08-25T00:00:00Z", "2026-08-26T00:00:00Z")).toBe(1);
    expect(formatRate(492_861)).toBe("0.49M");
    expect(costPerMillion(2, 1_000_000)).toBe("$2.0");
    expect(cacheRate({ input_tokens: 602_360_000, cache_read_tokens: 565_440_000, cached_tokens: 0 })).toBe("93.9%");
  });

  it("uses one decimal for every displayed currency statistic", () => {
    expect(formatUSD(429.32)).toBe("$429.3");
    expect(formatSummaryUSD(429.32)).toBe("$429.3");
    expect(formatSummaryUSD(0.004)).toBe("$0.0");
  });

  it("keeps request-level micro-costs readable", () => {
    expect(formatRequestUSD(1.234)).toBe("$1.23");
    expect(formatRequestUSD(0.02)).toBe("$0.0200");
    expect(formatRequestUSD(0.002)).toBe("$0.0020");
    expect(formatRequestUSD(0)).toBe("$0");
  });

  it("limits percentage values to the requested precision", () => {
    expect(formatPercentValue(96.23226524113257)).toBe("96.23%");
    expect(formatPercentValue(Number.NaN)).toBe("—");
  });

  it("formats duration and derives generation throughput from post-TTFT time", () => {
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(400)).toBe("400 ms");
    expect(formatDuration(2_400)).toBe("2.40 s");
    expect(tokensPerSecond(200, 2_400, 400)).toBe(100);
    expect(tokensPerSecond(200, 400, 400)).toBeUndefined();
  });

  it("labels missing historical runtime dimensions without exposing the backend sentinel", () => {
    expect(formatDimensionName("unknown", "未记录")).toBe("未记录");
    expect(formatDimensionName(" UNKNOWN ", "未记录")).toBe("未记录");
    expect(formatDimensionName("", "未记录")).toBe("未记录");
    expect(formatDimensionName("CodexExecutor", "未记录")).toBe("CodexExecutor");
  });

  it("converts CPA's Codex executor identifiers into a readable localized label", () => {
    expect(formatExecutorName("CodexExecutor", "未记录", "Codex 执行器")).toBe("Codex 执行器");
    expect(formatExecutorName("codex", "未记录", "Codex 执行器")).toBe("Codex 执行器");
    expect(formatExecutorName("unknown", "未记录", "Codex 执行器")).toBe("未记录");
    expect(formatExecutorName("CustomExecutor", "未记录", "Codex 执行器")).toBe("CustomExecutor");
  });

  it("maps runtime labels and shortens long auth indexes for display", () => {
    expect(formatMappedDimensionName("apikey", "未记录", { apikey: "API Key" })).toBe("API Key");
    expect(formatMappedDimensionName("custom", "未记录", { apikey: "API Key" })).toBe("custom");
    expect(formatAuthIndex("d6af8b11c29a84b8")).toBe("…84b8");
    expect(formatAuthIndex("2")).toBe("2");
  });
});
