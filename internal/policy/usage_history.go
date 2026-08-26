package policy

import (
	"fmt"
	"strings"
	"time"
)

// UsageEvent is the request history used by the Keyer dashboard. KeyID is the
// policy identity delivered by CPA; KeyPreview contains only a masked suffix.
type UsageEvent struct {
	ID                  int64     `json:"id"`
	Timestamp           time.Time `json:"timestamp"`
	KeyID               string    `json:"key_id"`
	KeyPreview          string    `json:"key_preview,omitempty"`
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

// UsageHistoryState is decode-only migration input from the legacy JSON state
// schema v3. The current runtime stores request events directly in SQLite.
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
	Bucket              time.Time `json:"bucket"`
	RequestCount        int64     `json:"request_count"`
	SuccessCount        int64     `json:"success_count"`
	FailureCount        int64     `json:"failure_count"`
	InputTokens         int64     `json:"input_tokens"`
	OutputTokens        int64     `json:"output_tokens"`
	ReasoningTokens     int64     `json:"reasoning_tokens"`
	CachedTokens        int64     `json:"cached_tokens"`
	CacheReadTokens     int64     `json:"cache_read_tokens"`
	CacheCreationTokens int64     `json:"cache_creation_tokens"`
	TotalTokens         int64     `json:"total_tokens"`
	CostUSD             float64   `json:"cost_usd"`
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
	Name                string  `json:"name"`
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

type UsageAnalysis struct {
	From       time.Time        `json:"from"`
	To         time.Time        `json:"to"`
	Totals     UsageTotals      `json:"totals"`
	ByModel    []UsageBreakdown `json:"by_model"`
	ByKey      []UsageBreakdown `json:"by_key"`
	ByProvider []UsageBreakdown `json:"by_provider"`
	Filters    UsageFilters     `json:"filters"`
}

const usageEventColumns = `
	id, timestamp_ns, key_id, key_preview, provider, model, upstream_model,
	failed, billing_mode, cost_available, cost_usd, input_tokens, output_tokens,
	reasoning_tokens, cached_tokens, cache_read_tokens, cache_creation_tokens,
	total_tokens`

const usageAggregateColumns = `
	COUNT(*),
	COALESCE(SUM(CASE WHEN failed = 0 THEN 1 ELSE 0 END), 0),
	COALESCE(SUM(CASE WHEN failed != 0 THEN 1 ELSE 0 END), 0),
	COALESCE(SUM(input_tokens), 0),
	COALESCE(SUM(output_tokens), 0),
	COALESCE(SUM(reasoning_tokens), 0),
	COALESCE(SUM(cached_tokens), 0),
	COALESCE(SUM(cache_read_tokens), 0),
	COALESCE(SUM(cache_creation_tokens), 0),
	COALESCE(SUM(total_tokens), 0),
	COALESCE(SUM(cost_usd), 0)`

func (h *stateDatabase) eventPage(filter UsageHistoryFilter, page, pageSize int) (UsageEventPage, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > 200 {
		pageSize = 200
	}
	where, args := usageWhere(filter)
	var total int
	if err := h.db.QueryRow(`SELECT COUNT(*) FROM usage_events`+where, args...).Scan(&total); err != nil {
		return UsageEventPage{}, fmt.Errorf("count usage events: %w", err)
	}
	totalPages := 0
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	offset := (page - 1) * pageSize
	queryArgs := append(append([]any(nil), args...), pageSize, offset)
	rows, err := h.db.Query(`SELECT `+usageEventColumns+` FROM usage_events`+where+` ORDER BY timestamp_ns DESC, id DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return UsageEventPage{}, fmt.Errorf("query usage events: %w", err)
	}
	defer rows.Close()
	events := make([]UsageEvent, 0, pageSize)
	for rows.Next() {
		event, err := scanUsageEvent(rows)
		if err != nil {
			return UsageEventPage{}, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return UsageEventPage{}, fmt.Errorf("iterate usage events: %w", err)
	}
	filters, err := h.filterOptions()
	if err != nil {
		return UsageEventPage{}, err
	}
	return UsageEventPage{
		Events: events, Total: total, Page: page, PageSize: pageSize,
		TotalPages: totalPages, Filters: filters,
	}, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanUsageEvent(row rowScanner) (UsageEvent, error) {
	var event UsageEvent
	var timestamp int64
	var failed, costAvailable int
	if err := row.Scan(
		&event.ID, &timestamp, &event.KeyID, &event.KeyPreview, &event.Provider,
		&event.Model, &event.UpstreamModel, &failed, &event.BillingMode,
		&costAvailable, &event.CostUSD, &event.InputTokens, &event.OutputTokens,
		&event.ReasoningTokens, &event.CachedTokens, &event.CacheReadTokens,
		&event.CacheCreationTokens, &event.TotalTokens,
	); err != nil {
		return UsageEvent{}, fmt.Errorf("scan usage event: %w", err)
	}
	event.Timestamp = time.Unix(0, timestamp).UTC()
	event.Failed = failed != 0
	event.CostAvailable = costAvailable != 0
	return event, nil
}

func (h *stateDatabase) overview(filter UsageHistoryFilter) (UsageOverview, error) {
	filter = normalizeHistoryRange(filter, h.currentTime())
	where, args := usageWhere(filter)
	totals, err := h.queryTotals(where, args)
	if err != nil {
		return UsageOverview{}, err
	}
	filters, err := h.filterOptions()
	if err != nil {
		return UsageOverview{}, err
	}

	duration := filter.Until.Sub(filter.Since)
	step := time.Hour
	granularity := "hour"
	if duration > 48*time.Hour {
		step = 24 * time.Hour
		granularity = "day"
	}
	from := truncateBucket(filter.Since, step)
	points := make(map[int64]UsageTrendPoint)
	for bucket := from; bucket.Before(filter.Until); bucket = bucket.Add(step) {
		points[bucket.UnixNano()] = UsageTrendPoint{Bucket: bucket}
	}
	stepNanoseconds := step.Nanoseconds()
	queryArgs := append([]any{stepNanoseconds, stepNanoseconds}, args...)
	rows, err := h.db.Query(`
		SELECT (timestamp_ns / ?) * ?, `+usageAggregateColumns+`
		FROM usage_events`+where+`
		GROUP BY 1 ORDER BY 1`, queryArgs...)
	if err != nil {
		return UsageOverview{}, fmt.Errorf("query usage trend: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var bucket int64
		var point UsageTrendPoint
		if err := scanUsageAggregate(rows, &bucket, &point.RequestCount, &point.SuccessCount, &point.FailureCount, &point.InputTokens, &point.OutputTokens, &point.ReasoningTokens, &point.CachedTokens, &point.CacheReadTokens, &point.CacheCreationTokens, &point.TotalTokens, &point.CostUSD); err != nil {
			return UsageOverview{}, fmt.Errorf("scan usage trend: %w", err)
		}
		point.Bucket = time.Unix(0, bucket).UTC()
		points[bucket] = point
	}
	if err := rows.Err(); err != nil {
		return UsageOverview{}, fmt.Errorf("iterate usage trend: %w", err)
	}
	series := make([]UsageTrendPoint, 0, len(points))
	for bucket := from; bucket.Before(filter.Until); bucket = bucket.Add(step) {
		series = append(series, points[bucket.UnixNano()])
	}
	return UsageOverview{
		From: filter.Since, To: filter.Until, Granularity: granularity,
		Totals: totals, Series: series, Filters: filters,
	}, nil
}

func (h *stateDatabase) analysis(filter UsageHistoryFilter) (UsageAnalysis, error) {
	filter = normalizeHistoryRange(filter, h.currentTime())
	where, args := usageWhere(filter)
	totals, err := h.queryTotals(where, args)
	if err != nil {
		return UsageAnalysis{}, err
	}
	filters, err := h.filterOptions()
	if err != nil {
		return UsageAnalysis{}, err
	}
	byModel, err := h.queryBreakdown(`COALESCE(NULLIF(TRIM(model), ''), 'unknown')`, where, args)
	if err != nil {
		return UsageAnalysis{}, err
	}
	byKey, err := h.queryBreakdown(`COALESCE(NULLIF(TRIM(key_id), ''), 'unknown')`, where, args)
	if err != nil {
		return UsageAnalysis{}, err
	}
	byProvider, err := h.queryBreakdown(`COALESCE(NULLIF(TRIM(provider), ''), 'unknown')`, where, args)
	if err != nil {
		return UsageAnalysis{}, err
	}
	return UsageAnalysis{
		From: filter.Since, To: filter.Until, Totals: totals,
		ByModel: byModel, ByKey: byKey, ByProvider: byProvider, Filters: filters,
	}, nil
}

func (h *stateDatabase) queryTotals(where string, args []any) (UsageTotals, error) {
	var total UsageTotals
	if err := scanUsageAggregate(h.db.QueryRow(`SELECT `+usageAggregateColumns+` FROM usage_events`+where, args...),
		&total.RequestCount, &total.SuccessCount, &total.FailureCount,
		&total.InputTokens, &total.OutputTokens, &total.ReasoningTokens,
		&total.CachedTokens, &total.CacheReadTokens, &total.CacheCreationTokens,
		&total.TotalTokens, &total.CostUSD,
	); err != nil {
		return UsageTotals{}, fmt.Errorf("query usage totals: %w", err)
	}
	return total, nil
}

func scanUsageAggregate(scanner rowScanner, targets ...any) error {
	return scanner.Scan(targets...)
}

func (h *stateDatabase) queryBreakdown(expression, where string, args []any) ([]UsageBreakdown, error) {
	rows, err := h.db.Query(`SELECT `+expression+` AS name, `+usageAggregateColumns+`
		FROM usage_events`+where+` GROUP BY name ORDER BY 2 DESC, name`, args...)
	if err != nil {
		return nil, fmt.Errorf("query usage breakdown: %w", err)
	}
	defer rows.Close()
	result := make([]UsageBreakdown, 0)
	for rows.Next() {
		var row UsageBreakdown
		if err := scanUsageAggregate(rows, &row.Name, &row.RequestCount, &row.SuccessCount, &row.FailureCount, &row.InputTokens, &row.OutputTokens, &row.ReasoningTokens, &row.CachedTokens, &row.CacheReadTokens, &row.CacheCreationTokens, &row.TotalTokens, &row.CostUSD); err != nil {
			return nil, fmt.Errorf("scan usage breakdown: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate usage breakdown: %w", err)
	}
	return result, nil
}

func (h *stateDatabase) filterOptions() (UsageFilters, error) {
	keys, err := h.distinctValues("key_id")
	if err != nil {
		return UsageFilters{}, err
	}
	providers, err := h.distinctValues("provider")
	if err != nil {
		return UsageFilters{}, err
	}
	models, err := h.distinctValues("model")
	if err != nil {
		return UsageFilters{}, err
	}
	return UsageFilters{KeyIDs: keys, Providers: providers, Models: models}, nil
}

func (h *stateDatabase) distinctValues(column string) ([]string, error) {
	rows, err := h.db.Query(`SELECT DISTINCT ` + column + ` FROM usage_events WHERE TRIM(` + column + `) != '' ORDER BY ` + column + ` COLLATE NOCASE`)
	if err != nil {
		return nil, fmt.Errorf("query usage filter %s: %w", column, err)
	}
	defer rows.Close()
	result := make([]string, 0)
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, fmt.Errorf("scan usage filter %s: %w", column, err)
		}
		result = append(result, value)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate usage filter %s: %w", column, err)
	}
	return result, nil
}

func usageWhere(filter UsageHistoryFilter) (string, []any) {
	conditions := make([]string, 0, 6)
	args := make([]any, 0, 7)
	if !filter.Since.IsZero() {
		conditions = append(conditions, "timestamp_ns >= ?")
		args = append(args, filter.Since.UTC().UnixNano())
	}
	if !filter.Until.IsZero() {
		conditions = append(conditions, "timestamp_ns < ?")
		args = append(args, filter.Until.UTC().UnixNano())
	}
	if value := strings.TrimSpace(filter.KeyID); value != "" {
		conditions = append(conditions, "key_id = ? COLLATE NOCASE")
		args = append(args, value)
	}
	if value := strings.TrimSpace(filter.Provider); value != "" {
		conditions = append(conditions, "provider = ? COLLATE NOCASE")
		args = append(args, value)
	}
	if value := strings.TrimSpace(filter.Model); value != "" {
		conditions = append(conditions, "(model = ? COLLATE NOCASE OR upstream_model = ? COLLATE NOCASE)")
		args = append(args, value, value)
	}
	if filter.Failed != nil {
		conditions = append(conditions, "failed = ?")
		args = append(args, boolInt(*filter.Failed))
	}
	if len(conditions) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(conditions, " AND "), args
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

func truncateBucket(value time.Time, step time.Duration) time.Time {
	value = value.UTC()
	if step >= 24*time.Hour {
		return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
	}
	return value.Truncate(step)
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
