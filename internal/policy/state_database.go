package policy

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const (
	usageHistoryRetention     = 90 * 24 * time.Hour
	usageHistoryPruneInterval = time.Hour
	stateDatabaseVersion      = 2
)

var stateDatabaseInitializationMu sync.Mutex

type stateDatabase struct {
	db         *sql.DB
	insertStmt *sql.Stmt
	path       string

	mu        sync.Mutex
	now       func() time.Time
	lastPrune time.Time
}

func openStateDatabase(path string, now func() time.Time) (*stateDatabase, error) {
	if now == nil {
		now = time.Now
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create state database directory: %w", err)
	}

	databaseURL := &url.URL{Scheme: "file", Path: path}
	query := databaseURL.Query()
	query.Add("_pragma", "busy_timeout(5000)")
	query.Add("_pragma", "synchronous(NORMAL)")
	databaseURL.RawQuery = query.Encode()
	db, err := sql.Open("sqlite", databaseURL.String())
	if err != nil {
		return nil, fmt.Errorf("open state database: %w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)

	database := &stateDatabase{db: db, path: path, now: now}
	stateDatabaseInitializationMu.Lock()
	initializeErr := database.initialize()
	stateDatabaseInitializationMu.Unlock()
	if initializeErr != nil {
		_ = db.Close()
		return nil, initializeErr
	}
	if err := os.Chmod(path, 0o600); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("secure state database: %w", err)
	}
	if err := database.prune(now().UTC()); err != nil {
		_ = db.Close()
		return nil, err
	}
	database.insertStmt, err = db.Prepare(`
		INSERT INTO usage_events (
			timestamp_ns, key_id, key_preview, provider, model, upstream_model,
			reasoning_effort, executor_type, auth_type, auth_index, source,
			service_tier, generate, latency_ms, ttft_ms, status_code, failed,
			billing_mode, cost_available, cost_usd, uncached_input_cost_usd,
			cache_read_cost_usd, cache_creation_cost_usd, output_cost_usd,
			other_cost_usd, input_tokens, output_tokens, reasoning_tokens,
			cached_tokens, cache_read_tokens, cache_creation_tokens, total_tokens
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("prepare usage event insert: %w", err)
	}
	return database, nil
}

func (h *stateDatabase) initialize() error {
	statements := []string{
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS state_meta (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			schema_version INTEGER NOT NULL,
			updated_at_ms INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS key_configs (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			enabled INTEGER NOT NULL,
			key_hash TEXT NOT NULL,
			key_preview TEXT NOT NULL DEFAULT '',
			rpm INTEGER NOT NULL,
			models_json BLOB NOT NULL,
			allow_models_endpoint INTEGER NOT NULL,
			daily_limit_usd REAL NOT NULL,
			weekly_limit_usd REAL NOT NULL,
			created_at_ms INTEGER NOT NULL,
			updated_at_ms INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS usage_state (
			key_id TEXT PRIMARY KEY,
			state_json BLOB NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS usage_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp_ns INTEGER NOT NULL,
			key_id TEXT NOT NULL,
			key_preview TEXT NOT NULL DEFAULT '',
			provider TEXT NOT NULL DEFAULT '',
			model TEXT NOT NULL,
			upstream_model TEXT NOT NULL DEFAULT '',
			reasoning_effort TEXT NOT NULL DEFAULT '',
			executor_type TEXT NOT NULL DEFAULT '',
			auth_type TEXT NOT NULL DEFAULT '',
			auth_index TEXT NOT NULL DEFAULT '',
			source TEXT NOT NULL DEFAULT '',
			service_tier TEXT NOT NULL DEFAULT '',
			generate INTEGER NOT NULL DEFAULT 1,
			latency_ms INTEGER NOT NULL DEFAULT 0,
			ttft_ms INTEGER,
			status_code INTEGER NOT NULL DEFAULT 0,
			failed INTEGER NOT NULL,
			billing_mode TEXT NOT NULL DEFAULT '',
			cost_available INTEGER NOT NULL,
			cost_usd REAL NOT NULL,
			uncached_input_cost_usd REAL NOT NULL DEFAULT 0,
			cache_read_cost_usd REAL NOT NULL DEFAULT 0,
			cache_creation_cost_usd REAL NOT NULL DEFAULT 0,
			output_cost_usd REAL NOT NULL DEFAULT 0,
			other_cost_usd REAL NOT NULL DEFAULT 0,
			input_tokens INTEGER NOT NULL,
			output_tokens INTEGER NOT NULL,
			reasoning_tokens INTEGER NOT NULL,
			cached_tokens INTEGER NOT NULL,
			cache_read_tokens INTEGER NOT NULL,
			cache_creation_tokens INTEGER NOT NULL,
			total_tokens INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS usage_events_timestamp_idx ON usage_events(timestamp_ns)`,
		`CREATE INDEX IF NOT EXISTS usage_events_key_time_idx ON usage_events(key_id COLLATE NOCASE, timestamp_ns)`,
		`CREATE INDEX IF NOT EXISTS usage_events_model_time_idx ON usage_events(model COLLATE NOCASE, timestamp_ns)`,
		`CREATE INDEX IF NOT EXISTS usage_events_provider_time_idx ON usage_events(provider COLLATE NOCASE, timestamp_ns)`,
	}
	for _, statement := range statements {
		if _, err := h.db.Exec(statement); err != nil {
			return fmt.Errorf("initialize usage database: %w", err)
		}
	}
	if err := h.migrateSchema(); err != nil {
		return err
	}
	indexes := []string{
		`CREATE INDEX IF NOT EXISTS usage_events_executor_time_idx ON usage_events(executor_type COLLATE NOCASE, timestamp_ns)`,
		`CREATE INDEX IF NOT EXISTS usage_events_auth_type_time_idx ON usage_events(auth_type COLLATE NOCASE, timestamp_ns)`,
		`CREATE INDEX IF NOT EXISTS usage_events_source_time_idx ON usage_events(source COLLATE NOCASE, timestamp_ns)`,
		`CREATE INDEX IF NOT EXISTS usage_events_service_tier_time_idx ON usage_events(service_tier COLLATE NOCASE, timestamp_ns)`,
		`CREATE INDEX IF NOT EXISTS usage_events_status_time_idx ON usage_events(status_code, timestamp_ns)`,
	}
	for _, statement := range indexes {
		if _, err := h.db.Exec(statement); err != nil {
			return fmt.Errorf("initialize usage database indexes: %w", err)
		}
	}
	return nil
}

func (h *stateDatabase) migrateSchema() error {
	ctx := context.Background()
	conn, err := h.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquire state database schema migration connection: %w", err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `BEGIN IMMEDIATE`); err != nil {
		return fmt.Errorf("begin state database schema migration: %w", err)
	}
	transactionOpen := true
	defer func() {
		if transactionOpen {
			_, _ = conn.ExecContext(ctx, `ROLLBACK`)
		}
	}()

	var version int
	if err := conn.QueryRowContext(ctx, `SELECT schema_version FROM state_meta WHERE id = 1`).Scan(&version); err != nil {
		if err == sql.ErrNoRows {
			if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
				return fmt.Errorf("commit empty state database schema migration: %w", err)
			}
			transactionOpen = false
			return nil
		}
		return fmt.Errorf("read state database schema version: %w", err)
	}
	if version > stateDatabaseVersion {
		return fmt.Errorf("state database schema version %d is newer than supported version %d", version, stateDatabaseVersion)
	}
	if version == stateDatabaseVersion {
		if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
			return fmt.Errorf("commit current state database schema migration: %w", err)
		}
		transactionOpen = false
		return nil
	}
	if version != 1 {
		return fmt.Errorf("state database schema version %d is unsupported", version)
	}

	columns := make(map[string]bool)
	rows, err := conn.QueryContext(ctx, `PRAGMA table_info(usage_events)`)
	if err != nil {
		return fmt.Errorf("inspect usage event columns: %w", err)
	}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan usage event column: %w", err)
		}
		columns[name] = true
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close usage event column rows: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate usage event columns: %w", err)
	}

	migrations := []struct {
		name      string
		statement string
	}{
		{"reasoning_effort", `ALTER TABLE usage_events ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT ''`},
		{"executor_type", `ALTER TABLE usage_events ADD COLUMN executor_type TEXT NOT NULL DEFAULT ''`},
		{"auth_type", `ALTER TABLE usage_events ADD COLUMN auth_type TEXT NOT NULL DEFAULT ''`},
		{"auth_index", `ALTER TABLE usage_events ADD COLUMN auth_index TEXT NOT NULL DEFAULT ''`},
		{"source", `ALTER TABLE usage_events ADD COLUMN source TEXT NOT NULL DEFAULT ''`},
		{"service_tier", `ALTER TABLE usage_events ADD COLUMN service_tier TEXT NOT NULL DEFAULT ''`},
		{"generate", `ALTER TABLE usage_events ADD COLUMN generate INTEGER NOT NULL DEFAULT 1`},
		{"latency_ms", `ALTER TABLE usage_events ADD COLUMN latency_ms INTEGER NOT NULL DEFAULT 0`},
		{"ttft_ms", `ALTER TABLE usage_events ADD COLUMN ttft_ms INTEGER`},
		{"status_code", `ALTER TABLE usage_events ADD COLUMN status_code INTEGER NOT NULL DEFAULT 0`},
		{"uncached_input_cost_usd", `ALTER TABLE usage_events ADD COLUMN uncached_input_cost_usd REAL NOT NULL DEFAULT 0`},
		{"cache_read_cost_usd", `ALTER TABLE usage_events ADD COLUMN cache_read_cost_usd REAL NOT NULL DEFAULT 0`},
		{"cache_creation_cost_usd", `ALTER TABLE usage_events ADD COLUMN cache_creation_cost_usd REAL NOT NULL DEFAULT 0`},
		{"output_cost_usd", `ALTER TABLE usage_events ADD COLUMN output_cost_usd REAL NOT NULL DEFAULT 0`},
		{"other_cost_usd", `ALTER TABLE usage_events ADD COLUMN other_cost_usd REAL NOT NULL DEFAULT 0`},
	}
	for _, migration := range migrations {
		if columns[migration.name] {
			continue
		}
		if _, err := conn.ExecContext(ctx, migration.statement); err != nil {
			return fmt.Errorf("migrate usage event details: %w", err)
		}
	}
	if _, err := conn.ExecContext(ctx, `UPDATE state_meta SET schema_version = ?, updated_at_ms = ? WHERE id = 1`, stateDatabaseVersion, h.currentTime().UnixMilli()); err != nil {
		return fmt.Errorf("update state database schema version: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
		return fmt.Errorf("commit state database schema migration: %w", err)
	}
	transactionOpen = false
	return nil
}

