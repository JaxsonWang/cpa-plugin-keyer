package policy

import (
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func newHistoryStore(t *testing.T, path string, now *time.Time, preview string) *Store {
	t.Helper()
	store := NewStore()
	store.SetClock(func() time.Time { return *now })
	if err := store.Configure(Config{
		Enabled: true, StateFile: path,
		Keys: []KeyConfig{{
			ID: "team-a", Name: "Team A", Enabled: true,
			KeyHash:    hashForUsageTest(t, "cpa_history_secret"),
			KeyPreview: preview,
			Models: []ModelRule{{
				Model: "gpt-5.4", BillingMode: "tokens",
				InputPricePerMillion: 2, OutputPricePerMillion: 8,
				CacheReadPricePerMillion: 0.2,
			}},
		}},
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func mustUsageEvents(t *testing.T, store *Store, filter UsageHistoryFilter, page, pageSize int) UsageEventPage {
	t.Helper()
	result, err := store.UsageEvents(filter, page, pageSize)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func mustUsageOverview(t *testing.T, store *Store, filter UsageHistoryFilter) UsageOverview {
	t.Helper()
	result, err := store.UsageOverview(filter)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func mustUsageAnalysis(t *testing.T, store *Store, filter UsageHistoryFilter) UsageAnalysis {
	t.Helper()
	result, err := store.UsageAnalysis(filter)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestStateDatabaseCreatesSchemaAndIndexes(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "keyer-state.db")
	store := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(raw, []byte("SQLite format 3\x00")) {
		t.Fatalf("state file is not SQLite: %q", raw[:min(len(raw), 16)])
	}
	if store.Status()["storage"] != "sqlite" || store.Status()["state_file"] != path {
		t.Fatalf("status = %+v", store.Status())
	}
	database := store.runtimeHistory()
	for _, table := range []string{"state_meta", "key_configs", "usage_state", "usage_events"} {
		var count int
		if err := database.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("table %q count = %d", table, count)
		}
	}
	for _, index := range []string{
		"usage_events_timestamp_idx", "usage_events_key_time_idx",
		"usage_events_model_time_idx", "usage_events_provider_time_idx",
		"usage_events_executor_time_idx", "usage_events_auth_type_time_idx",
		"usage_events_source_time_idx", "usage_events_service_tier_time_idx",
		"usage_events_status_time_idx",
	} {
		var count int
		if err := database.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?`, index).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("index %q count = %d", index, count)
		}
	}
}

func TestUsageHistoryPersistsRuntimeDetailsRequestedTimeAndCostComponents(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "state.db")
	store := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))
	requestedAt := now.Add(-37 * time.Second)
	generate := true
	cost := store.RecordUsage("team-a", "gpt-5.4", "gpt-5.4-2026", false, UsageDetail{
		Provider: "codex", ExecutorType: "codex", AuthType: "apikey", AuthIndex: "3",
		Source: "openai-responses", ReasoningEffort: "high", ServiceTier: "priority",
		Generate: &generate, RequestedAt: requestedAt, Latency: 2400 * time.Millisecond,
		TTFT: 425 * time.Millisecond, FailureStatusCode: 200,
		InputTokens: 1_000, OutputTokens: 200, CachedTokens: 250,
		CacheReadTokens: 250, CacheCreationTokens: 10, TotalTokens: 1_200,
	})
	if !nearly(cost, 0.00315) {
		t.Fatalf("cost = %v, want 0.00315", cost)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	database, err := openStateDatabase(path, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	defer database.close()
	events, err := database.allUsageEvents()
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("events = %+v", events)
	}
	event := events[0]
	if !event.Timestamp.Equal(requestedAt) || event.ExecutorType != "codex" ||
		event.AuthType != "apikey" || event.AuthIndex != "3" || event.Source != "openai-responses" ||
		event.ReasoningEffort != "high" || event.ServiceTier != "priority" || !event.Generate ||
		event.LatencyMS != 2_400 || event.TTFTMS == nil || *event.TTFTMS != 425 || event.StatusCode != 200 {
		t.Fatalf("persisted runtime details = %+v", event)
	}
	componentTotal := event.UncachedInputCostUSD + event.CacheReadCostUSD +
		event.CacheCreationCostUSD + event.OutputCostUSD + event.OtherCostUSD
	if !nearly(event.UncachedInputCostUSD, 0.0015) || !nearly(event.CacheReadCostUSD, 0.00005) ||
		event.CacheCreationCostUSD != 0 || !nearly(event.OutputCostUSD, 0.0016) ||
		!nearly(componentTotal, event.CostUSD) {
		t.Fatalf("persisted cost components = %+v, sum=%v", event, componentTotal)
	}
}

func TestUsageHistoryPerformanceHeatmapDimensionsAndRuntimeFilters(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	database, err := openStateDatabase(filepath.Join(t.TempDir(), "state.db"), func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	defer database.close()

	latencies := []int64{100, 200, 300, 400, 1_000}
	ttfts := []int64{50, 100, 150, 200, 500}
	for index := range latencies {
		ttft := ttfts[index]
		if err := database.record(UsageEvent{
			Timestamp: now.Add(time.Duration(index) * time.Second), KeyID: "team-a",
			Provider: "openai", Model: "gpt-5.4", ExecutorType: "codex",
			AuthType: "apikey", Source: "openai-responses", ServiceTier: "priority",
			Generate: true, LatencyMS: latencies[index], TTFTMS: &ttft, StatusCode: 200,
			InputTokens: 100, OutputTokens: 20, TotalTokens: 120,
		}); err != nil {
			t.Fatal(err)
		}
	}
	ttft := int64(900)
	for _, event := range []UsageEvent{
		{Timestamp: now.Add(10 * time.Second), KeyID: "team-b", Provider: "anthropic", Model: "claude",
			ExecutorType: "claude", AuthType: "oauth", Source: "anthropic-messages", ServiceTier: "standard",
			Generate: true, Failed: true, LatencyMS: 2_000, TTFTMS: &ttft, StatusCode: 500},
		{Timestamp: now.Add(11 * time.Second), KeyID: "team-b", Provider: "anthropic", Model: "claude",
			ExecutorType: "claude", AuthType: "oauth", Source: "anthropic-messages", ServiceTier: "standard",
			Generate: false, LatencyMS: 3_000, TTFTMS: &ttft, StatusCode: 204},
		{Timestamp: now.Add(12 * time.Second), KeyID: "team-b", Provider: "anthropic", Model: "claude",
			ExecutorType: "claude", AuthType: "oauth", Source: "anthropic-messages", ServiceTier: "standard",
			Generate: true, LatencyMS: 0, StatusCode: 200},
	} {
		if err := database.record(event); err != nil {
			t.Fatal(err)
		}
	}

	filter := UsageHistoryFilter{Since: now.Add(-time.Minute), Until: now.Add(time.Minute)}
	overview, err := database.overview(filter)
	if err != nil {
		t.Fatal(err)
	}
	performance := overview.Performance
	if performance.LatencySamples != 5 || performance.AverageLatencyMS != 400 ||
		performance.P50LatencyMS != 300 || performance.P95LatencyMS != 1_000 || performance.MaxLatencyMS != 1_000 ||
		performance.TTFTSamples != 5 || performance.AverageTTFTMS != 200 ||
		performance.P50TTFTMS != 150 || performance.P95TTFTMS != 500 || performance.MaxTTFTMS != 500 {
		t.Fatalf("performance = %+v", performance)
	}
	analysis, err := database.analysis(filter)
	if err != nil {
		t.Fatal(err)
	}
	if len(analysis.Heatmap) != 2 || analysis.Heatmap[0].KeyID != "team-a" || len(analysis.LatencyPoints) != 5 {
		t.Fatalf("analysis heatmap/latency = heatmap=%+v latency=%+v", analysis.Heatmap, analysis.LatencyPoints)
	}
	if len(analysis.ByExecutor) != 2 || analysis.ByExecutor[0].Name != "codex" ||
		len(analysis.ByAuthType) != 2 || len(analysis.BySource) != 2 || len(analysis.ByServiceTier) != 2 {
		t.Fatalf("runtime dimensions = %+v %+v %+v %+v", analysis.ByExecutor, analysis.ByAuthType, analysis.BySource, analysis.ByServiceTier)
	}
	status := 500
	page, err := database.eventPage(UsageHistoryFilter{
		Since: now.Add(-time.Minute), Until: now.Add(time.Minute), ExecutorType: "CLAUDE",
		AuthType: "OAUTH", Source: "ANTHROPIC-MESSAGES", ServiceTier: "STANDARD", StatusCode: &status,
	}, 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Events) != 1 || !page.Events[0].Failed || page.Events[0].StatusCode != 500 {
		t.Fatalf("runtime filtered events = %+v", page)
	}
}

func TestLegacyJSONStateRemainsReadOnlyMigrationInput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy-state.json")
	original := []byte(`{"version":3,"keys":[],"usage":{},"history":{"next_id":1,"events":[]},"updated_at":"2026-08-26T10:00:00Z"}`)
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := LoadState(path)
	if err != nil {
		t.Fatal(err)
	}
	if state.Version != 3 || state.History.NextID != 1 {
		t.Fatalf("legacy migration input = %+v", state)
	}

	store := NewStore()
	if err := store.Configure(Config{Enabled: true, StateFile: path}); err == nil {
		t.Fatal("Configure accepted a legacy JSON file as SQLite")
	}
	current, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(current, original) {
		t.Fatalf("legacy JSON was modified: %q", current)
	}
}

func TestUsageHistoryRecordsMaskedKeySourceWithoutRawCredential(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	store := newHistoryStore(t, filepath.Join(t.TempDir(), "state.db"), &now, PreviewKey("cpa_history_secret"))
	cost := store.RecordUsage("cpa_history_secret", "gpt-5.4", "gpt-5.4-2026-08-01", false, UsageDetail{
		Provider: "codex", InputTokens: 1_000, OutputTokens: 200, TotalTokens: 1_200,
	})
	if cost <= 0 {
		t.Fatalf("cost = %v, want a priced event", cost)
	}
	page := mustUsageEvents(t, store, UsageHistoryFilter{Since: now.Add(-time.Hour), Until: now.Add(time.Hour)}, 1, 50)
	if page.Total != 1 || len(page.Events) != 1 {
		t.Fatalf("event page = %+v, want one event", page)
	}
	event := page.Events[0]
	if event.KeyID != "team-a" || event.KeyPreview != "cpa_*****cret" || event.Provider != "codex" || event.Model != "gpt-5.4" || event.UpstreamModel != "gpt-5.4-2026-08-01" {
		t.Fatalf("event identity = %+v", event)
	}
	if strings.Contains(event.KeyID, "cpa_") || strings.Contains(event.KeyPreview, "history_secret") {
		t.Fatalf("raw downstream credential leaked into event: %+v", event)
	}
}

func TestUsageHistoryIncludesFailedZeroTokenRequests(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	store := newHistoryStore(t, filepath.Join(t.TempDir(), "state.db"), &now, PreviewKey("cpa_history_secret"))
	if cost := store.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", true, UsageDetail{Provider: "codex"}); cost != 0 {
		t.Fatalf("failed zero-token cost = %v, want 0", cost)
	}
	overview := mustUsageOverview(t, store, UsageHistoryFilter{Since: now.Add(-time.Hour), Until: now.Add(time.Hour)})
	if overview.Totals.RequestCount != 1 || overview.Totals.FailureCount != 1 || overview.Totals.SuccessCount != 0 {
		t.Fatalf("failed request totals = %+v", overview.Totals)
	}
}

func TestUsageHistoryOverviewAnalysisPaginationAndFilters(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	store := newHistoryStore(t, filepath.Join(t.TempDir(), "state.db"), &now, PreviewKey("cpa_history_secret"))
	store.RecordUsage("team-a", "gpt-5.4", "gpt-5.4-2026", false, UsageDetail{
		Provider: "codex", InputTokens: 1_000, OutputTokens: 500, CacheReadTokens: 250, TotalTokens: 1_500,
	})
	now = now.Add(2 * time.Hour)
	store.RecordUsage("team-a", "gpt-5.4", "gpt-5.4-2026", false, UsageDetail{
		Provider: "codex", InputTokens: 2_000, OutputTokens: 1_000, TotalTokens: 3_000,
	})
	filter := UsageHistoryFilter{Since: now.Add(-4 * time.Hour), Until: now.Add(time.Hour), KeyID: "TEAM-A", Model: "GPT-5.4-2026"}
	overview := mustUsageOverview(t, store, filter)
	if overview.Granularity != "hour" || overview.Totals.RequestCount != 2 || overview.Totals.TotalTokens != 4_500 {
		t.Fatalf("overview = %+v", overview)
	}
	if len(overview.Series) != 5 {
		t.Fatalf("series buckets = %d, want 5", len(overview.Series))
	}
	var trendInput, trendOutput, trendCache int64
	for _, point := range overview.Series {
		trendInput += point.InputTokens
		trendOutput += point.OutputTokens
		trendCache += point.CacheReadTokens
	}
	if trendInput != 3_000 || trendOutput != 1_500 || trendCache != 250 {
		t.Fatalf("trend token breakdown = input %d output %d cache %d", trendInput, trendOutput, trendCache)
	}
	analysis := mustUsageAnalysis(t, store, filter)
	if len(analysis.ByModel) != 1 || analysis.ByModel[0].Name != "gpt-5.4" || analysis.ByModel[0].RequestCount != 2 {
		t.Fatalf("analysis by model = %+v", analysis.ByModel)
	}
	if len(analysis.Filters.KeyIDs) != 1 || analysis.Filters.KeyIDs[0] != "team-a" || len(analysis.Filters.Providers) != 1 {
		t.Fatalf("filter options = %+v", analysis.Filters)
	}
	page := mustUsageEvents(t, store, UsageHistoryFilter{}, 2, 1)
	if page.Total != 2 || page.TotalPages != 2 || len(page.Events) != 1 || page.Events[0].InputTokens != 1_000 {
		t.Fatalf("second event page = %+v", page)
	}
}

func TestUsageHistoryFiltersStayInsideSelectedKey(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	store := newHistoryStore(t, filepath.Join(t.TempDir(), "state.db"), &now, PreviewKey("cpa_history_secret"))
	secondHash, err := HashKey("cpa_other_secret")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertKey(KeyConfig{
		ID: "team-b", Name: "Team B", Enabled: true, KeyHash: secondHash,
		Models: []ModelRule{{Model: "claude-sonnet", InputPricePerMillion: 3}},
	}, true); err != nil {
		t.Fatal(err)
	}
	store.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, UsageDetail{
		Provider: "codex", ExecutorType: "codex", AuthType: "apikey",
		Source: "openai-responses", ServiceTier: "priority", FailureStatusCode: 200,
	})
	store.RecordUsage("team-b", "claude-sonnet", "claude-sonnet", true, UsageDetail{
		Provider: "anthropic", ExecutorType: "claude", AuthType: "oauth",
		Source: "anthropic-messages", ServiceTier: "standard", FailureStatusCode: 429,
	})

	want := UsageFilters{
		KeyIDs: []string{"team-a"}, Providers: []string{"codex"}, Models: []string{"gpt-5.4"},
		ExecutorTypes: []string{"codex"}, AuthTypes: []string{"apikey"},
		Sources: []string{"openai-responses"}, ServiceTiers: []string{"priority"},
		StatusCodes: []int{200},
	}
	filter := UsageHistoryFilter{Since: now.Add(-time.Hour), Until: now.Add(time.Hour), KeyID: "team-a"}
	if got := mustUsageOverview(t, store, filter).Filters; !reflect.DeepEqual(got, want) {
		t.Fatalf("overview filters = %+v, want %+v", got, want)
	}
	if got := mustUsageAnalysis(t, store, filter).Filters; !reflect.DeepEqual(got, want) {
		t.Fatalf("analysis filters = %+v, want %+v", got, want)
	}
	if got := mustUsageEvents(t, store, filter, 1, 50).Filters; !reflect.DeepEqual(got, want) {
		t.Fatalf("event filters = %+v, want %+v", got, want)
	}
}

func TestUsageHistoryRangeKeepsEventFromSameMillisecond(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 100, time.UTC)
	store := newHistoryStore(t, filepath.Join(t.TempDir(), "state.db"), &now, PreviewKey("cpa_history_secret"))
	store.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, UsageDetail{Provider: "codex"})
	until := now.Add(200 * time.Nanosecond)
	overview := mustUsageOverview(t, store, UsageHistoryFilter{Since: now.Add(-time.Second), Until: until})
	if overview.Totals.RequestCount != 1 {
		t.Fatalf("same-millisecond event was excluded: %+v", overview.Totals)
	}
}

func TestAllStatePersistsAcrossRestartInSingleDatabase(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "state.db")
	first := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))
	first.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, UsageDetail{Provider: "codex", InputTokens: 1_000_000, TotalTokens: 1_000_000})
	if err := first.FlushUsage(); err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second := NewStore()
	second.SetClock(func() time.Time { return now })
	if err := second.Configure(Config{Enabled: true, StateFile: path}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = second.Close() })
	keys := second.Keys()
	if len(keys) != 1 || keys[0].ID != "team-a" || len(keys[0].Models) != 1 || keys[0].Models[0].Model != "gpt-5.4" {
		t.Fatalf("restored keys = %+v", keys)
	}
	usage := second.UsageSummaryFor(keys[0])
	if usage.DailyUSD != 2 || usage.WeeklyUSD != 2 {
		t.Fatalf("restored usage = %+v", usage)
	}
	page := mustUsageEvents(t, second, UsageHistoryFilter{Since: now.Add(-time.Hour), Until: now.Add(time.Hour)}, 1, 50)
	if page.Total != 1 || page.Events[0].KeyID != "team-a" || page.Events[0].KeyPreview != "cpa_*****cret" {
		t.Fatalf("restored events = %+v", page)
	}
}

func TestAuthenticationLearnsLegacyKeyPreviewAndBackfillsEvents(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "state.db")
	store := newHistoryStore(t, path, &now, "")
	store.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, UsageDetail{Provider: "codex"})
	before := mustUsageEvents(t, store, UsageHistoryFilter{}, 1, 50)
	if before.Events[0].KeyPreview != "" {
		t.Fatalf("preview before authentication = %q", before.Events[0].KeyPreview)
	}

	headers := http.Header{"Authorization": []string{"Bearer cpa_history_secret"}}
	decision := store.AuthenticateKey(headers, nil)
	if !decision.Allowed {
		t.Fatalf("authentication decision = %+v", decision)
	}
	if got := store.Keys()[0].KeyPreview; got != PreviewKey("cpa_history_secret") {
		t.Fatalf("learned key preview = %q", got)
	}
	after := mustUsageEvents(t, store, UsageHistoryFilter{}, 1, 50)
	if after.Events[0].KeyPreview != "cpa_*****cret" {
		t.Fatalf("backfilled event preview = %q", after.Events[0].KeyPreview)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reloaded := NewStore()
	reloaded.SetClock(func() time.Time { return now })
	if err := reloaded.Configure(Config{Enabled: true, StateFile: path}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reloaded.Close() })
	if got := reloaded.Keys()[0].KeyPreview; got != PreviewKey("cpa_history_secret") {
		t.Fatalf("persisted learned preview = %q", got)
	}
}

func TestUsageHistoryPrunesEventsOlderThanNinetyDaysWithoutCountLimit(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	database, err := openStateDatabase(filepath.Join(t.TempDir(), "state.db"), func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.close() })
	oldNow := now.Add(-91 * 24 * time.Hour)
	database.setClock(func() time.Time { return oldNow })
	if err := database.record(UsageEvent{KeyID: "expired", Model: "old"}); err != nil {
		t.Fatal(err)
	}
	database.setClock(func() time.Time { return now })
	for index := 0; index < 205; index++ {
		if err := database.record(UsageEvent{KeyID: "team-a", Model: "gpt-5.4"}); err != nil {
			t.Fatal(err)
		}
	}
	page, err := database.eventPage(UsageHistoryFilter{}, 1, 200)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 205 || len(page.Events) != 200 {
		t.Fatalf("retained event page = %+v", page)
	}
}

func TestStateDatabasePathIsTheConfiguredStateFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cpa-key-policy-state.db")
	now := time.Now().UTC()
	store := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))
	if store.StatePath() != path || store.runtimeHistory().path != path {
		t.Fatalf("store path = %q, database path = %q", store.StatePath(), store.runtimeHistory().path)
	}
	if DefaultConfig().StateFile != "cpa-keyer-state.db" {
		t.Fatalf("default state file = %q", DefaultConfig().StateFile)
	}
}
