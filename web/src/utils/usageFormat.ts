import type { UsageTotals } from "../types";

export function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value || 0);
}

export function formatUSD(value: number): string {
  const digits = Math.abs(value) < 0.01 && value !== 0 ? 6 : 4;
  return `$${(value || 0).toFixed(digits)}`;
}

export function successRate(totals: Pick<UsageTotals, "request_count" | "success_count">): string {
  if (!totals.request_count) return "—";
  return `${((totals.success_count / totals.request_count) * 100).toFixed(1)}%`;
}

export function cacheRate(totals: Pick<UsageTotals, "cache_read_tokens" | "cached_tokens" | "input_tokens">): string {
	const cached = Math.max(totals.cache_read_tokens, totals.cached_tokens);
	const denominator = cached + totals.input_tokens;
	if (!denominator) return "—";
	return `${((cached / denominator) * 100).toFixed(1)}%`;
}
