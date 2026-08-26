package policy

import (
	"database/sql"
	"fmt"
	"math"
	"strings"
	"time"
)

// UsageEvent is the request history used by the Keyer dashboard. KeyID is the
// policy identity delivered by CPA; KeyPreview contains only a masked suffix.
type UsageEvent struct {
	ID                   int64     `json:"id"`
	Timestamp            time.Time `json:"timestamp"`
	KeyID                string    `json:"key_id"`
	KeyPreview           string    `json:"key_preview,omitempty"`
	Provider             string    `json:"provider,omitempty"`
	Model                string    `json:"model"`
	UpstreamModel        string    `json:"upstream_model,omitempty"`
	ReasoningEffort      string    `json:"reasoning_effort,omitempty"`
	ExecutorType         string    `json:"executor_type,omitempty"`
	AuthType             string    `json:"auth_type,omitempty"`
	AuthIndex            string    `json:"auth_index,omitempty"`
	Source               string    `json:"source,omitempty"`
	ServiceTier          string    `json:"service_tier,omitempty"`
	Generate             bool      `json:"generate"`
	LatencyMS            int64     `json:"latency_ms"`
	TTFTMS               *int64    `json:"ttft_ms,omitempty"`
	StatusCode           int       `json:"status_code,omitempty"`
	Failed               bool      `json:"failed"`
	BillingMode          string    `json:"billing_mode,omitempty"`
	CostAvailable        bool      `json:"cost_available"`
	CostUSD              float64   `json:"cost_usd"`
	UncachedInputCostUSD float64   `json:"uncached_input_cost_usd"`
	CacheReadCostUSD     float64   `json:"cache_read_cost_usd"`
	CacheCreationCostUSD float64   `json:"cache_creation_cost_usd"`
	OutputCostUSD        float64   `json:"output_cost_usd"`
	OtherCostUSD         float64   `json:"other_cost_usd"`
	InputTokens          int64     `json:"input_tokens"`
	OutputTokens         int64     `json:"output_tokens"`
	ReasoningTokens      int64     `json:"reasoning_tokens,omitempty"`
	CachedTokens         int64     `json:"cached_tokens,omitempty"`
	CacheReadTokens      int64     `json:"cache_read_tokens,omitempty"`
	CacheCreationTokens  int64     `json:"cache_creation_tokens,omitempty"`
	TotalTokens          int64     `json:"total_tokens"`
}

// UsageHistoryState is decode-only migration input from the legacy JSON state
// schema v3. The current runtime stores request events directly in SQLite.
type UsageHistoryState struct {
	NextID int64        `json:"next_id,omitempty"`
	Events []UsageEvent `json:"events,omitempty"`
}

type UsageHistoryFilter struct {
	Since        time.Time
	Until        time.Time
	KeyID        string
	Provider     string
	Model        string
	ExecutorType string
	AuthType     string
	Source       string
	ServiceTier  string
	StatusCode   *int
	Failed       *bool
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
	KeyIDs        []string `json:"key_ids"`
	Providers     []string `json:"providers"`
	Models        []string `json:"models"`
	ExecutorTypes []string `json:"executor_types"`
	AuthTypes     []string `json:"auth_types"`
	Sources       []string `json:"sources"`
	ServiceTiers  []string `json:"service_tiers"`
	StatusCodes   []int    `json:"status_codes"`
}

