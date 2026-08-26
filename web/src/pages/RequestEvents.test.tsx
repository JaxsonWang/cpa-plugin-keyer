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
  it("shows key IDs and available usage fields without a raw API key column", async () => {
    vi.mocked(fetchUsageEvents).mockResolvedValue({
      events: [{
        id: 7, timestamp: "2026-08-26T10:00:00Z", key_id: "team-a", provider: "codex",
        model: "gpt-5.4", upstream_model: "gpt-5.4-2026-08-01", failed: false,
        billing_mode: "tokens", cost_available: true, cost_usd: 0.002,
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
    expect(container.textContent).toContain("team-a");
    expect(container.textContent).toContain("实际模型: gpt-5.4-2026-08-01");
    expect(container.textContent).toContain("不保存 cpa_ 开头的明文 Key");
    expect(Array.from(container.querySelectorAll("th")).map((cell) => cell.textContent)).not.toContain("API Key");
  });
});
