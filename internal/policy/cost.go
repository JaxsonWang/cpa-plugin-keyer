package policy

import (
	"encoding/json"
	"strings"
	"time"
)

// TokenUsage is the prompt/completion token counts extracted from a response body.
// A zero value means no usage could be parsed (e.g. streaming response with no body).
type TokenUsage struct {
	PromptTokens     int
	CompletionTokens int
	Found            bool
}

// isCacheAdditiveProvider reports whether the provider reports cache-hit input
// tokens SEPARATELY from InputTokens (so InputTokens excludes cache reads and
// the two must be summed). Anthropic/Claude is the additive case: CPA parses
// input_tokens, cache_read_input_tokens, cache_creation_input_tokens as
// independent fields and sets TotalTokens = Input + Output + CacheRead +
// CacheCreation (usage_helpers.parseClaudeUsageNode). All other providers CPA
// supports (OpenAI, Gemini, Codex, ...) report cache hits as a SUBSET already
// counted inside InputTokens (prompt_tokens_details.cached_tokens,
// cachedContentTokenCount) — the subset must be split out and repriced rather
// than added.
func isCacheAdditiveProvider(provider string) bool {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "claude", "anthropic", "vertex-claude":
		return true
	default:
		return false
	}
}

// UsageDetail is the token breakdown delivered by the host's usage.handle call,
// already parsed from the upstream response (including the final usage frame of
// a stream). Only the fields we bill on are tracked here.
type UsageDetail struct {
	Provider            string
	ExecutorType        string
	AuthType            string
	AuthIndex           string
	Source              string
	ReasoningEffort     string
	ServiceTier         string
	Generate            *bool
	RequestedAt         time.Time
	Latency             time.Duration
	TTFT                time.Duration
	FailureStatusCode   int
	InputTokens         int64
	OutputTokens        int64
	ReasoningTokens     int64
	CachedTokens        int64
	CacheReadTokens     int64
	CacheCreationTokens int64
	TotalTokens         int64
}

// ParseTokenUsage inspects a response body and extracts prompt/completion token
// counts. It supports the three usage shapes seen across CPA's providers:
//   - OpenAI / OpenAI-compatible: { "usage": { "prompt_tokens", "completion_tokens" } }
//   - Anthropic: { "usage": { "input_tokens", "output_tokens" } }
//   - Gemini:    { "usage_metadata": { "promptTokenCount", "candidatesTokenCount" } }
//
// For streaming responses the body is a Server-Sent-Events stream; the final
// frame usually carries cumulative usage. We split the SSE `data:` lines and
// take the max prompt/completion seen across frames (streaming usage is
// cumulative, so the max equals the final total — e.g. Anthropic emits
// input_tokens in message_start and output_tokens in a later message_delta).
//
// On any parse failure (empty body, garbage, SSE with no usage frame) it
// returns a zero-value TokenUsage (Found=false) so the caller skips billing
// rather than crashing a request path.
func ParseTokenUsage(body []byte) TokenUsage {
	if len(body) == 0 {
		return TokenUsage{}
	}
	// Fast path: a single JSON object (non-streaming response).
	if json.Valid(body) {
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err == nil {
			if u := usageFromObject(payload); u.Found {
				return u
			}
		}
		return TokenUsage{}
	}
	// Streaming path: SSE text. Scan `data:` lines and accumulate usage.
	return parseTokenUsageFromSSE(body)
}

// usageFromObject extracts usage from a single decoded JSON object. It checks
// the top-level "usage" / "usage_metadata" keys, and also recurses one level
// into nested objects (Anthropic's streaming message_start frame nests usage
// under {"message":{"usage":{...}}}).
func usageFromObject(payload map[string]any) TokenUsage {
	if u := usageAtKeys(payload); u.Found {
		return u
	}
	for _, v := range payload {
		if nested, ok := v.(map[string]any); ok {
			if u := usageAtKeys(nested); u.Found {
				return u
			}
		}
	}
	return TokenUsage{}
}

// usageAtKeys checks the known usage-carrying keys on one object level.
func usageAtKeys(payload map[string]any) TokenUsage {
	if usage, ok := payload["usage"].(map[string]any); ok {
		if u := fromOpenAIUsage(usage); u.Found {
			return u
		}
		if u := fromAnthropicUsage(usage); u.Found {
			return u
		}
	}
	if usage, ok := payload["usage_metadata"].(map[string]any); ok {
		if u := fromGeminiUsage(usage); u.Found {
			return u
		}
	}
	return TokenUsage{}
}