type UsageTotals struct {
	RequestCount         int64   `json:"request_count"`
	SuccessCount         int64   `json:"success_count"`
	FailureCount         int64   `json:"failure_count"`
	InputTokens          int64   `json:"input_tokens"`
	OutputTokens         int64   `json:"output_tokens"`
	ReasoningTokens      int64   `json:"reasoning_tokens"`
	CachedTokens         int64   `json:"cached_tokens"`
	CacheReadTokens      int64   `json:"cache_read_tokens"`
	CacheCreationTokens  int64   `json:"cache_creation_tokens"`
	TotalTokens          int64   `json:"total_tokens"`
	CostUSD              float64 `json:"cost_usd"`
	UncachedInputCostUSD float64 `json:"uncached_input_cost_usd"`
	CacheReadCostUSD     float64 `json:"cache_read_cost_usd"`
	CacheCreationCostUSD float64 `json:"cache_creation_cost_usd"`
	OutputCostUSD        float64 `json:"output_cost_usd"`
	OtherCostUSD         float64 `json:"other_cost_usd"`
}

type UsageTrendPoint struct {
	Bucket               time.Time `json:"bucket"`
	RequestCount         int64     `json:"request_count"`
	SuccessCount         int64     `json:"success_count"`
	FailureCount         int64     `json:"failure_count"`
	InputTokens          int64     `json:"input_tokens"`
	OutputTokens         int64     `json:"output_tokens"`
	ReasoningTokens      int64     `json:"reasoning_tokens"`
	CachedTokens         int64     `json:"cached_tokens"`
	CacheReadTokens      int64     `json:"cache_read_tokens"`
	CacheCreationTokens  int64     `json:"cache_creation_tokens"`
	TotalTokens          int64     `json:"total_tokens"`
	CostUSD              float64   `json:"cost_usd"`
	UncachedInputCostUSD float64   `json:"uncached_input_cost_usd"`
	CacheReadCostUSD     float64   `json:"cache_read_cost_usd"`
	CacheCreationCostUSD float64   `json:"cache_creation_cost_usd"`
	OutputCostUSD        float64   `json:"output_cost_usd"`
	OtherCostUSD         float64   `json:"other_cost_usd"`
	AverageLatencyMS     *float64  `json:"average_latency_ms,omitempty"`
	AverageTTFTMS        *float64  `json:"average_ttft_ms,omitempty"`
}

type UsagePerformance struct {
	LatencySamples   int64   `json:"latency_samples"`
	AverageLatencyMS float64 `json:"average_latency_ms"`
	P50LatencyMS     int64   `json:"p50_latency_ms"`
	P95LatencyMS     int64   `json:"p95_latency_ms"`
	MaxLatencyMS     int64   `json:"max_latency_ms"`
	TTFTSamples      int64   `json:"ttft_samples"`
	AverageTTFTMS    float64 `json:"average_ttft_ms"`
	P50TTFTMS        int64   `json:"p50_ttft_ms"`
	P95TTFTMS        int64   `json:"p95_ttft_ms"`
	MaxTTFTMS        int64   `json:"max_ttft_ms"`
}

type UsageOverview struct {
	From        time.Time         `json:"from"`
	To          time.Time         `json:"to"`
	Granularity string            `json:"granularity"`
	Totals      UsageTotals       `json:"totals"`
	Series      []UsageTrendPoint `json:"series"`
	Performance UsagePerformance  `json:"performance"`
	Filters     UsageFilters      `json:"filters"`
}

type UsageBreakdown struct {
	Name                 string  `json:"name"`
	RequestCount         int64   `json:"request_count"`
	SuccessCount         int64   `json:"success_count"`
	FailureCount         int64   `json:"failure_count"`
	InputTokens          int64   `json:"input_tokens"`
	OutputTokens         int64   `json:"output_tokens"`
	ReasoningTokens      int64   `json:"reasoning_tokens"`
	CachedTokens         int64   `json:"cached_tokens"`
	CacheReadTokens      int64   `json:"cache_read_tokens"`
	CacheCreationTokens  int64   `json:"cache_creation_tokens"`
	TotalTokens          int64   `json:"total_tokens"`
	CostUSD              float64 `json:"cost_usd"`
	UncachedInputCostUSD float64 `json:"uncached_input_cost_usd"`
	CacheReadCostUSD     float64 `json:"cache_read_cost_usd"`
	CacheCreationCostUSD float64 `json:"cache_creation_cost_usd"`
	OutputCostUSD        float64 `json:"output_cost_usd"`
	OtherCostUSD         float64 `json:"other_cost_usd"`
}

