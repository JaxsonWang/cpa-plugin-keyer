package policy

import (
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	usageHistoryRetention = 90 * 24 * time.Hour
	usageHistoryMaxEvents = 20_000
)

// UsageEvent is the bounded, privacy-preserving request history used by the
// Keyer dashboard. KeyID is the policy identity delivered by CPA; the raw
// downstream cpa_ credential is never stored.
type UsageEvent struct {
	ID                  int64     `json:"id"`
	Timestamp           time.Time `json:"timestamp"`
	KeyID               string    `json:"key_id"`
	Provider            string    `json:"provider,omitempty"`
	Model               string    `json:"model"`
	UpstreamModel       string    `json:"upstream_model,omitempty"`
	Failed              bool      `json:"failed"`
	BillingMode         string    `json:"billing_mode,omitempty"`
	CostAvailable       bool      `json:"cost_available"`
	CostUSD             float64   `json:"cost_usd"`
	InputTokens         int64     `json:"input_tokens"`
	OutputTokens        int64     `json:"output_tokens"`
	ReasoningTokens     int64     `json:"reasoning_tokens,omitempty"`
	CachedTokens        int64     `json:"cached_tokens,omitempty"`
	CacheReadTokens     int64     `json:"cache_read_tokens,omitempty"`
	CacheCreationTokens int64     `json:"cache_creation_tokens,omitempty"`
	TotalTokens         int64     `json:"total_tokens"`
}

// UsageHistoryState is persisted inside the existing state JSON. Events are
// chronological and bounded by both age and count, so dashboard history cannot
// make the state file grow without limit.
type UsageHistoryState struct {
	NextID int64        `json:"next_id,omitempty"`
	Events []UsageEvent `json:"events,omitempty"`
}

type UsageHistoryFilter struct {
	Since    time.Time
	Until    time.Time
	KeyID    string
	Provider string
	Model    string
	Failed   *bool
}

type UsageEventPage struct {
	Events     []UsageEvent `json:"events"`
	Total      int          `json:"total"`
	Page       int          `json:"page"`
	PageSize   int          `json:"page_size"`
	TotalPages int          `json:"total_pages"`
	Filters    UsageFilters `json:"filters"`
}

type UsageFilters struct {
	KeyIDs    []string `json:"key_ids"`
	Providers []string `json:"providers"`
	Models    []string `json:"models"`
}

type UsageTotals struct {
	RequestCount        int64   `json:"request_count"`
	SuccessCount        int64   `json:"success_count"`
	FailureCount        int64   `json:"failure_count"`
	InputTokens         int64   `json:"input_tokens"`
	OutputTokens        int64   `json:"output_tokens"`
	ReasoningTokens     int64   `json:"reasoning_tokens"`
	CachedTokens        int64   `json:"cached_tokens"`
	CacheReadTokens     int64   `json:"cache_read_tokens"`
	CacheCreationTokens int64   `json:"cache_creation_tokens"`
	TotalTokens         int64   `json:"total_tokens"`
	CostUSD             float64 `json:"cost_usd"`
}

type UsageTrendPoint struct {
	Bucket       time.Time `json:"bucket"`
	RequestCount int64     `json:"request_count"`
	SuccessCount int64     `json:"success_count"`
	FailureCount int64     `json:"failure_count"`
	TotalTokens  int64     `json:"total_tokens"`
	CostUSD      float64   `json:"cost_usd"`
}

type UsageOverview struct {
	From        time.Time         `json:"from"`
	To          time.Time         `json:"to"`
	Granularity string            `json:"granularity"`
	Totals      UsageTotals       `json:"totals"`
	Series      []UsageTrendPoint `json:"series"`
	Filters     UsageFilters      `json:"filters"`
}

type UsageBreakdown struct {
	Name         string  `json:"name"`
	RequestCount int64   `json:"request_count"`
	SuccessCount int64   `json:"success_count"`
	FailureCount int64   `json:"failure_count"`
	TotalTokens  int64   `json:"total_tokens"`
	CostUSD      float64 `json:"cost_usd"`
}

type UsageAnalysis struct {
	From       time.Time        `json:"from"`
	To         time.Time        `json:"to"`
	Totals     UsageTotals      `json:"totals"`
	ByModel    []UsageBreakdown `json:"by_model"`
	ByKey      []UsageBreakdown `json:"by_key"`
	ByProvider []UsageBreakdown `json:"by_provider"`
	Filters    UsageFilters     `json:"filters"`
}

type usageHistory struct {
	mu     sync.RWMutex
	now    func() time.Time
	nextID int64
	events []UsageEvent
}

func newUsageHistory(now func() time.Time) *usageHistory {
	if now == nil {
		now = time.Now
	}
	return &usageHistory{now: now, nextID: 1}
}

