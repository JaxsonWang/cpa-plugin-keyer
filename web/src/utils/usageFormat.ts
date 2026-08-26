import type { UsageTotals } from "../types";

export function formatCount(value: number): string {
  const normalized = Number.isFinite(value) ? value : 0;
  if (Math.abs(normalized) >= 10_000) {
    const millions = normalized / 1_000_000;
    const maximumFractionDigits = Math.abs(millions) < 0.1 ? 3 : Math.abs(millions) < 10 ? 2 : 1;
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(millions)}M`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(normalized);
}

export function formatUSD(value: number): string {
  const normalized = Number.isFinite(value) ? value : 0;
  return `$${normalized.toFixed(1)}`;
}

export function formatSummaryUSD(value: number): string {
  return formatUSD(value);
}

export function successRate(totals: Pick<UsageTotals, "request_count" | "success_count">): string {
  if (!totals.request_count) return "—";
  return `${((totals.success_count / totals.request_count) * 100).toFixed(1)}%`;
}

export function cacheRate(totals: Pick<UsageTotals, "cache_read_tokens" | "cached_tokens" | "input_tokens">): string {
  const value = cacheRateValue(totals);
  return value === undefined ? "—" : formatPercent(value);
}

export function cacheRateValue(totals: Pick<UsageTotals, "cache_read_tokens" | "cached_tokens" | "input_tokens">): number | undefined {
  const cached = Math.max(totals.cache_read_tokens, totals.cached_tokens);
  const denominator = totals.input_tokens;
  if (!denominator) return undefined;
  return Math.min(1, cached / denominator);
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function averagePerMinute(value: number, from: string, to: string): number {
  const durationMinutes = (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
  return durationMinutes > 0 ? value / durationMinutes : 0;
}

export function formatRate(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 10_000) return formatCount(value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function costPerMillion(costUSD: number, totalTokens: number): string {
  if (!totalTokens) return "—";
  return formatUSD((costUSD / totalTokens) * 1_000_000);
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1) return "<1 ms";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function isUnrecordedDimension(value: string | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return normalized === "" || normalized.toLowerCase() === "unknown";
}

export function formatDimensionName(value: string | undefined, unrecordedLabel: string): string {
  return isUnrecordedDimension(value) ? unrecordedLabel : value!.trim();
}

export function tokensPerSecond(outputTokens: number, latencyMS: number, ttftMS?: number): number | undefined {
  if (!Number.isFinite(outputTokens) || outputTokens <= 0 || !Number.isFinite(latencyMS) || latencyMS <= 0 || ttftMS === undefined || ttftMS <= 0 || latencyMS <= ttftMS) {
    return undefined;
  }
  return outputTokens / ((latencyMS - ttftMS) / 1_000);
}
