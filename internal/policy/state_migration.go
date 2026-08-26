package policy

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// StateMigrationSummary contains only aggregate verification data. It never
// exposes key hashes, key previews, or request-level credentials.
type StateMigrationSummary struct {
	SourceVersion     int         `json:"source_version"`
	KeyCount          int         `json:"key_count"`
	ModelRuleCount    int         `json:"model_rule_count"`
	UsageCount        int         `json:"usage_count"`
	SourceEventCount  int         `json:"source_event_count"`
	EventCount        int         `json:"event_count"`
	DroppedEventCount int         `json:"dropped_event_count"`
	MaxEventID        int64       `json:"max_event_id"`
	NextEventID       int64       `json:"next_event_id"`
	DailyUSD          float64     `json:"daily_usd"`
	WeeklyUSD         float64     `json:"weekly_usd"`
	DailyCalls        int64       `json:"daily_calls"`
	WeeklyCalls       int64       `json:"weekly_calls"`
	EventTotals       UsageTotals `json:"event_totals"`
	Verified          bool        `json:"verified"`
}

// MigrateLegacyStateFile converts one legacy JSON state file into a new
// SQLite state file. The source is read-only and an existing destination is
// never overwritten.
func MigrateLegacyStateFile(sourcePath, destinationPath string) (StateMigrationSummary, error) {
	return migrateLegacyStateFile(sourcePath, destinationPath, time.Now)
}

func migrateLegacyStateFile(sourcePath, destinationPath string, now func() time.Time) (StateMigrationSummary, error) {
	if now == nil {
		now = time.Now
	}
	sourcePath, destinationPath, err := validateMigrationPaths(sourcePath, destinationPath)
	if err != nil {
		return StateMigrationSummary{}, err
	}
	state, err := LoadState(sourcePath)
	if err != nil {
		return StateMigrationSummary{}, fmt.Errorf("read legacy JSON state: %w", err)
	}
	prepared, err := prepareLegacyState(state, now().UTC())
	if err != nil {
		return StateMigrationSummary{}, err
	}

	temp, err := os.CreateTemp(filepath.Dir(destinationPath), "."+filepath.Base(destinationPath)+".tmp-*")
	if err != nil {
		return StateMigrationSummary{}, fmt.Errorf("create temporary SQLite state: %w", err)
	}
	tempPath := temp.Name()
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempPath)
		return StateMigrationSummary{}, fmt.Errorf("close temporary SQLite state: %w", err)
	}
	defer removeSQLiteFiles(tempPath)

	database, err := openStateDatabase(tempPath, now)
	if err != nil {
		return StateMigrationSummary{}, err
	}
	closed := false
	defer func() {
		if !closed {
			_ = database.close()
		}
	}()
	if err := database.importLegacyState(prepared); err != nil {
		return StateMigrationSummary{}, err
	}
	summary, err := database.verifyLegacyState(prepared)
	if err != nil {
		return StateMigrationSummary{}, err
	}
	if _, err := database.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		return StateMigrationSummary{}, fmt.Errorf("checkpoint migrated SQLite state: %w", err)
	}
	if err := database.close(); err != nil {
		return StateMigrationSummary{}, fmt.Errorf("close migrated SQLite state: %w", err)
	}
	closed = true
	if err := syncFile(tempPath); err != nil {
		return StateMigrationSummary{}, err
	}
	// Hard-link publication is atomic and fails if the destination appeared
	// while the migration was running, so an existing database is never replaced.
	if err := os.Link(tempPath, destinationPath); err != nil {
		if errors.Is(err, os.ErrExist) {
			return StateMigrationSummary{}, fmt.Errorf("destination already exists: %s", destinationPath)
		}
		return StateMigrationSummary{}, fmt.Errorf("publish migrated SQLite state: %w", err)
	}
	if err := syncDirectory(filepath.Dir(destinationPath)); err != nil {
		return StateMigrationSummary{}, err
	}
	return summary, nil
}

func validateMigrationPaths(sourcePath, destinationPath string) (string, string, error) {
	sourcePath = strings.TrimSpace(sourcePath)
	destinationPath = strings.TrimSpace(destinationPath)
	if sourcePath == "" || destinationPath == "" {
		return "", "", errors.New("source and destination paths are required")
	}
	sourcePath, err := filepath.Abs(sourcePath)
	if err != nil {
		return "", "", fmt.Errorf("resolve source path: %w", err)
	}
	destinationPath, err = filepath.Abs(destinationPath)
	if err != nil {
		return "", "", fmt.Errorf("resolve destination path: %w", err)
	}
	if sourcePath == destinationPath {
		return "", "", errors.New("source and destination paths must differ")
	}
	if _, err := os.Stat(sourcePath); err != nil {
		return "", "", fmt.Errorf("inspect source state: %w", err)
	}
	if _, err := os.Lstat(destinationPath); err == nil {
		return "", "", fmt.Errorf("destination already exists: %s", destinationPath)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", "", fmt.Errorf("inspect destination state: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(destinationPath), 0o700); err != nil {
		return "", "", fmt.Errorf("create destination directory: %w", err)
	}
	return sourcePath, destinationPath, nil
}

