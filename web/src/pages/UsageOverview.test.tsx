import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetLocale } from "../i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api/usage", () => ({ fetchUsageOverview: vi.fn() }));

import { fetchUsageOverview } from "../api/usage";
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
  it("renders local SVG charts from Keyer totals", async () => {
    vi.mocked(fetchUsageOverview).mockResolvedValue({
      from: "2026-08-25T10:00:00Z",
      to: "2026-08-26T10:00:00Z",
      granularity: "hour",
      totals: {
        request_count: 2, success_count: 1, failure_count: 1,
        input_tokens: 1000, output_tokens: 500, reasoning_tokens: 100,
        cached_tokens: 200, cache_read_tokens: 200, cache_creation_tokens: 0,
        total_tokens: 1500, cost_usd: 0.004,
      },
      series: [{ bucket: "2026-08-26T09:00:00Z", request_count: 2, success_count: 1, failure_count: 1, total_tokens: 1500, cost_usd: 0.004 }],
      filters: { key_ids: ["team-a"], providers: ["codex"], models: ["gpt-5.4"] },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<UsageOverview />);
      await tick();
    });
    expect(container.querySelector("h1")?.textContent).toBe("概览");
    expect(container.querySelectorAll("svg.usage-trend-chart")).toHaveLength(3);
    expect(container.textContent).toContain("50.0%");
    expect(container.textContent).toContain("$0.004000");
  });
});
