import { describe, expect, it } from "vitest";
import { patchSearchParams, readPositivePage, readUsageRange } from "./usageSearchParams";

describe("usage search params", () => {
  it("reads valid filters and rejects invalid range or page values", () => {
    expect(readUsageRange(new URLSearchParams("range=30d"))).toBe("30d");
    expect(readUsageRange(new URLSearchParams("range=invalid"))).toBe("7d");
    expect(readPositivePage(new URLSearchParams("page=3"))).toBe(3);
    expect(readPositivePage(new URLSearchParams("page=-1"))).toBe(1);
  });

  it("preserves unrelated filters and removes default values", () => {
    const current = new URLSearchParams("provider=codex&page=4");
    const next = patchSearchParams(current, { range: "7d", key_id: "team-a", page: 1 });
    expect(next.toString()).toBe("provider=codex&key_id=team-a");
  });
});
