package policy

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newHistoryStore(t *testing.T, path string, now *time.Time) *Store {
	t.Helper()
	store := NewStore()
	store.SetClock(func() time.Time { return *now })
	if err := store.Configure(Config{
		Enabled: true, StateFile: path,
		Keys: []KeyConfig{{
			ID: "team-a", Name: "Team A", Enabled: true,
			KeyHash: hashForUsageTest(t, "cpa_history_secret"),
			Models: []ModelRule{{
				Model: "gpt-5.4", BillingMode: "tokens",
				InputPricePerMillion: 2, OutputPricePerMillion: 8,
			}},
		}},
	}); err != nil {
		t.Fatal(err)
	}
	return store
}

func TestUsageHistoryRecordsKeyIDWithoutRawCredential(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	store := newHistoryStore(t, filepath.Join(t.TempDir(), "state.json"), &now)
	cost := store.RecordUsage("cpa_history_secret", "gpt-5.4", "gpt-5.4-2026-08-01", false, UsageDetail{
		Provider: "codex", InputTokens: 1_000, OutputTokens: 200, TotalTokens: 1_200,
	})
	if cost <= 0 {
		t.Fatalf("cost = %v, want a priced event", cost)
	}
	page := store.UsageEvents(UsageHistoryFilter{Since: now.Add(-time.Hour), Until: now.Add(time.Hour)}, 1, 50)
	if page.Total != 1 || len(page.Events) != 1 {
		t.Fatalf("event page = %+v, want one event", page)
	}
	event := page.Events[0]
	if event.KeyID != "team-a" || event.Provider != "codex" || event.Model != "gpt-5.4" || event.UpstreamModel != "gpt-5.4-2026-08-01" {
		t.Fatalf("event identity = %+v", event)
	}
	if strings.Contains(event.KeyID, "cpa_") {
		t.Fatalf("raw downstream credential leaked into event: %+v", event)
	}
}

func TestUsageHistoryIncludesFailedZeroTokenRequests(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	store := newHistoryStore(t, filepath.Join(t.TempDir(), "state.json"), &now)
	if cost := store.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", true, UsageDetail{Provider: "codex"}); cost != 0 {
		t.Fatalf("failed zero-token cost = %v, want 0", cost)
	}
	overview := store.UsageOverview(UsageHistoryFilter{Since: now.Add(-time.Hour), Until: now.Add(time.Hour)})
	if overview.Totals.RequestCount != 1 || overview.Totals.FailureCount != 1 || overview.Totals.SuccessCount != 0 {
		t.Fatalf("failed request totals = %+v", overview.Totals)
	}
}

func TestUsageHistoryOverviewAnalysisAndFilters(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	store := newHistoryStore(t, filepath.Join(t.TempDir(), "state.json"), &now)
	store.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, UsageDetail{
		Provider: "codex", InputTokens: 1_000, OutputTokens: 500, CacheReadTokens: 250, TotalTokens: 1_500,
	})
	now = now.Add(2 * time.Hour)
	store.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, UsageDetail{
		Provider: "codex", InputTokens: 2_000, OutputTokens: 1_000, TotalTokens: 3_000,
	})
	filter := UsageHistoryFilter{Since: now.Add(-4 * time.Hour), Until: now.Add(time.Hour), KeyID: "team-a"}
	overview := store.UsageOverview(filter)
	if overview.Granularity != "hour" || overview.Totals.RequestCount != 2 || overview.Totals.TotalTokens != 4_500 {
		t.Fatalf("overview = %+v", overview)
	}
	if len(overview.Series) != 5 {
		t.Fatalf("series buckets = %d, want 5", len(overview.Series))
	}
	analysis := store.UsageAnalysis(filter)
	if len(analysis.ByModel) != 1 || analysis.ByModel[0].Name != "gpt-5.4" || analysis.ByModel[0].RequestCount != 2 {
		t.Fatalf("analysis by model = %+v", analysis.ByModel)
	}
	if len(analysis.Filters.KeyIDs) != 1 || analysis.Filters.KeyIDs[0] != "team-a" || len(analysis.Filters.Providers) != 1 {
		t.Fatalf("filter options = %+v", analysis.Filters)
	}
}

func TestUsageHistoryPersistsAcrossRestart(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "state.json")
	first := newHistoryStore(t, path, &now)
	first.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, UsageDetail{Provider: "codex", InputTokens: 100, TotalTokens: 100})
	if err := first.FlushUsage(); err != nil {
		t.Fatal(err)
	}

	second := NewStore()
	second.SetClock(func() time.Time { return now })
	if err := second.Configure(Config{Enabled: true, StateFile: path}); err != nil {
		t.Fatal(err)
	}
	page := second.UsageEvents(UsageHistoryFilter{Since: now.Add(-time.Hour), Until: now.Add(time.Hour)}, 1, 50)
	if page.Total != 1 || page.Events[0].KeyID != "team-a" {
		t.Fatalf("restored events = %+v", page)
	}
}

func TestUsageHistoryDropsExpiredStateEvents(t *testing.T) {
	now := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	history := newUsageHistory(func() time.Time { return now })
	history.loadFromState(UsageHistoryState{NextID: 3, Events: []UsageEvent{
		{ID: 1, Timestamp: now.Add(-91 * 24 * time.Hour), KeyID: "expired", Model: "old"},
		{ID: 2, Timestamp: now.Add(-time.Hour), KeyID: "team-a", Model: "gpt-5.4"},
	}})
	snapshot := history.snapshot()
	if len(snapshot.Events) != 1 || snapshot.Events[0].ID != 2 || snapshot.NextID != 3 {
		t.Fatalf("pruned history = %+v", snapshot)
	}
}
