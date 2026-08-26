import { beforeEach, describe, expect, it } from "vitest";
import { _resetKeyDrafts, clearKeyDraft, readKeyDraft, writeKeyDraft } from "./keyDraft";

beforeEach(_resetKeyDrafts);

describe("key drafts", () => {
  it("preserves every form field while model selection routes unmount the form", () => {
    writeKeyDraft("new", {
      id: "team-a",
      name: "Team A",
      enabled: false,
      rpm: 80,
      daily_limit_usd: 12,
      weekly_limit_usd: 50,
      allow_models_endpoint: true,
      models: [{ model: "gpt-4o", input_price_per_million: 2.5 }],
    });

    expect(readKeyDraft("new")).toEqual({
      id: "team-a",
      name: "Team A",
      enabled: false,
      rpm: 80,
      daily_limit_usd: 12,
      weekly_limit_usd: 50,
      allow_models_endpoint: true,
      models: [{ model: "gpt-4o", input_price_per_million: 2.5 }],
    });
  });

  it("returns defensive copies and clears completed drafts", () => {
    writeKeyDraft("new", {
      id: "team-a",
      name: "",
      enabled: true,
      rpm: 0,
      daily_limit_usd: 0,
      weekly_limit_usd: 0,
      models: [{ model: "gpt-4o" }],
    });
    const first = readKeyDraft("new")!;
    first.models[0].model = "changed";
    expect(readKeyDraft("new")!.models[0].model).toBe("gpt-4o");
    clearKeyDraft("new");
    expect(readKeyDraft("new")).toBeNull();
  });
});