type preparedLegacyState struct {
	sourceVersion    int
	sourceEventCount int
	keys             []KeyConfig
	usage            map[string]*UsageState
	events           []UsageEvent
	nextEventID      int64
	stateDigest      string
	eventDigest      string
}

func prepareLegacyState(state *State, now time.Time) (preparedLegacyState, error) {
	config := Config{Enabled: true, Keys: append([]KeyConfig(nil), state.Keys...), Aliases: append([]AliasMapping(nil), state.Aliases...)}
	if err := normalizeConfig(&config); err != nil {
		return preparedLegacyState{}, fmt.Errorf("normalize legacy JSON state: %w", err)
	}
	keys := append([]KeyConfig(nil), config.Keys...)
	previews := make(map[string]string, len(keys))
	for index := range keys {
		if keys[index].CreatedAt.IsZero() {
			keys[index].CreatedAt = now
		}
		if keys[index].UpdatedAt.IsZero() {
			keys[index].UpdatedAt = keys[index].CreatedAt
		}
		keys[index].CreatedAt = millisToTime(timeToMillis(keys[index].CreatedAt))
		keys[index].UpdatedAt = millisToTime(timeToMillis(keys[index].UpdatedAt))
		previews[strings.ToLower(keys[index].ID)] = MaskKeyPreview(keys[index].KeyPreview)
	}
	sort.Slice(keys, func(left, right int) bool { return keys[left].ID < keys[right].ID })

	cutoff := now.Add(-usageHistoryRetention)
	events := make([]UsageEvent, 0, len(state.History.Events))
	seenIDs := make(map[int64]struct{}, len(state.History.Events))
	maxEventID := int64(0)
	for _, sourceEvent := range state.History.Events {
		if sourceEvent.ID <= 0 {
			return preparedLegacyState{}, fmt.Errorf("legacy request event has invalid id %d", sourceEvent.ID)
		}
		if _, exists := seenIDs[sourceEvent.ID]; exists {
			return preparedLegacyState{}, fmt.Errorf("legacy request event id %d is duplicated", sourceEvent.ID)
		}
		seenIDs[sourceEvent.ID] = struct{}{}
		event := normalizeUsageEvent(sourceEvent, now)
		if event.Timestamp.Before(cutoff) {
			continue
		}
		if event.KeyPreview == "" {
			event.KeyPreview = previews[strings.ToLower(event.KeyID)]
		} else {
			event.KeyPreview = MaskKeyPreview(event.KeyPreview)
		}
		events = append(events, event)
		if event.ID > maxEventID {
			maxEventID = event.ID
		}
	}
	sort.Slice(events, func(left, right int) bool { return events[left].ID < events[right].ID })
	nextEventID := state.History.NextID
	if nextEventID <= maxEventID {
		nextEventID = maxEventID + 1
	}
	if nextEventID < 1 {
		nextEventID = 1
	}
	usage := state.Usage
	if usage == nil {
		usage = make(map[string]*UsageState)
	}
	stateDigest, err := statePayloadDigest(keys, usage)
	if err != nil {
		return preparedLegacyState{}, err
	}
	eventDigest, err := eventPayloadDigest(events)
	if err != nil {
		return preparedLegacyState{}, err
	}
	return preparedLegacyState{
		sourceVersion: state.Version, sourceEventCount: len(state.History.Events),
		keys: keys, usage: usage, events: events, nextEventID: nextEventID,
		stateDigest: stateDigest, eventDigest: eventDigest,
	}, nil
}

func (h *stateDatabase) importLegacyState(state preparedLegacyState) error {
	tx, err := h.db.Begin()
	if err != nil {
		return fmt.Errorf("begin legacy state migration: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := writeStateMetadata(tx); err != nil {
		return err
	}
	if err := replaceKeyConfigs(tx, state.keys); err != nil {
		return err
	}
	if err := replaceUsageState(tx, state.usage); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM usage_events`); err != nil {
		return fmt.Errorf("clear request events for migration: %w", err)
	}
	statement, err := tx.Prepare(`
		INSERT INTO usage_events (
			id, timestamp_ns, key_id, key_preview, provider, model, upstream_model,
			failed, billing_mode, cost_available, cost_usd, input_tokens,
			output_tokens, reasoning_tokens, cached_tokens, cache_read_tokens,
			cache_creation_tokens, total_tokens
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare request event migration: %w", err)
	}
	defer statement.Close()
	for _, event := range state.events {
		args := append([]any{event.ID}, usageEventArgs(event)...)
		if _, err := statement.Exec(args...); err != nil {
			return fmt.Errorf("migrate request event %d: %w", event.ID, err)
		}
	}
	if err := setUsageEventSequence(tx, state.nextEventID-1); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit legacy state migration: %w", err)
	}
	return nil
}