func (h *usageHistory) loadFromState(state UsageHistoryState) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.events = append([]UsageEvent(nil), state.Events...)
	sort.SliceStable(h.events, func(i, j int) bool {
		if h.events[i].Timestamp.Equal(h.events[j].Timestamp) {
			return h.events[i].ID < h.events[j].ID
		}
		return h.events[i].Timestamp.Before(h.events[j].Timestamp)
	})
	h.nextID = state.NextID
	if h.nextID < 1 {
		h.nextID = 1
	}
	for _, event := range h.events {
		if event.ID >= h.nextID {
			h.nextID = event.ID + 1
		}
	}
	h.pruneLocked(h.now().UTC())
}

func (h *usageHistory) snapshot() UsageHistoryState {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneLocked(h.now().UTC())
	return UsageHistoryState{
		NextID: h.nextID,
		Events: append([]UsageEvent(nil), h.events...),
	}
}

func (h *usageHistory) record(event UsageEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now().UTC()
	if event.Timestamp.IsZero() {
		event.Timestamp = now
	} else {
		event.Timestamp = event.Timestamp.UTC()
	}
	event.ID = h.nextID
	h.nextID++
	event.KeyID = strings.TrimSpace(event.KeyID)
	event.Provider = strings.TrimSpace(event.Provider)
	event.Model = strings.TrimSpace(event.Model)
	event.UpstreamModel = strings.TrimSpace(event.UpstreamModel)
	event.BillingMode = strings.TrimSpace(event.BillingMode)
	if event.TotalTokens <= 0 {
		event.TotalTokens = maxInt64(0, event.InputTokens) + maxInt64(0, event.OutputTokens)
	}
	h.events = append(h.events, event)
	h.pruneLocked(now)
}

func (h *usageHistory) pruneLocked(now time.Time) {
	cutoff := now.Add(-usageHistoryRetention)
	first := sort.Search(len(h.events), func(i int) bool {
		return !h.events[i].Timestamp.Before(cutoff)
	})
	if first > 0 {
		h.events = append([]UsageEvent(nil), h.events[first:]...)
	}
	if overflow := len(h.events) - usageHistoryMaxEvents; overflow > 0 {
		h.events = append([]UsageEvent(nil), h.events[overflow:]...)
	}
}

func (h *usageHistory) allEvents() []UsageEvent {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.pruneLocked(h.now().UTC())
	return append([]UsageEvent(nil), h.events...)
}

func (h *usageHistory) eventPage(filter UsageHistoryFilter, page, pageSize int) UsageEventPage {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > 200 {
		pageSize = 200
	}
	events := h.allEvents()
	filtered := filterUsageEvents(events, filter)
	total := len(filtered)
	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	rows := make([]UsageEvent, 0, end-start)
	for i := total - 1 - start; i >= total-end; i-- {
		rows = append(rows, filtered[i])
	}
	return UsageEventPage{
		Events: rows, Total: total, Page: page, PageSize: pageSize,
		TotalPages: totalPages, Filters: usageFilterOptions(events),
	}
}

func (h *usageHistory) overview(filter UsageHistoryFilter) UsageOverview {
	filter = normalizeHistoryRange(filter, h.now().UTC())
	events := filterUsageEvents(h.allEvents(), filter)
	duration := filter.Until.Sub(filter.Since)
	step := time.Hour
	granularity := "hour"
	if duration > 48*time.Hour {
		step = 24 * time.Hour
		granularity = "day"
	}
	from := truncateBucket(filter.Since, step)
	to := filter.Until
	points := make(map[time.Time]*UsageTrendPoint)
	for bucket := from; bucket.Before(to); bucket = bucket.Add(step) {
		points[bucket] = &UsageTrendPoint{Bucket: bucket}
	}
	totals := UsageTotals{}
	for _, event := range events {
		addEventToTotals(&totals, event)
		bucket := truncateBucket(event.Timestamp, step)
		point := points[bucket]
		if point == nil {
			continue
		}
		point.RequestCount++
		if event.Failed {
			point.FailureCount++
		} else {
			point.SuccessCount++
		}
		point.TotalTokens += event.TotalTokens
		point.CostUSD += event.CostUSD
	}
	series := make([]UsageTrendPoint, 0, len(points))
	for bucket := from; bucket.Before(to); bucket = bucket.Add(step) {
		series = append(series, *points[bucket])
	}
	return UsageOverview{
		From: filter.Since, To: filter.Until, Granularity: granularity,
		Totals: totals, Series: series, Filters: usageFilterOptions(h.allEvents()),
	}
}