func (h *stateDatabase) loadState() ([]KeyConfig, map[string]*UsageState, bool, error) {
	var version int
	if err := h.db.QueryRow(`SELECT schema_version FROM state_meta WHERE id = 1`).Scan(&version); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil, false, nil
		}
		return nil, nil, false, fmt.Errorf("read state database metadata: %w", err)
	}
	if version > stateDatabaseVersion {
		return nil, nil, false, fmt.Errorf("state database schema version %d is newer than supported version %d", version, stateDatabaseVersion)
	}

	rows, err := h.db.Query(`
		SELECT id, name, enabled, key_hash, key_preview, rpm, models_json,
			allow_models_endpoint, daily_limit_usd, weekly_limit_usd,
			created_at_ms, updated_at_ms
		FROM key_configs ORDER BY id`)
	if err != nil {
		return nil, nil, false, fmt.Errorf("query key configurations: %w", err)
	}
	keys := make([]KeyConfig, 0)
	for rows.Next() {
		var key KeyConfig
		var enabled, allowModels int
		var modelsJSON []byte
		var createdAt, updatedAt int64
		if err := rows.Scan(
			&key.ID, &key.Name, &enabled, &key.KeyHash, &key.KeyPreview, &key.RPM,
			&modelsJSON, &allowModels, &key.DailyLimitUSD, &key.WeeklyLimitUSD,
			&createdAt, &updatedAt,
		); err != nil {
			_ = rows.Close()
			return nil, nil, false, fmt.Errorf("scan key configuration: %w", err)
		}
		if err := json.Unmarshal(modelsJSON, &key.Models); err != nil {
			_ = rows.Close()
			return nil, nil, false, fmt.Errorf("decode models for key %q: %w", key.ID, err)
		}
		key.Enabled = enabled != 0
		key.AllowModelsEndpoint = allowModels != 0
		key.CreatedAt = millisToTime(createdAt)
		key.UpdatedAt = millisToTime(updatedAt)
		keys = append(keys, key)
	}
	if err := rows.Close(); err != nil {
		return nil, nil, false, fmt.Errorf("close key configuration rows: %w", err)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, false, fmt.Errorf("iterate key configurations: %w", err)
	}

	usageRows, err := h.db.Query(`SELECT key_id, state_json FROM usage_state ORDER BY key_id`)
	if err != nil {
		return nil, nil, false, fmt.Errorf("query usage state: %w", err)
	}
	usage := make(map[string]*UsageState)
	for usageRows.Next() {
		var keyID string
		var stateJSON []byte
		if err := usageRows.Scan(&keyID, &stateJSON); err != nil {
			_ = usageRows.Close()
			return nil, nil, false, fmt.Errorf("scan usage state: %w", err)
		}
		var state UsageState
		if err := json.Unmarshal(stateJSON, &state); err != nil {
			_ = usageRows.Close()
			return nil, nil, false, fmt.Errorf("decode usage state for key %q: %w", keyID, err)
		}
		usage[keyID] = &state
	}
	if err := usageRows.Close(); err != nil {
		return nil, nil, false, fmt.Errorf("close usage state rows: %w", err)
	}
	if err := usageRows.Err(); err != nil {
		return nil, nil, false, fmt.Errorf("iterate usage state: %w", err)
	}
	return keys, usage, true, nil
}

