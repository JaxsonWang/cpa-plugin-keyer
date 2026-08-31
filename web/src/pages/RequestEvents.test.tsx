import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
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
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("RequestEvents", () => {
  it("restores filters and pagination from the URL", async () => {
    vi.mocked(fetchUsageEvents).mockResolvedValue({
      events: [], total: 0, page: 2, page_size: 50, total_pages: 2,
      filters: {
        key_ids: ["team-a"], providers: ["codex"], models: [], executor_types: [],
        auth_types: [], sources: [], service_tiers: [], status_codes: [],
      },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(
        <MemoryRouter initialEntries={["/events?range=30d&key_id=team-a&provider=codex&result=failed&page=2"]}>
          <RequestEvents />
        </MemoryRouter>,
      );
      await tick();
    });
    expect(fetchUsageEvents).toHaveBeenCalledWith({
      range: "30d",
      key_id: "team-a",
      provider: "codex",
      result: "failed",
      page: 2,
      page_size: 50,
    });
  });

  it("keeps key IDs and shows the masked key source with expanded usage fields", async () => {
    vi.mocked(fetchUsageEvents).mockResolvedValue({
      events: [{
        id: 7, timestamp: "2026-08-26T10:00:00Z", key_id: "team-a", key_preview: "cpa_*****wxyz", provider: "codex",
        model: "gpt-5.4", upstream_model: "gpt-5.4-2026-08-01", failed: false,
        reasoning_effort: "xhigh",
        executor_type: "CodexExecutor", auth_type: "apikey", auth_index: "2", source: "openai-responses",
        service_tier: "priority", generate: true, latency_ms: 2_400, ttft_ms: 400, status_code: 200,
        billing_mode: "tokens", cost_available: true, cost_usd: 0.002,
        uncached_input_cost_usd: 0.0005, cache_read_cost_usd: 0.0002,
        cache_creation_cost_usd: 0.0001, output_cost_usd: 0.0012, other_cost_usd: 0,
        input_tokens: 1000, output_tokens: 200, reasoning_tokens: 50,
        cache_read_tokens: 500, cache_creation_tokens: 10, total_tokens: 1200,
      }],
      total: 1, page: 1, page_size: 50, total_pages: 1,
      filters: {
        key_ids: ["team-a"], providers: ["codex"], models: ["gpt-5.4"],
        executor_types: ["codex"], auth_types: ["apikey"], sources: ["openai-responses"],
        service_tiers: ["priority"], status_codes: [200],
      },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<MemoryRouter><RequestEvents /></MemoryRouter>);
      await tick();
    });
    expect(container.textContent).toContain("team-a");
    expect(container.querySelector(".page-heading > span")?.textContent).toBe("KEYER USAGE · v0.7.12");
    expect(container.textContent).toContain("cpa_*****wxyz");
    expect(container.textContent).toContain("codex");
    expect(container.textContent).toContain("实际模型: gpt-5.4-2026-08-01");
    expect(container.textContent).not.toContain("为避免泄露下游凭据");
    const headers = Array.from(container.querySelectorAll("th")).map((cell) => cell.textContent);
    expect(headers).toContain("Key ID");
    expect(headers).toContain("来源");
    expect(headers).toContain("推理强度");
    expect(headers).toContain("性能");
    expect(container.querySelector(".page-heading-title .heading-count-tag")?.textContent).toBe("共 1 条请求事件");
    expect(container.querySelector(".events-log-heading")).toBeNull();
    expect(container.querySelector(".events-mobile-list")).toBeNull();
    const filterLabels = Array.from(container.querySelectorAll(".usage-controls label > span")).map((label) => label.textContent);
    expect(filterLabels).toEqual(["时间范围", "Key ID", "供应商", "结果"]);
    expect(fetchUsageEvents).toHaveBeenCalledWith({
      range: "7d",
      key_id: "",
      provider: "",
      result: undefined,
      page: 1,
      page_size: 50,
    });
    const firstRow = Array.from(container.querySelectorAll("tbody tr:first-child td"));
    expect(firstRow[headers.indexOf("推理强度")]?.textContent?.trim()).toBe("极高");
    expect(firstRow[headers.indexOf("结果")]?.textContent).toContain("HTTP 200");
    expect(firstRow[headers.indexOf("性能")]?.textContent).toContain("2.40 s");
    expect(firstRow[headers.indexOf("性能")]?.textContent).toContain("400 ms");
    expect(firstRow[headers.indexOf("费用")]?.textContent?.trim()).toBe("$0.0020");
    const detailsButton = container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
    await act(async () => {
      detailsButton.click();
      await tick();
    });
    expect(container.querySelector(".event-detail-grid")?.textContent).toContain("500 · 50.0%");
    expect(container.querySelector(".event-detail-grid")?.textContent).toContain("优先级");
    expect(container.querySelector(".event-detail-grid")?.textContent).toContain("CodexExecutor · API Key · 2");
    expect(container.querySelector(".event-detail-grid")?.children).toHaveLength(12);
  });

  it("shows unavailable instead of a misleading zero when cache writes are not reported", async () => {
    vi.mocked(fetchUsageEvents).mockResolvedValue({
      events: [{
        id: 8, timestamp: "2026-08-26T10:01:00Z", key_id: "team-a", key_preview: "cpa_*****wxyz", provider: "codex",
        model: "gpt-5.4", failed: false, generate: true, latency_ms: 0,
        billing_mode: "tokens", cost_available: true, cost_usd: 0,
        uncached_input_cost_usd: 0, cache_read_cost_usd: 0, cache_creation_cost_usd: 0,
        output_cost_usd: 0, other_cost_usd: 0,
        input_tokens: 1000, output_tokens: 200, total_tokens: 1200,
      }],
      total: 1, page: 1, page_size: 50, total_pages: 1,
      filters: {
        key_ids: ["team-a"], providers: ["codex"], models: ["gpt-5.4"],
        executor_types: [], auth_types: [], sources: [], service_tiers: [], status_codes: [],
      },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<MemoryRouter><RequestEvents /></MemoryRouter>);
      await tick();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click();
      await tick();
    });
    expect(container.querySelector("[title='当前 CPA 未提供独立缓存写入统计'] dd")?.textContent).toBe("—");
  });
});