type UsageHeatmapCell struct {
	KeyID        string  `json:"key_id"`
	Model        string  `json:"model"`
	RequestCount int64   `json:"request_count"`
	TotalTokens  int64   `json:"total_tokens"`
	CostUSD      float64 `json:"cost_usd"`
}

type UsageLatencyPoint struct {
	TTFTMS    int64 `json:"ttft_ms"`
	LatencyMS int64 `json:"latency_ms"`
}

type UsageAnalysis struct {
	From          time.Time           `json:"from"`
	To            time.Time           `json:"to"`
	Totals        UsageTotals         `json:"totals"`
	ByModel       []UsageBreakdown    `json:"by_model"`
	ByKey         []UsageBreakdown    `json:"by_key"`
	ByProvider    []UsageBreakdown    `json:"by_provider"`
	ByExecutor    []UsageBreakdown    `json:"by_executor"`
	ByAuthType    []UsageBreakdown    `json:"by_auth_type"`
	BySource      []UsageBreakdown    `json:"by_source"`
	ByServiceTier []UsageBreakdown    `json:"by_service_tier"`
	Heatmap       []UsageHeatmapCell  `json:"heatmap"`
	LatencyPoints []UsageLatencyPoint `json:"latency_points"`
	Filters       UsageFilters        `json:"filters"`
}