func (h *stateDatabase) saveState(keys []KeyConfig, usage map[string]*UsageState) error {
	tx, err := h.db.Begin()
	if err != nil {
		return fmt.Errorf("begin state transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := writeStateMetadata(tx); err != nil {
		return err
	}
	if err := replaceKeyConfigs(tx, keys); err != nil {
		return err
	}
	if err := replaceUsageState(tx, usage); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit state transaction: %w", err)
	}
	return nil
}

func replaceKeyConfigs(tx *sql.Tx, keys []KeyConfig) error {
	if _, err := tx.Exec(`DELETE FROM key_configs`); err != nil {
		return fmt.Errorf("replace key configurations: %w", err)
	}
	keyStatement, err := tx.Prepare(`
		INSERT INTO key_configs (
			id, name, enabled, key_hash, key_preview, rpm, models_json,
			allow_models_endpoint, daily_limit_usd, weekly_limit_usd,
			created_at_ms, updated_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare key configuration write: %w", err)
	}
	defer keyStatement.Close()
	for _, key := range keys {
		modelsJSON, err := json.Marshal(key.Models)
		if err != nil {
			return fmt.Errorf("encode models for key %q: %w", key.ID, err)
		}
		if _, err := keyStatement.Exec(
			key.ID, key.Name, boolInt(key.Enabled), key.KeyHash, key.KeyPreview,
			key.RPM, modelsJSON, boolInt(key.AllowModelsEndpoint), key.DailyLimitUSD,
			key.WeeklyLimitUSD, timeToMillis(key.CreatedAt), timeToMillis(key.UpdatedAt),
		); err != nil {
			return fmt.Errorf("write key configuration %q: %w", key.ID, err)
		}
	}
	return nil
}

func (h *stateDatabase) saveUsage(usage map[string]*UsageState) error {
	tx, err := h.db.Begin()
	if err != nil {
		return fmt.Errorf("begin usage state transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := writeStateMetadata(tx); err != nil {
		return err
	}
	if err := replaceUsageState(tx, usage); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit usage state transaction: %w", err)
	}
	return nil
}

func writeStateMetadata(tx *sql.Tx) error {
	if _, err := tx.Exec(`
		INSERT INTO state_meta (id, schema_version, updated_at_ms)
		VALUES (1, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			schema_version = excluded.schema_version,
			updated_at_ms = excluded.updated_at_ms`,
		stateDatabaseVersion, time.Now().UTC().UnixMilli(),
	); err != nil {
		return fmt.Errorf("write state database metadata: %w", err)
	}
	return nil
}

func replaceUsageState(tx *sql.Tx, usage map[string]*UsageState) error {
	if _, err := tx.Exec(`DELETE FROM usage_state`); err != nil {
		return fmt.Errorf("replace usage state: %w", err)
	}
	statement, err := tx.Prepare(`INSERT INTO usage_state (key_id, state_json) VALUES (?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare usage state write: %w", err)
	}
	defer statement.Close()
	keyIDs := make([]string, 0, len(usage))
	for keyID := range usage {
		keyIDs = append(keyIDs, keyID)
	}
	sort.Strings(keyIDs)
	for _, keyID := range keyIDs {
		stateJSON, err := json.Marshal(usage[keyID])
		if err != nil {
			return fmt.Errorf("encode usage state for key %q: %w", keyID, err)
		}
		if _, err := statement.Exec(keyID, stateJSON); err != nil {
			return fmt.Errorf("write usage state for key %q: %w", keyID, err)
		}
	}
	return nil
}

func (h *stateDatabase) updateKeyPreview(keyID, keyHash, preview string) (bool, error) {
	tx, err := h.db.Begin()
	if err != nil {
		return false, fmt.Errorf("begin key preview transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`
		UPDATE key_configs
		SET key_preview = ?, updated_at_ms = ?
		WHERE id = ? AND key_hash = ? AND TRIM(key_preview) = ''`,
		preview, time.Now().UTC().UnixMilli(), keyID, keyHash,
	)
	if err != nil {
		return false, fmt.Errorf("persist key preview: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("inspect key preview update: %w", err)
	}
	if rows > 0 {
		if _, err := tx.Exec(`UPDATE usage_events SET key_preview = ? WHERE key_id = ? COLLATE NOCASE AND key_preview = ''`, MaskKeyPreview(preview), keyID); err != nil {
			return false, fmt.Errorf("backfill usage event key preview: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("commit key preview transaction: %w", err)
	}
	return rows > 0, nil
}

func timeToMillis(value time.Time) int64 {
	if value.IsZero() {
		return 0
	}
	return value.UTC().UnixMilli()
}

func millisToTime(value int64) time.Time {
	if value == 0 {
		return time.Time{}
	}
	return time.UnixMilli(value).UTC()
}

func (h *stateDatabase) setClock(now func() time.Time) {
	if now == nil {
		return
	}
	h.mu.Lock()
	h.now = now
	h.mu.Unlock()
}

func (h *stateDatabase) currentTime() time.Time {
	h.mu.Lock()
	now := h.now
	h.mu.Unlock()
	if now == nil {
		return time.Now().UTC()
	}
	return now().UTC()
}

func (h *stateDatabase) close() error {
	if h == nil || h.db == nil {
		return nil
	}
	if h.insertStmt != nil {
		_ = h.insertStmt.Close()
	}
	return h.db.Close()
}

func normalizeUsageEvent(event UsageEvent, now time.Time) UsageEvent {
	if event.Timestamp.IsZero() {
		event.Timestamp = now.UTC()
	} else {
		event.Timestamp = event.Timestamp.UTC()
	}
	event.KeyID = strings.TrimSpace(event.KeyID)
	event.KeyPreview = strings.TrimSpace(event.KeyPreview)
	event.Provider = strings.TrimSpace(event.Provider)
	event.Model = strings.TrimSpace(event.Model)
	event.UpstreamModel = strings.TrimSpace(event.UpstreamModel)
	event.ReasoningEffort = strings.TrimSpace(event.ReasoningEffort)
	event.ExecutorType = strings.TrimSpace(event.ExecutorType)
	event.AuthType = strings.TrimSpace(event.AuthType)
	event.AuthIndex = strings.TrimSpace(event.AuthIndex)
	event.Source = strings.TrimSpace(event.Source)
	event.ServiceTier = strings.TrimSpace(event.ServiceTier)
	if event.LatencyMS < 0 {
		event.LatencyMS = 0
	}
	if event.TTFTMS != nil {
		value := maxInt64(0, *event.TTFTMS)
		if value == 0 {
			event.TTFTMS = nil
		} else {
			event.TTFTMS = &value
		}
	}
	if event.StatusCode < 0 {
		event.StatusCode = 0
	}
	event.BillingMode = strings.TrimSpace(event.BillingMode)
	if event.TotalTokens <= 0 {
		event.TotalTokens = maxInt64(0, event.InputTokens) + maxInt64(0, event.OutputTokens)
	}
	return event
}

func usageEventArgs(event UsageEvent) []any {
	return []any{
		event.Timestamp.UnixNano(), event.KeyID, event.KeyPreview, event.Provider,
		event.Model, event.UpstreamModel, event.ReasoningEffort, event.ExecutorType,
		event.AuthType, event.AuthIndex, event.Source, event.ServiceTier,
		boolInt(event.Generate), event.LatencyMS, event.TTFTMS, event.StatusCode,
		boolInt(event.Failed), event.BillingMode, boolInt(event.CostAvailable), event.CostUSD,
		event.UncachedInputCostUSD, event.CacheReadCostUSD,
		event.CacheCreationCostUSD, event.OutputCostUSD, event.OtherCostUSD,
		event.InputTokens, event.OutputTokens, event.ReasoningTokens,
		event.CachedTokens, event.CacheReadTokens, event.CacheCreationTokens,
		event.TotalTokens,
	}
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func (h *stateDatabase) record(event UsageEvent) error {
	now := h.currentTime()
	if err := h.maybePrune(now); err != nil {
		return err
	}
	event = normalizeUsageEvent(event, now)
	if _, err := h.insertStmt.Exec(usageEventArgs(event)...); err != nil {
		return fmt.Errorf("record usage event: %w", err)
	}
	return nil
}

func (h *stateDatabase) maybePrune(now time.Time) error {
	h.mu.Lock()
	lastPrune := h.lastPrune
	if !lastPrune.IsZero() && !now.Before(lastPrune) && now.Sub(lastPrune) < usageHistoryPruneInterval {
		h.mu.Unlock()
		return nil
	}
	h.lastPrune = now
	h.mu.Unlock()
	if err := h.prune(now); err != nil {
		h.mu.Lock()
		h.lastPrune = time.Time{}
		h.mu.Unlock()
		return err
	}
	return nil
}

func (h *stateDatabase) prune(now time.Time) error {
	cutoff := now.Add(-usageHistoryRetention).UnixNano()
	if _, err := h.db.Exec(`DELETE FROM usage_events WHERE timestamp_ns < ?`, cutoff); err != nil {
		return fmt.Errorf("prune usage events: %w", err)
	}
	h.mu.Lock()
	h.lastPrune = now
	h.mu.Unlock()
	return nil
}

func (h *stateDatabase) backfillKeyPreviews(previews map[string]string) error {
	if len(previews) == 0 {
		return nil
	}
	tx, err := h.db.Begin()
	if err != nil {
		return fmt.Errorf("begin key preview backfill: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	statement, err := tx.Prepare(`UPDATE usage_events SET key_preview = ? WHERE key_id = ? COLLATE NOCASE AND key_preview = ''`)
	if err != nil {
		return fmt.Errorf("prepare key preview backfill: %w", err)
	}
	defer statement.Close()
	for keyID, preview := range previews {
		preview = strings.TrimSpace(preview)
		if preview == "" {
			continue
		}
		if _, err := statement.Exec(preview, keyID); err != nil {
			return fmt.Errorf("backfill key preview %q: %w", keyID, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit key preview backfill: %w", err)
	}
	return nil
}
