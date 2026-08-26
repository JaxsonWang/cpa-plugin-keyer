import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetPriceCache,
  getPriceTable,
  lookupPrice,
  normalizePrice,
  parseModelsDev,
  refreshPriceTable,
} from "./modelPrices";

beforeEach(() => {
  _resetPriceCache();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("parseModelsDev", () => {
  it("maps models.dev per-million costs without rescaling", () => {
    const table = parseModelsDev({
      anthropic: {
        id: "anthropic",
        models: {
          "claude-sonnet-4-5": {
            id: "claude-sonnet-4-5",
            cost: { input: 3, output: 15, cache_read: 0.3 },
          },
        },
      },
    });
    expect(lookupPrice(table, "CLAUDE-SONNET-4-5")).toEqual({
      input_price_per_million: 3,
      output_price_per_million: 15,
      cache_read_price_per_million: 0.3,
    });
  });

  it("prefers a first-party catalog over an earlier gateway duplicate", () => {
    const table = parseModelsDev({
      gateway: {
        id: "gateway",
        models: { "gpt-4o": { id: "gpt-4o", cost: { input: 8, output: 24 } } },
      },
      openai: {
        id: "openai",
        models: { "gpt-4o": { id: "gpt-4o", cost: { input: 2.5, output: 10, cache_read: 1.25 } } },
      },
    });
    expect(lookupPrice(table, "gpt-4o")).toEqual({
      input_price_per_million: 2.5,
      output_price_per_million: 10,
      cache_read_price_per_million: 1.25,
    });
  });

  it("uses the model object id and defaults missing components to zero", () => {
    const table = parseModelsDev({
      provider: {
        models: {
          alias: { id: "Real-Model", cost: { input: 0.2 } },
          missing: { id: "missing", cost: {} },
        },
      },
    });
    expect(lookupPrice(table, "real-model")).toEqual({
      input_price_per_million: 0.2,
      output_price_per_million: 0,
      cache_read_price_per_million: 0,
    });
    expect(lookupPrice(table, "missing")).toBeNull();
  });

  it("normalizes floating-point tails and ignores invalid providers", () => {
    const table = parseModelsDev({
      invalid: "nope",
      valid: {
        models: {
          clean: { cost: { input: 0.19999999999999998, output: -1 } },
        },
      },
    });
    expect(lookupPrice(table, "clean")).toEqual({
      input_price_per_million: 0.2,
      output_price_per_million: 0,
      cache_read_price_per_million: 0,
    });
    expect(normalizePrice(Number.NaN)).toBe(0);
  });
});

describe("models.dev price caching", () => {
  const payload = {
    openai: {
      id: "openai",
      models: { "gpt-4o": { id: "gpt-4o", cost: { input: 2.5, output: 10 } } },
    },
  };

  it("fetches once and reuses the session cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(lookupPrice(await getPriceTable(), "gpt-4o")).not.toBeNull();
    expect(lookupPrice(await getPriceTable(), "gpt-4o")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("cpa-keyer:models-dev-prices")).not.toBeNull();
  });

  it("refreshes explicitly even when a valid cache exists", async () => {
    sessionStorage.setItem("cpa-keyer:models-dev-prices", JSON.stringify({
      fetchedAt: Date.now(),
      table: [["cached", {
        input_price_per_million: 1,
        output_price_per_million: 2,
        cache_read_price_per_million: 0,
      }]],
    }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(lookupPrice(await getPriceTable(), "cached")).not.toBeNull();
    expect(lookupPrice(await refreshPriceTable(), "gpt-4o")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for passive load failures and surfaces explicit sync failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    expect(await getPriceTable()).toBeNull();
    await expect(refreshPriceTable()).rejects.toThrow("models.dev request failed (503)");
  });

  it("deduplicates concurrent requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const [first, second] = await Promise.all([getPriceTable(), getPriceTable()]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
