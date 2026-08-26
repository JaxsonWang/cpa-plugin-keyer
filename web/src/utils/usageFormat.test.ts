import { describe, expect, it } from "vitest";
import { averagePerMinute, cacheRate, costPerMillion, formatCount, formatRate, formatSummaryUSD, formatUSD } from "./usageFormat";

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
});
