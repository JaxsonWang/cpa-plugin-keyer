import type { UsageRange } from "../types";

const USAGE_RANGES = new Set<UsageRange>(["24h", "7d", "30d", "90d"]);

export function readUsageRange(params: URLSearchParams): UsageRange {
  const value = params.get("range") as UsageRange | null;
  return value && USAGE_RANGES.has(value) ? value : "7d";
}

export function readPositivePage(params: URLSearchParams): number {
  const value = Number.parseInt(params.get("page") ?? "1", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function patchSearchParams(
  current: URLSearchParams,
  values: Readonly<Record<string, string | number | undefined>>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === "" || (name === "page" && value === 1) || (name === "range" && value === "7d")) {
      next.delete(name);
    } else {
      next.set(name, String(value));
    }
  }
  return next;
}
