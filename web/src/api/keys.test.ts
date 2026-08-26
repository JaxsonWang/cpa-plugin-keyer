import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyPublic } from "../types";

const clientMocks = vi.hoisted(() => ({
  patch: vi.fn(),
}));

vi.mock("./client", () => ({
  apiClient: () => ({ patch: clientMocks.patch }),
  pluginPath: (suffix: string) => `/v0/management/plugins/cpa-keyer${suffix}`,
}));

import { buildModelRules, resetKeyLimits } from "./keys";

beforeEach(() => {
  clientMocks.patch.mockReset();
});

describe("buildModelRules", () => {
  it("builds direct model rules without provider routing metadata", () => {
    expect(buildModelRules([
      { provider: "Codex", model: "gpt-5-codex" },
      { provider: "Claude", model: "claude-sonnet-4" },
    ])).toEqual([
      { model: "gpt-5-codex" },
      { model: "claude-sonnet-4" },
    ]);
  });

  it("deduplicates exact models globally and case-insensitively", () => {
    expect(buildModelRules([
      { provider: "codex", model: "GPT-5" },
      { provider: "openai-compat", model: "gpt-5" },
    ])).toEqual([{ model: "GPT-5" }]);
  });

  it("ignores provider validity and skips empty models", () => {
    expect(buildModelRules([
      { provider: "", model: "x" },
      { provider: "p", model: "" },
      { provider: "p", model: "  ok  " },
    ])).toEqual([{ model: "x" }, { model: "ok" }]);
  });
});

describe("resetKeyLimits", () => {
  it("patches both usage limits to zero without changing unrelated fields", async () => {
    const updated = { id: "team-a" } as KeyPublic;
    clientMocks.patch.mockResolvedValue({ data: { key: updated } });

    await expect(resetKeyLimits("team-a")).resolves.toBe(updated);
    expect(clientMocks.patch).toHaveBeenCalledWith(
      "/v0/management/plugins/cpa-keyer/keys",
      {
        id: "team-a",
        daily_limit_usd: 0,
        weekly_limit_usd: 0,
      },
    );
  });
});