// parseTokenUsageFromSSE walks each `data: <json>` line of an SSE stream and
// returns the cumulative token counts. Across frames we track the maximum
// prompt and completion tokens seen, because providers report usage
// cumulatively (the highest value is the final total). Returns Found=false if
// no frame carries usage.
func parseTokenUsageFromSSE(body []byte) TokenUsage {
	var maxPrompt, maxCompletion int
	found := false
	for _, raw := range strings.Split(string(body), "\n") {
		line := strings.TrimSpace(raw)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		if !json.Valid([]byte(payload)) {
			continue
		}
		var obj map[string]any
		if err := json.Unmarshal([]byte(payload), &obj); err != nil {
			continue
		}
		if u := usageFromObject(obj); u.Found {
			found = true
			if u.PromptTokens > maxPrompt {
				maxPrompt = u.PromptTokens
			}
			if u.CompletionTokens > maxCompletion {
				maxCompletion = u.CompletionTokens
			}
		}
	}
	if !found {
		return TokenUsage{}
	}
	return TokenUsage{PromptTokens: maxPrompt, CompletionTokens: maxCompletion, Found: true}
}

func fromOpenAIUsage(usage map[string]any) TokenUsage {
	p := toInt(usage["prompt_tokens"])
	c := toInt(usage["completion_tokens"])
	if p == 0 && c == 0 {
		return TokenUsage{}
	}
	return TokenUsage{PromptTokens: p, CompletionTokens: c, Found: true}
}

func fromAnthropicUsage(usage map[string]any) TokenUsage {
	p := toInt(usage["input_tokens"])
	c := toInt(usage["output_tokens"])
	if p == 0 && c == 0 {
		return TokenUsage{}
	}
	return TokenUsage{PromptTokens: p, CompletionTokens: c, Found: true}
}

func fromGeminiUsage(usage map[string]any) TokenUsage {
	p := toInt(usage["promptTokenCount"])
	c := toInt(usage["candidatesTokenCount"])
	if p == 0 && c == 0 {
		return TokenUsage{}
	}
	return TokenUsage{PromptTokens: p, CompletionTokens: c, Found: true}
}

func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case string:
		trimmed := strings.TrimSpace(n)
		if trimmed == "" {
			return 0
		}
		var i int
		for _, r := range trimmed {
			if r < '0' || r > '9' {
				return 0
			}
			i = i*10 + int(r-'0')
		}
		return i
	}
	return 0
}

// PriceForModel looks up the configured per-million-token prices for an exact
// model on this key. Unknown models are not billed by this helper.
func (k *KeyConfig) PriceForModel(model string) (inputPerMillion, outputPerMillion, cacheReadPerMillion float64, ok bool) {
	model = strings.TrimSpace(model)
	if model == "" {
		return 0, 0, 0, false
	}
	for _, rule := range k.Models {
		if strings.EqualFold(strings.TrimSpace(rule.Model), model) {
			return rule.InputPricePerMillion, rule.OutputPricePerMillion, rule.CacheReadPricePerMillion, true
		}
	}
	return 0, 0, 0, false
}

// PriceForAlias is kept as a source-compatibility shim for callers compiled
// against v0.4.x. The runtime no longer routes aliases.
func (k *KeyConfig) PriceForAlias(alias string) (float64, float64, float64, bool) {
	return k.PriceForModel(alias)
}

// ComputeCost 使用模型单价和 usage 计算本次请求成本，并按统一小数精度规范化结果。
// ComputeCost converts token usage into a dollar amount using the model rule's prices.
// Prices are USD per 1M tokens; cost = (tokens / 1_000_000) * price.
// Unknown model (ok=false) → 0 cost (unpriced requests are not billed).
// This path does not see cache breakdown (it bills from a parsed response body
// with only prompt/completion counts); cache-aware billing lives in
// ComputeCacheCost, used by the usage.handle path that carries full token detail.
func ComputeCost(inputPerMillion, outputPerMillion float64, priced bool, usage TokenUsage) float64 {
	if !priced || !usage.Found {
		return 0
	}
	return normalizePrice(
		float64(usage.PromptTokens)/1_000_000*inputPerMillion +
			float64(usage.CompletionTokens)/1_000_000*outputPerMillion,
	)
}

// ComputeCacheCost is the cache-aware biller for the usage.handle path. It takes
// the full token detail (with cache breakdown) plus the model rule's prices and CPA's
// actual upstream provider, and prices cache-hit input tokens at the cache-read
// price instead of the regular input price. Provider semantics:
//
//   - Additive providers (Anthropic/Claude): cache-read tokens are reported
//     OUTSIDE InputTokens, so the cache-read subset is billed at the cache price
//     and InputTokens at the input price, summed. Cache-creation tokens are not
//     covered by the single cache-read price and are billed at the input price
//     (they are fresh prompt tokens that got written to the cache).
//   - Subset providers (OpenAI/Gemini/Codex/...): cache-hit tokens are already
//     INSIDE InputTokens, so we split them out: (InputTokens - cacheHits) at the
//     input price + cacheHits at the cache price, to avoid double-counting.
//
// When cacheReadPerMillion is 0 (not configured), cache hits fall back to the
// regular input price in both cases, preserving prior behavior. priced=false or
// no usable tokens → 0.
//
// cacheReadTokensOut reports the number of cache-hit input tokens billed at the
// cache price for THIS record (for the ledger's hit-rate / cache-cost tracking).
// It is the same CacheRead value used inside the cost formula (after clamping
// for subset providers); 0 when the record had no cache hits or was unpriced.
func ComputeCacheCost(provider string, inputPerMillion, outputPerMillion, cacheReadPerMillion float64, priced bool, detail UsageDetail) float64 {
	total, _, _ := ComputeCacheCostBreakdown(provider, inputPerMillion, outputPerMillion, cacheReadPerMillion, priced, detail)
	return total
}