const usageEventColumns = `
	id, timestamp_ns, key_id, key_preview, provider, model, upstream_model,
	reasoning_effort, executor_type, auth_type, auth_index, source, service_tier,
	generate, latency_ms, ttft_ms, status_code, failed, billing_mode,
	cost_available, cost_usd, uncached_input_cost_usd, cache_read_cost_usd,
	cache_creation_cost_usd, output_cost_usd, other_cost_usd, input_tokens,
	output_tokens, reasoning_tokens, cached_tokens, cache_read_tokens,
	cache_creation_tokens, total_tokens`

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
	COALESCE(SUM(cost_usd), 0),
	COALESCE(SUM(uncached_input_cost_usd), 0),
	COALESCE(SUM(cache_read_cost_usd), 0),
	COALESCE(SUM(cache_creation_cost_usd), 0),
	COALESCE(SUM(output_cost_usd), 0),
	COALESCE(SUM(other_cost_usd), 0)`

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
	var failed, costAvailable, generate int
	var ttft sql.NullInt64
	if err := row.Scan(
		&event.ID, &timestamp, &event.KeyID, &event.KeyPreview, &event.Provider,
		&event.Model, &event.UpstreamModel, &event.ReasoningEffort,
		&event.ExecutorType, &event.AuthType, &event.AuthIndex, &event.Source,
		&event.ServiceTier, &generate, &event.LatencyMS, &ttft, &event.StatusCode,
		&failed, &event.BillingMode, &costAvailable, &event.CostUSD,
		&event.UncachedInputCostUSD, &event.CacheReadCostUSD,
		&event.CacheCreationCostUSD, &event.OutputCostUSD, &event.OtherCostUSD,
		&event.InputTokens, &event.OutputTokens, &event.ReasoningTokens,
		&event.CachedTokens, &event.CacheReadTokens, &event.CacheCreationTokens,
		&event.TotalTokens,
	); err != nil {
		return UsageEvent{}, fmt.Errorf("scan usage event: %w", err)
	}
	event.Timestamp = time.Unix(0, timestamp).UTC()
	event.Generate = generate != 0
	if ttft.Valid {
		value := ttft.Int64
		event.TTFTMS = &value
	}
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
	performance, err := h.queryPerformance(where, args)
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
		SELECT (timestamp_ns / ?) * ?, `+usageAggregateColumns+`,
			AVG(CASE WHEN failed = 0 AND generate != 0 AND latency_ms > 0 THEN latency_ms END),
			AVG(CASE WHEN failed = 0 AND generate != 0 AND ttft_ms > 0 THEN ttft_ms END)
		FROM usage_events`+where+`
		GROUP BY 1 ORDER BY 1`, queryArgs...)
	if err != nil {
		return UsageOverview{}, fmt.Errorf("query usage trend: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var bucket int64
		var point UsageTrendPoint
		var averageLatency, averageTTFT sql.NullFloat64
		if err := scanUsageAggregate(rows, &bucket, &point.RequestCount, &point.SuccessCount, &point.FailureCount, &point.InputTokens, &point.OutputTokens, &point.ReasoningTokens, &point.CachedTokens, &point.CacheReadTokens, &point.CacheCreationTokens, &point.TotalTokens, &point.CostUSD, &point.UncachedInputCostUSD, &point.CacheReadCostUSD, &point.CacheCreationCostUSD, &point.OutputCostUSD, &point.OtherCostUSD, &averageLatency, &averageTTFT); err != nil {
			return UsageOverview{}, fmt.Errorf("scan usage trend: %w", err)
		}
		point.Bucket = time.Unix(0, bucket).UTC()
		if averageLatency.Valid {
			value := averageLatency.Float64
			point.AverageLatencyMS = &value
		}
		if averageTTFT.Valid {
			value := averageTTFT.Float64
			point.AverageTTFTMS = &value
		}
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
		Totals: totals, Series: series, Performance: performance, Filters: filters,
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
	byExecutor, err := h.queryBreakdown(`COALESCE(NULLIF(TRIM(executor_type), ''), 'unknown')`, where, args)
	if err != nil {
		return UsageAnalysis{}, err
	}
	byAuthType, err := h.queryBreakdown(`COALESCE(NULLIF(TRIM(auth_type), ''), 'unknown')`, where, args)
	if err != nil {
		return UsageAnalysis{}, err
	}
	bySource, err := h.queryBreakdown(`COALESCE(NULLIF(TRIM(source), ''), 'unknown')`, where, args)
	if err != nil {
		return UsageAnalysis{}, err
	}
	byServiceTier, err := h.queryBreakdown(`COALESCE(NULLIF(TRIM(service_tier), ''), 'unknown')`, where, args)
	if err != nil {
		return UsageAnalysis{}, err
	}
	heatmap, err := h.queryHeatmap(where, args)
	if err != nil {
		return UsageAnalysis{}, err
	}
	latencyPoints, err := h.queryLatencyPoints(where, args)
	if err != nil {
		return UsageAnalysis{}, err
	}
	return UsageAnalysis{
		From: filter.Since, To: filter.Until, Totals: totals,
		ByModel: byModel, ByKey: byKey, ByProvider: byProvider,
		ByExecutor: byExecutor, ByAuthType: byAuthType, BySource: bySource,
		ByServiceTier: byServiceTier, Heatmap: heatmap,
		LatencyPoints: latencyPoints, Filters: filters,
	}, nil
}

func (h *stateDatabase) queryTotals(where string, args []any) (UsageTotals, error) {
	var total UsageTotals
	if err := scanUsageAggregate(h.db.QueryRow(`SELECT `+usageAggregateColumns+` FROM usage_events`+where, args...),
		&total.RequestCount, &total.SuccessCount, &total.FailureCount,
		&total.InputTokens, &total.OutputTokens, &total.ReasoningTokens,
		&total.CachedTokens, &total.CacheReadTokens, &total.CacheCreationTokens,
		&total.TotalTokens, &total.CostUSD, &total.UncachedInputCostUSD,
		&total.CacheReadCostUSD, &total.CacheCreationCostUSD,
		&total.OutputCostUSD, &total.OtherCostUSD,
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
		if err := scanUsageAggregate(rows, &row.Name, &row.RequestCount, &row.SuccessCount, &row.FailureCount, &row.InputTokens, &row.OutputTokens, &row.ReasoningTokens, &row.CachedTokens, &row.CacheReadTokens, &row.CacheCreationTokens, &row.TotalTokens, &row.CostUSD, &row.UncachedInputCostUSD, &row.CacheReadCostUSD, &row.CacheCreationCostUSD, &row.OutputCostUSD, &row.OtherCostUSD); err != nil {
			return nil, fmt.Errorf("scan usage breakdown: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate usage breakdown: %w", err)
	}
	return result, nil
}

func (h *stateDatabase) queryHeatmap(where string, args []any) ([]UsageHeatmapCell, error) {
	rows, err := h.db.Query(`
		SELECT COALESCE(NULLIF(TRIM(key_id), ''), 'unknown'),
			COALESCE(NULLIF(TRIM(model), ''), 'unknown'), COUNT(*),
			COALESCE(SUM(total_tokens), 0), COALESCE(SUM(cost_usd), 0)
		FROM usage_events`+where+`
		GROUP BY 1, 2 ORDER BY 4 DESC, 1, 2 LIMIT 256`, args...)
	if err != nil {
		return nil, fmt.Errorf("query usage heatmap: %w", err)
	}
	defer rows.Close()
	result := make([]UsageHeatmapCell, 0)
	for rows.Next() {
		var cell UsageHeatmapCell
		if err := rows.Scan(&cell.KeyID, &cell.Model, &cell.RequestCount, &cell.TotalTokens, &cell.CostUSD); err != nil {
			return nil, fmt.Errorf("scan usage heatmap: %w", err)
		}
		result = append(result, cell)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate usage heatmap: %w", err)
	}
	return result, nil
}

func (h *stateDatabase) queryLatencyPoints(where string, args []any) ([]UsageLatencyPoint, error) {
	scoped := appendUsageCondition(where, "failed = 0 AND generate != 0 AND ttft_ms > 0 AND latency_ms >= ttft_ms")
	queryArgs := append(append([]any(nil), args...), 600)
	rows, err := h.db.Query(`SELECT ttft_ms, latency_ms FROM usage_events`+scoped+` ORDER BY timestamp_ns DESC LIMIT ?`, queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("query latency points: %w", err)
	}
	defer rows.Close()
	result := make([]UsageLatencyPoint, 0)
	for rows.Next() {
		var point UsageLatencyPoint
		if err := rows.Scan(&point.TTFTMS, &point.LatencyMS); err != nil {
			return nil, fmt.Errorf("scan latency point: %w", err)
		}
		result = append(result, point)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate latency points: %w", err)
	}
	return result, nil
}

type latencyMetricSummary struct {
	samples int64
	average float64
	p50     int64
	p95     int64
	maximum int64
}

func (h *stateDatabase) queryPerformance(where string, args []any) (UsagePerformance, error) {
	latency, err := h.queryLatencyMetric("latency_ms", where, args)
	if err != nil {
		return UsagePerformance{}, err
	}
	ttft, err := h.queryLatencyMetric("ttft_ms", where, args)
	if err != nil {
		return UsagePerformance{}, err
	}
	return UsagePerformance{
		LatencySamples: latency.samples, AverageLatencyMS: latency.average,
		P50LatencyMS: latency.p50, P95LatencyMS: latency.p95, MaxLatencyMS: latency.maximum,
		TTFTSamples: ttft.samples, AverageTTFTMS: ttft.average,
		P50TTFTMS: ttft.p50, P95TTFTMS: ttft.p95, MaxTTFTMS: ttft.maximum,
	}, nil
}

func (h *stateDatabase) queryLatencyMetric(column, where string, args []any) (latencyMetricSummary, error) {
	scoped := appendUsageCondition(where, column+" > 0 AND failed = 0 AND generate != 0")
	var result latencyMetricSummary
	if err := h.db.QueryRow(`SELECT COUNT(*), COALESCE(AVG(`+column+`), 0), COALESCE(MAX(`+column+`), 0) FROM usage_events`+scoped, args...).Scan(&result.samples, &result.average, &result.maximum); err != nil {
		return latencyMetricSummary{}, fmt.Errorf("query %s summary: %w", column, err)
	}
	if result.samples == 0 {
		return result, nil
	}
	percentile := func(value float64) (int64, error) {
		offset := int64(math.Ceil(float64(result.samples)*value)) - 1
		queryArgs := append(append([]any(nil), args...), offset)
		var measured int64
		if err := h.db.QueryRow(`SELECT `+column+` FROM usage_events`+scoped+` ORDER BY `+column+` LIMIT 1 OFFSET ?`, queryArgs...).Scan(&measured); err != nil {
			return 0, err
		}
		return measured, nil
	}
	p50, err := percentile(0.50)
	if err != nil {
		return latencyMetricSummary{}, fmt.Errorf("query %s p50: %w", column, err)
	}
	result.p50 = p50
	p95, err := percentile(0.95)
	if err != nil {
		return latencyMetricSummary{}, fmt.Errorf("query %s p95: %w", column, err)
	}
	result.p95 = p95
	return result, nil
}

func appendUsageCondition(where, condition string) string {
	if strings.TrimSpace(where) == "" {
		return " WHERE " + condition
	}
	return where + " AND " + condition
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
	executors, err := h.distinctValues("executor_type")
	if err != nil {
		return UsageFilters{}, err
	}
	authTypes, err := h.distinctValues("auth_type")
	if err != nil {
		return UsageFilters{}, err
	}
	sources, err := h.distinctValues("source")
	if err != nil {
		return UsageFilters{}, err
	}
	serviceTiers, err := h.distinctValues("service_tier")
	if err != nil {
		return UsageFilters{}, err
	}
	statusCodes, err := h.distinctStatusCodes()
	if err != nil {
		return UsageFilters{}, err
	}
	return UsageFilters{
		KeyIDs: keys, Providers: providers, Models: models,
		ExecutorTypes: executors, AuthTypes: authTypes, Sources: sources,
		ServiceTiers: serviceTiers, StatusCodes: statusCodes,
	}, nil
}

func (h *stateDatabase) distinctStatusCodes() ([]int, error) {
	rows, err := h.db.Query(`SELECT DISTINCT status_code FROM usage_events WHERE status_code > 0 ORDER BY status_code`)
	if err != nil {
		return nil, fmt.Errorf("query usage status filters: %w", err)
	}
	defer rows.Close()
	result := make([]int, 0)
	for rows.Next() {
		var value int
		if err := rows.Scan(&value); err != nil {
			return nil, fmt.Errorf("scan usage status filter: %w", err)
		}
		result = append(result, value)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate usage status filters: %w", err)
	}
	return result, nil
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
	conditions := make([]string, 0, 12)
	args := make([]any, 0, 13)
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
	if value := strings.TrimSpace(filter.ExecutorType); value != "" {
		conditions = append(conditions, "executor_type = ? COLLATE NOCASE")
		args = append(args, value)
	}
	if value := strings.TrimSpace(filter.AuthType); value != "" {
		conditions = append(conditions, "auth_type = ? COLLATE NOCASE")
		args = append(args, value)
	}
	if value := strings.TrimSpace(filter.Source); value != "" {
		conditions = append(conditions, "source = ? COLLATE NOCASE")
		args = append(args, value)
	}
	if value := strings.TrimSpace(filter.ServiceTier); value != "" {
		conditions = append(conditions, "service_tier = ? COLLATE NOCASE")
		args = append(args, value)
	}
	if filter.StatusCode != nil {
		conditions = append(conditions, "status_code = ?")
		args = append(args, *filter.StatusCode)
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
