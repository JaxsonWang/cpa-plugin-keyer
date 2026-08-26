package policy

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeLegacyMigrationState(t *testing.T, path string, state State) []byte {
	t.Helper()
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	return raw
}

func legacyMigrationFixture(t *testing.T, now time.Time) State {
	t.Helper()
	return State{
		Version: 3,
		Keys: []KeyConfig{{
			ID: "team-a", Name: "Team A", Enabled: true,
			KeyHash: hashForUsageTest(t, "cpa_migrate_secret"), KeyPreview: PreviewKey("cpa_migrate_secret"),
			Models: []ModelRule{{TargetModel: "gpt-5.4", InputPricePerMillion: 2, OutputPricePerMillion: 8}},
		}},
		Usage: map[string]*UsageState{
			"team-a": {
				Daily:  UsageWindow{TotalUSD: 2.5, CallCount: 3, WindowStart: now.Truncate(24 * time.Hour)},
				Weekly: UsageWindow{TotalUSD: 5.5, CallCount: 7, WindowStart: now.Add(-6 * 24 * time.Hour)},
			},
		},
		History: UsageHistoryState{NextID: 12, Events: []UsageEvent{
			{ID: 2, Timestamp: now.Add(-91 * 24 * time.Hour), KeyID: "team-a", Model: "expired", CostAvailable: true},
			{ID: 5, Timestamp: now.Add(-time.Hour), KeyID: "team-a", Provider: "codex", Model: "gpt-5.4", CostAvailable: true, CostUSD: 0.3, InputTokens: 100, OutputTokens: 20, TotalTokens: 120},
			{ID: 8, Timestamp: now.Add(-time.Minute), KeyID: "team-a", Provider: "codex", Model: "gpt-5.4", Failed: true, CostAvailable: true, CostUSD: 0.1, InputTokens: 30, OutputTokens: 10, TotalTokens: 40},
		}},
		UpdatedAt: now,
	}
}

func TestMigrateLegacyStateFileCreatesVerifiedSQLiteWithoutChangingSource(t *testing.T) {
	now := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	directory := t.TempDir()
	sourcePath := filepath.Join(directory, "state.json")
	destinationPath := filepath.Join(directory, "state.db")
	original := writeLegacyMigrationState(t, sourcePath, legacyMigrationFixture(t, now))

	summary, err := migrateLegacyStateFile(sourcePath, destinationPath, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	if !summary.Verified || summary.KeyCount != 1 || summary.ModelRuleCount != 1 || summary.UsageCount != 1 {
		t.Fatalf("migration summary = %+v", summary)
	}
	if summary.SourceEventCount != 3 || summary.EventCount != 2 || summary.DroppedEventCount != 1 || summary.MaxEventID != 8 || summary.NextEventID != 12 {
		t.Fatalf("event migration summary = %+v", summary)
	}
	if summary.DailyUSD != 2.5 || summary.WeeklyUSD != 5.5 || summary.DailyCalls != 3 || summary.WeeklyCalls != 7 {
		t.Fatalf("usage migration summary = %+v", summary)
	}
	if summary.EventTotals.RequestCount != 2 || summary.EventTotals.FailureCount != 1 || summary.EventTotals.TotalTokens != 160 || summary.EventTotals.CostUSD != 0.4 {
		t.Fatalf("event totals = %+v", summary.EventTotals)
	}

	current, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(current, original) {
		t.Fatal("source JSON changed during migration")
	}
	databaseHeader, err := os.ReadFile(destinationPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(databaseHeader, []byte("SQLite format 3\x00")) {
		t.Fatalf("destination is not SQLite: %q", databaseHeader[:min(len(databaseHeader), 16)])
	}

	database, err := openStateDatabase(destinationPath, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	defer database.close()
	keys, usage, initialized, err := database.loadState()
	if err != nil || !initialized {
		t.Fatalf("load migrated state: initialized=%v err=%v", initialized, err)
	}
	if len(keys) != 1 || len(keys[0].Models) != 1 || keys[0].Models[0].Model != "gpt-5.4" || usage["team-a"].Daily.TotalUSD != 2.5 {
		t.Fatalf("migrated state = keys=%+v usage=%+v", keys, usage)
	}
	events, err := database.allUsageEvents()
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].ID != 5 || events[1].ID != 8 || events[0].KeyPreview != "cpa_*****cret" {
		t.Fatalf("migrated events = %+v", events)
	}
	for _, event := range events {
		if !event.Generate || event.LatencyMS != 0 || event.TTFTMS != nil ||
			event.ExecutorType != "" || event.AuthType != "" || event.StatusCode != 0 ||
			event.UncachedInputCostUSD != 0 || event.CacheReadCostUSD != 0 ||
			event.CacheCreationCostUSD != 0 || event.OutputCostUSD != 0 || event.OtherCostUSD != 0 {
			t.Fatalf("legacy event defaults = %+v", event)
		}
	}
	if err := database.record(UsageEvent{KeyID: "team-a", Model: "gpt-5.4"}); err != nil {
		t.Fatal(err)
	}
	events, err = database.allUsageEvents()
	if err != nil {
		t.Fatal(err)
	}
	if events[len(events)-1].ID != 12 {
		t.Fatalf("next migrated event id = %d, want 12", events[len(events)-1].ID)
	}
}

func TestMigrateLegacyStateFileNeverOverwritesDestination(t *testing.T) {
	now := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	directory := t.TempDir()
	sourcePath := filepath.Join(directory, "state.json")
	destinationPath := filepath.Join(directory, "state.db")
	writeLegacyMigrationState(t, sourcePath, legacyMigrationFixture(t, now))
	original := []byte("existing database placeholder")
	if err := os.WriteFile(destinationPath, original, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := migrateLegacyStateFile(sourcePath, destinationPath, func() time.Time { return now }); err == nil {
		t.Fatal("migration overwrote an existing destination")
	}
	current, err := os.ReadFile(destinationPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(current, original) {
		t.Fatalf("existing destination changed: %q", current)
	}
}

func TestMigrateLegacyStateFileRejectsDuplicateEventIDsWithoutPublishing(t *testing.T) {
	now := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	directory := t.TempDir()
	sourcePath := filepath.Join(directory, "state.json")
	destinationPath := filepath.Join(directory, "state.db")
	state := legacyMigrationFixture(t, now)
	state.History.Events[1].ID = state.History.Events[0].ID
	writeLegacyMigrationState(t, sourcePath, state)
	if _, err := migrateLegacyStateFile(sourcePath, destinationPath, func() time.Time { return now }); err == nil {
		t.Fatal("migration accepted duplicate event IDs")
	}
	if _, err := os.Stat(destinationPath); !os.IsNotExist(err) {
		t.Fatalf("destination was published after failed migration: %v", err)
	}
}