// ComputeCacheCostBreakdown is the same biller as ComputeCacheCost but also
// returns the cache-hit breakdown used for reporting (cache spend + the cache
// count billed at the cache price). Callers that only need the total should
// call ComputeCacheCost; the ledger calls this to accumulate cache stats.
//
// Returns:
//   - totalCost: the full dollar bill (same as ComputeCacheCost).
//   - cacheCost: the dollar portion attributable to cache-hit input tokens
//     (cacheRead × cachePrice / 1M). When no cache is configured (cacheRead=0)
//     or the alias is unpriced, cacheCost is 0 even if cache hits existed
//     (because they were folded into the input-price line, not separably priced).
//   - cacheReadTokens: the cache-hit count billed at the cache price (post-clamp).
func ComputeCacheCostBreakdown(provider string, inputPerMillion, outputPerMillion, cacheReadPerMillion float64, priced bool, detail UsageDetail) (totalCost, cacheCost float64, cacheReadTokens int64) {
	breakdown := ComputeUsageCostBreakdown(provider, inputPerMillion, outputPerMillion, cacheReadPerMillion, priced, detail)
	return breakdown.TotalUSD, breakdown.CacheReadUSD, breakdown.CacheReadTokens
}

// UsageCostBreakdown preserves the exact billing total while retaining the
// component amounts required by the dashboard. Cache creation currently uses
// the configured input price because Keyer has no separate cache-write price.
type UsageCostBreakdown struct {
	TotalUSD            float64
	UncachedInputUSD    float64
	CacheReadUSD        float64
	CacheCreationUSD    float64
	OutputUSD           float64
	CacheReadTokens     int64
	NonCacheInputTokens int64
}

// ComputeUsageCostBreakdown 使用 provider 的缓存语义生成唯一的成本分项和总额。
// ComputeUsageCostBreakdown is the single cache-aware pricing implementation.
// When no explicit cache-read price exists, cache-hit spend remains folded into
// the input component so the visible components always add up to TotalUSD.
func ComputeUsageCostBreakdown(provider string, inputPerMillion, outputPerMillion, cacheReadPerMillion float64, priced bool, detail UsageDetail) UsageCostBreakdown {
	if !priced {
		return UsageCostBreakdown{}
	}
	input := detail.InputTokens
	output := detail.OutputTokens
	if input == 0 && output == 0 && detail.CachedTokens == 0 && detail.CacheReadTokens == 0 && detail.CacheCreationTokens == 0 {
		return UsageCostBreakdown{}
	}
	cacheRead := detail.CacheReadTokens
	if cacheRead == 0 {
		// OpenAI/Gemini/Codex report cache hits as CachedTokens (a subset of
		// input) without a separate CacheRead field; Claude sets CachedTokens =
		// CacheReadTokens. Either way CachedTokens is the cache-hit count.
		cacheRead = detail.CachedTokens
	}
	explicitCachePrice := cacheReadPerMillion != 0
	cachePrice := cacheReadPerMillion
	if !explicitCachePrice {
		cachePrice = inputPerMillion
	}

	breakdown := UsageCostBreakdown{CacheReadTokens: cacheRead}
	if isCacheAdditiveProvider(provider) {
		breakdown.NonCacheInputTokens = input + detail.CacheCreationTokens
		breakdown.CacheCreationUSD = normalizePrice(float64(detail.CacheCreationTokens) / 1_000_000 * inputPerMillion)
		if explicitCachePrice {
			breakdown.UncachedInputUSD = normalizePrice(float64(input) / 1_000_000 * inputPerMillion)
			breakdown.CacheReadUSD = normalizePrice(float64(cacheRead) / 1_000_000 * cachePrice)
		} else {
			breakdown.UncachedInputUSD = normalizePrice(float64(input+cacheRead) / 1_000_000 * inputPerMillion)
		}
	} else {
		if cacheRead > input {
			cacheRead = input
			breakdown.CacheReadTokens = cacheRead
		}
		breakdown.NonCacheInputTokens = input - cacheRead
		if explicitCachePrice {
			breakdown.UncachedInputUSD = normalizePrice(float64(input-cacheRead) / 1_000_000 * inputPerMillion)
			breakdown.CacheReadUSD = normalizePrice(float64(cacheRead) / 1_000_000 * cachePrice)
		} else {
			breakdown.UncachedInputUSD = normalizePrice(float64(input) / 1_000_000 * inputPerMillion)
		}
	}
	breakdown.OutputUSD = normalizePrice(float64(output) / 1_000_000 * outputPerMillion)
	breakdown.TotalUSD = normalizePrice(breakdown.UncachedInputUSD + breakdown.CacheReadUSD + breakdown.CacheCreationUSD + breakdown.OutputUSD)
	return breakdown
}
