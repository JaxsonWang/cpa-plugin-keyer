// Model price hints from models.dev. The API already exposes USD prices per
// million tokens, which is the same unit used by cpa-keyer model rules.

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_KEY = "cpa-keyer:models-dev-prices";
const TTL_MS = 24 * 60 * 60 * 1000;
const PRICE_DECIMAL_PLACES = 12;

// Prefer first-party catalogs when models.dev contains the same model in
// several gateways. cpa-keyer deliberately stores only the real model id, not
// a provider route, so first-party list prices are the least surprising
// reference value for an exact-id match.
const FIRST_PARTY_PROVIDERS = new Set([
  "anthropic",
  "azure",
  "azure-cognitive-services",
  "google",
  "google-vertex",
  "groq",
  "mistral",
  "openai",
  "xai",
]);

export interface PriceRow {
  input_price_per_million: number;
  output_price_per_million: number;
  cache_read_price_per_million: number;
}

interface RankedPriceRow extends PriceRow {
  sourceRank: number;
}

export type PriceTable = Map<string, PriceRow>;

interface CacheEnvelope {
  fetchedAt: number;
  table: [string, PriceRow][];
}

interface ModelsDevCost {
  input?: unknown;
  output?: unknown;
  cache_read?: unknown;
}

interface ModelsDevModel {
  id?: unknown;
  cost?: ModelsDevCost;
}

interface ModelsDevProvider {
  id?: unknown;
  models?: Record<string, ModelsDevModel>;
}

export function normalizePrice(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Number(value.toFixed(PRICE_DECIMAL_PLACES));
}

function normalizePriceRow(row: PriceRow): PriceRow {
  return {
    input_price_per_million: normalizePrice(row.input_price_per_million),
    output_price_per_million: normalizePrice(row.output_price_per_million),
    cache_read_price_per_million: normalizePrice(row.cache_read_price_per_million),
  };
}

function hasPrice(cost: ModelsDevCost | undefined): cost is ModelsDevCost {
  if (!cost || typeof cost !== "object") return false;
  return [cost.input, cost.output, cost.cache_read].some(
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
}

export function parseModelsDev(raw: Record<string, unknown>): PriceTable {
  const ranked = new Map<string, RankedPriceRow>();

  for (const [providerKey, providerValue] of Object.entries(raw)) {
    if (!providerValue || typeof providerValue !== "object") continue;
    const provider = providerValue as ModelsDevProvider;
    if (!provider.models || typeof provider.models !== "object") continue;

    const providerID = typeof provider.id === "string" ? provider.id : providerKey;
    const sourceRank = FIRST_PARTY_PROVIDERS.has(providerID.toLowerCase()) ? 2 : 1;

    for (const [modelKey, modelValue] of Object.entries(provider.models)) {
      if (!modelValue || typeof modelValue !== "object") continue;
      const modelID = typeof modelValue.id === "string" ? modelValue.id.trim() : modelKey.trim();
      if (!modelID || !hasPrice(modelValue.cost)) continue;

      const key = modelID.toLowerCase();
      const current = ranked.get(key);
      if (current && current.sourceRank >= sourceRank) continue;

      ranked.set(key, {
        input_price_per_million: normalizePrice(modelValue.cost.input),
        output_price_per_million: normalizePrice(modelValue.cost.output),
        cache_read_price_per_million: normalizePrice(modelValue.cost.cache_read),
        sourceRank,
      });
    }
  }

  return new Map(
    Array.from(ranked, ([model, row]) => [model, normalizePriceRow(row)]),
  );
}

function readCache(): PriceTable | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as CacheEnvelope;
    if (!envelope || typeof envelope.fetchedAt !== "number" || !Array.isArray(envelope.table)) {
      return null;
    }
    if (Date.now() - envelope.fetchedAt > TTL_MS) return null;
    return new Map(envelope.table.map(([model, row]) => [model, normalizePriceRow(row)]));
  } catch {
    return null;
  }
}

function writeCache(table: PriceTable): void {
  try {
    const envelope: CacheEnvelope = {
      fetchedAt: Date.now(),
      table: Array.from(table.entries()),
    };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // The in-memory result is still usable when sessionStorage is unavailable.
  }
}

let inflight: Promise<PriceTable> | null = null;

async function fetchPriceTable(): Promise<PriceTable> {
  if (inflight) return inflight;
  inflight = (async () => {
    const response = await fetch(MODELS_DEV_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`models.dev request failed (${response.status})`);
    const json = (await response.json()) as Record<string, unknown>;
    if (!json || typeof json !== "object") throw new Error("models.dev returned invalid JSON");
    const table = parseModelsDev(json);
    if (table.size === 0) throw new Error("models.dev returned no model prices");
    writeCache(table);
    return table;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export async function getPriceTable(): Promise<PriceTable | null> {
  const cached = readCache();
  if (cached) return cached;
  try {
    return await fetchPriceTable();
  } catch {
    return null;
  }
}

export async function refreshPriceTable(): Promise<PriceTable> {
  return fetchPriceTable();
}

export function lookupPrice(table: PriceTable | null, model: string): PriceRow | null {
  if (!table || !model) return null;
  const row = table.get(model.toLowerCase());
  return row ? normalizePriceRow(row) : null;
}

export function _resetPriceCache(): void {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // Test helper and private-mode cleanup only.
  }
  inflight = null;
}