func setUsageEventSequence(tx *sql.Tx, sequence int64) error {
	if sequence < 0 {
		sequence = 0
	}
	result, err := tx.Exec(`UPDATE sqlite_sequence SET seq = ? WHERE name = 'usage_events'`, sequence)
	if err != nil {
		return fmt.Errorf("advance request event sequence: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect request event sequence: %w", err)
	}
	if rows == 0 {
		if _, err := tx.Exec(`INSERT INTO sqlite_sequence(name, seq) VALUES ('usage_events', ?)`, sequence); err != nil {
			return fmt.Errorf("seed request event sequence: %w", err)
		}
	}
	return nil
}

func (h *stateDatabase) verifyLegacyState(expected preparedLegacyState) (StateMigrationSummary, error) {
	keys, usage, initialized, err := h.loadState()
	if err != nil {
		return StateMigrationSummary{}, err
	}
	if !initialized {
		return StateMigrationSummary{}, errors.New("migrated SQLite state has no metadata")
	}
	stateDigest, err := statePayloadDigest(keys, usage)
	if err != nil {
		return StateMigrationSummary{}, err
	}
	if stateDigest != expected.stateDigest {
		return StateMigrationSummary{}, errors.New("migrated Key configuration or aggregate usage verification failed")
	}
	events, err := h.allUsageEvents()
	if err != nil {
		return StateMigrationSummary{}, err
	}
	eventDigest, err := eventPayloadDigest(events)
	if err != nil {
		return StateMigrationSummary{}, err
	}
	if eventDigest != expected.eventDigest {
		return StateMigrationSummary{}, errors.New("migrated request event verification failed")
	}
	totals, err := h.queryTotals("", nil)
	if err != nil {
		return StateMigrationSummary{}, err
	}
	var maxEventID int64
	if err := h.db.QueryRow(`SELECT COALESCE(MAX(id), 0) FROM usage_events`).Scan(&maxEventID); err != nil {
		return StateMigrationSummary{}, fmt.Errorf("verify migrated maximum event id: %w", err)
	}
	summary := StateMigrationSummary{
		SourceVersion: expected.sourceVersion, KeyCount: len(keys), UsageCount: len(usage),
		SourceEventCount: expected.sourceEventCount, EventCount: len(events),
		DroppedEventCount: expected.sourceEventCount - len(events), MaxEventID: maxEventID,
		NextEventID: expected.nextEventID, EventTotals: totals, Verified: true,
	}
	for _, key := range keys {
		summary.ModelRuleCount += len(key.Models)
	}
	for _, state := range usage {
		if state == nil {
			continue
		}
		summary.DailyUSD += state.Daily.TotalUSD
		summary.WeeklyUSD += state.Weekly.TotalUSD
		summary.DailyCalls += state.Daily.CallCount
		summary.WeeklyCalls += state.Weekly.CallCount
	}
	return summary, nil
}

func (h *stateDatabase) allUsageEvents() ([]UsageEvent, error) {
	rows, err := h.db.Query(`SELECT ` + usageEventColumns + ` FROM usage_events ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("read migrated request events: %w", err)
	}
	defer rows.Close()
	events := make([]UsageEvent, 0)
	for rows.Next() {
		event, err := scanUsageEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate migrated request events: %w", err)
	}
	return events, nil
}

func statePayloadDigest(keys []KeyConfig, usage map[string]*UsageState) (string, error) {
	keys = append([]KeyConfig(nil), keys...)
	sort.Slice(keys, func(left, right int) bool { return keys[left].ID < keys[right].ID })
	raw, err := json.Marshal(struct {
		Keys  []KeyConfig            `json:"keys"`
		Usage map[string]*UsageState `json:"usage"`
	}{Keys: keys, Usage: usage})
	if err != nil {
		return "", fmt.Errorf("encode migrated state verification payload: %w", err)
	}
	return sha256Hex(raw), nil
}

func eventPayloadDigest(events []UsageEvent) (string, error) {
	raw, err := json.Marshal(events)
	if err != nil {
		return "", fmt.Errorf("encode migrated event verification payload: %w", err)
	}
	return sha256Hex(raw), nil
}

func sha256Hex(raw []byte) string {
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func syncFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open migrated SQLite state for sync: %w", err)
	}
	defer file.Close()
	if err := file.Sync(); err != nil {
		return fmt.Errorf("sync migrated SQLite state: %w", err)
	}
	return nil
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open destination directory for sync: %w", err)
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return fmt.Errorf("sync destination directory: %w", err)
	}
	return nil
}

func removeSQLiteFiles(path string) {
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		_ = os.Remove(candidate)
	}
}
