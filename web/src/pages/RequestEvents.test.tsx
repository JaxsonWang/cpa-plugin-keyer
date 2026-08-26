import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetLocale } from "../i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api/usage", () => ({ fetchUsageEvents: vi.fn() }));

import { fetchUsageEvents } from "../api/usage";
import RequestEvents from "./RequestEvents";

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

describe("RequestEvents", () => {
  it("keeps key IDs and shows the masked key source with expanded usage fields", async () => {
    vi.mocked(fetchUsageEvents).mockResolvedValue({
      events: [{
        id: 7, timestamp: "2026-08-26T10:00:00Z", key_id: "team-a", key_preview: "cpa_*****wxyz", provider: "codex",
        model: "gpt-5.4", upstream_model: "gpt-5.4-2026-08-01", failed: false,
        billing_mode: "tokens", cost_available: true, cost_usd: 0.002,
        input_tokens: 1000, output_tokens: 200, reasoning_tokens: 50,
        cache_read_tokens: 500, cache_creation_tokens: 10, total_tokens: 1200,
      }],
      total: 1, page: 1, page_size: 50, total_pages: 1,
      filters: { key_ids: ["team-a"], providers: ["codex"], models: ["gpt-5.4"] },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<RequestEvents />);
      await tick();
    });
    expect(container.textContent).toContain("team-a");
    expect(container.textContent).toContain("cpa_*****wxyz");
    expect(container.textContent).toContain("codex");
    expect(container.textContent).toContain("实际模型: gpt-5.4-2026-08-01");
    expect(container.textContent).not.toContain("为避免泄露下游凭据");
    const headers = Array.from(container.querySelectorAll("th")).map((cell) => cell.textContent);
    expect(headers).toContain("Key ID");
    expect(headers).toContain("来源");
    expect(container.querySelector(".page-heading-title .heading-count-tag")?.textContent).toBe("共 1 条请求事件");
    expect(container.querySelector(".events-log-heading")).toBeNull();
    expect(container.querySelector(".events-mobile-list .event-mobile-card")?.textContent).toContain("cpa_*****wxyz");
    expect(container.querySelector(".events-mobile-list .event-mobile-card")?.textContent).toContain("codex");
    const firstRow = Array.from(container.querySelectorAll("tbody tr:first-child td"));
    expect(firstRow[headers.indexOf("缓存写入")]?.textContent?.trim()).toBe("10");
    expect(firstRow[headers.indexOf("费用")]?.textContent?.trim()).toBe("$0.0");
  });

  it("shows unavailable instead of a misleading zero when cache writes are not reported", async () => {
    vi.mocked(fetchUsageEvents).mockResolvedValue({
      events: [{
        id: 8, timestamp: "2026-08-26T10:01:00Z", key_id: "team-a", key_preview: "cpa_*****wxyz", provider: "codex",
        model: "gpt-5.4", failed: false, billing_mode: "tokens", cost_available: true, cost_usd: 0,
        input_tokens: 1000, output_tokens: 200, total_tokens: 1200,
      }],
      total: 1, page: 1, page_size: 50, total_pages: 1,
      filters: { key_ids: ["team-a"], providers: ["codex"], models: ["gpt-5.4"] },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<RequestEvents />);
      await tick();
    });
    expect(container.querySelector("td[title='当前 CPA 未提供独立缓存写入统计']")?.textContent?.trim()).toBe("—");
  });
});