func (h *usageHistory) analysis(filter UsageHistoryFilter) UsageAnalysis {
	filter = normalizeHistoryRange(filter, h.now().UTC())
	all := h.allEvents()
	events := filterUsageEvents(all, filter)
	result := UsageAnalysis{
		From: filter.Since, To: filter.Until, Filters: usageFilterOptions(all),
	}
	byModel := make(map[string]*UsageBreakdown)
	byKey := make(map[string]*UsageBreakdown)
	byProvider := make(map[string]*UsageBreakdown)
	for _, event := range events {
		addEventToTotals(&result.Totals, event)
		addEventToBreakdown(byModel, valueOrUnknown(event.Model), event)
		addEventToBreakdown(byKey, valueOrUnknown(event.KeyID), event)
		addEventToBreakdown(byProvider, valueOrUnknown(event.Provider), event)
	}
	result.ByModel = sortedBreakdowns(byModel)
	result.ByKey = sortedBreakdowns(byKey)
	result.ByProvider = sortedBreakdowns(byProvider)
	return result
}

func normalizeHistoryRange(filter UsageHistoryFilter, now time.Time) UsageHistoryFilter {
	if filter.Until.IsZero() {
		filter.Until = now
	}
	if filter.Since.IsZero() || !filter.Since.Before(filter.Until) {
		filter.Since = filter.Until.Add(-7 * 24 * time.Hour)
	}
	filter.Since = filter.Since.UTC()
	filter.Until = filter.Until.UTC()
	return filter
}

func filterUsageEvents(events []UsageEvent, filter UsageHistoryFilter) []UsageEvent {
	result := make([]UsageEvent, 0, len(events))
	for _, event := range events {
		if !filter.Since.IsZero() && event.Timestamp.Before(filter.Since) {
			continue
		}
		if !filter.Until.IsZero() && !event.Timestamp.Before(filter.Until) {
			continue
		}
		if filter.KeyID != "" && !strings.EqualFold(event.KeyID, filter.KeyID) {
			continue
		}
		if filter.Provider != "" && !strings.EqualFold(event.Provider, filter.Provider) {
			continue
		}
		if filter.Model != "" && !strings.EqualFold(event.Model, filter.Model) && !strings.EqualFold(event.UpstreamModel, filter.Model) {
			continue
		}
		if filter.Failed != nil && event.Failed != *filter.Failed {
			continue
		}
		result = append(result, event)
	}
	return result
}

func usageFilterOptions(events []UsageEvent) UsageFilters {
	keys := make(map[string]struct{})
	providers := make(map[string]struct{})
	models := make(map[string]struct{})
	for _, event := range events {
		if value := strings.TrimSpace(event.KeyID); value != "" {
			keys[value] = struct{}{}
		}
		if value := strings.TrimSpace(event.Provider); value != "" {
			providers[value] = struct{}{}
		}
		if value := strings.TrimSpace(event.Model); value != "" {
			models[value] = struct{}{}
		}
	}
	return UsageFilters{
		KeyIDs: sortedKeys(keys), Providers: sortedKeys(providers), Models: sortedKeys(models),
	}
}

func sortedKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func addEventToTotals(total *UsageTotals, event UsageEvent) {
	total.RequestCount++
	if event.Failed {
		total.FailureCount++
	} else {
		total.SuccessCount++
	}
	total.InputTokens += event.InputTokens
	total.OutputTokens += event.OutputTokens
	total.ReasoningTokens += event.ReasoningTokens
	total.CachedTokens += event.CachedTokens
	total.CacheReadTokens += event.CacheReadTokens
	total.CacheCreationTokens += event.CacheCreationTokens
	total.TotalTokens += event.TotalTokens
	total.CostUSD += event.CostUSD
}

func addEventToBreakdown(rows map[string]*UsageBreakdown, name string, event UsageEvent) {
	row := rows[name]
	if row == nil {
		row = &UsageBreakdown{Name: name}
		rows[name] = row
	}
	row.RequestCount++
	if event.Failed {
		row.FailureCount++
	} else {
		row.SuccessCount++
	}
	row.TotalTokens += event.TotalTokens
	row.CostUSD += event.CostUSD
}

func sortedBreakdowns(rows map[string]*UsageBreakdown) []UsageBreakdown {
	result := make([]UsageBreakdown, 0, len(rows))
	for _, row := range rows {
		result = append(result, *row)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].RequestCount != result[j].RequestCount {
			return result[i].RequestCount > result[j].RequestCount
		}
		return result[i].Name < result[j].Name
	})
	return result
}

func truncateBucket(value time.Time, step time.Duration) time.Time {
	value = value.UTC()
	if step >= 24*time.Hour {
		return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
	}
	return value.Truncate(step)
}

func valueOrUnknown(value string) string {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		return trimmed
	}
	return "unknown"
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
