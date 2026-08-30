package policy

import (
	"database/sql"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func createLegacyStateDatabase(t *testing.T, path string, extraColumns ...string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	statements := []string{
		`CREATE TABLE state_meta (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			schema_version INTEGER NOT NULL,
			updated_at_ms INTEGER NOT NULL
		)`,
		`INSERT INTO state_meta (id, schema_version, updated_at_ms) VALUES (1, 1, 0)`,
		`CREATE TABLE usage_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp_ns INTEGER NOT NULL,
			key_id TEXT NOT NULL,
			key_preview TEXT NOT NULL DEFAULT '',
			provider TEXT NOT NULL DEFAULT '',
			model TEXT NOT NULL,
			upstream_model TEXT NOT NULL DEFAULT '',
			failed INTEGER NOT NULL,
			billing_mode TEXT NOT NULL DEFAULT '',
			cost_available INTEGER NOT NULL,
			cost_usd REAL NOT NULL,
			input_tokens INTEGER NOT NULL,
			output_tokens INTEGER NOT NULL,
			reasoning_tokens INTEGER NOT NULL,
			cached_tokens INTEGER NOT NULL,
			cache_read_tokens INTEGER NOT NULL,
			cache_creation_tokens INTEGER NOT NULL,
			total_tokens INTEGER NOT NULL
		)`,
	}
	statements = append(statements, extraColumns...)
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
}

func TestOpenStateDatabaseMigratesUsageEventDetailColumns(t *testing.T) {
	now := time.Date(2026, 8, 27, 10, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "state.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	statements := []string{
		`CREATE TABLE state_meta (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			schema_version INTEGER NOT NULL,
			updated_at_ms INTEGER NOT NULL
		)`,
		`INSERT INTO state_meta (id, schema_version, updated_at_ms) VALUES (1, 1, 0)`,
		`CREATE TABLE usage_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp_ns INTEGER NOT NULL,
			key_id TEXT NOT NULL,
			key_preview TEXT NOT NULL DEFAULT '',
			provider TEXT NOT NULL DEFAULT '',
			model TEXT NOT NULL,
			upstream_model TEXT NOT NULL DEFAULT '',
			failed INTEGER NOT NULL,
			billing_mode TEXT NOT NULL DEFAULT '',
			cost_available INTEGER NOT NULL,
			cost_usd REAL NOT NULL,
			input_tokens INTEGER NOT NULL,
			output_tokens INTEGER NOT NULL,
			reasoning_tokens INTEGER NOT NULL,
			cached_tokens INTEGER NOT NULL,
			cache_read_tokens INTEGER NOT NULL,
			cache_creation_tokens INTEGER NOT NULL,
			total_tokens INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := legacy.Exec(statement); err != nil {
			_ = legacy.Close()
			t.Fatal(err)
		}
	}
	if _, err := legacy.Exec(`
		INSERT INTO usage_events (
			timestamp_ns, key_id, provider, model, failed, billing_mode,
			cost_available, cost_usd, input_tokens, output_tokens,
			reasoning_tokens, cached_tokens, cache_read_tokens,
			cache_creation_tokens, total_tokens
		) VALUES (?, 'team-a', 'codex', 'gpt-5.4', 0, 'tokens', 1, 0, 100, 20, 5, 0, 0, 0, 120)`, now.UnixNano()); err != nil {
		_ = legacy.Close()
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	database, err := openStateDatabase(path, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	defer database.close()

	var version int
	if err := database.db.QueryRow(`SELECT schema_version FROM state_meta WHERE id = 1`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != stateDatabaseVersion {
		t.Fatalf("schema version = %d, want %d", version, stateDatabaseVersion)
	}
	columns := make(map[string]bool)
	rows, err := database.db.Query(`PRAGMA table_info(usage_events)`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			t.Fatal(err)
		}
		columns[name] = true
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{
		"reasoning_effort", "executor_type", "auth_type", "auth_index", "source",
		"service_tier", "generate", "latency_ms", "ttft_ms", "status_code",
		"uncached_input_cost_usd", "cache_read_cost_usd", "cache_creation_cost_usd",
		"output_cost_usd", "other_cost_usd",
	} {
		if !columns[name] {
			t.Fatalf("migrated usage_events is missing column %q", name)
		}
	}
	events, err := database.allUsageEvents()
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].ReasoningEffort != "" || !events[0].Generate ||
		events[0].LatencyMS != 0 || events[0].TTFTMS != nil || events[0].StatusCode != 0 ||
		events[0].ExecutorType != "" || events[0].AuthType != "" || events[0].Source != "" ||
		events[0].UncachedInputCostUSD != 0 || events[0].OutputCostUSD != 0 {
		t.Fatalf("migrated events = %+v", events)
	}
	ttft := int64(425)
	if err := database.record(UsageEvent{
		Timestamp: now.Add(-time.Minute), KeyID: "team-a", Model: "gpt-5.4",
		ReasoningEffort: " xhigh ", ExecutorType: " codex ", AuthType: " apikey ",
		AuthIndex: " 2 ", Source: " openai-responses ", ServiceTier: " priority ",
		Generate: true, LatencyMS: 2_400, TTFTMS: &ttft, StatusCode: 429,
		UncachedInputCostUSD: 0.1, CacheReadCostUSD: 0.2,
		CacheCreationCostUSD: 0.3, OutputCostUSD: 0.4, OtherCostUSD: 0.5,
	}); err != nil {
		t.Fatal(err)
	}
	events, err = database.allUsageEvents()
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[1].ReasoningEffort != "xhigh" ||
		events[1].ExecutorType != "codex" || events[1].AuthType != "apikey" ||
		events[1].AuthIndex != "2" || events[1].Source != "openai-responses" ||
		events[1].ServiceTier != "priority" || !events[1].Generate ||
		events[1].LatencyMS != 2_400 || events[1].TTFTMS == nil || *events[1].TTFTMS != 425 ||
		events[1].StatusCode != 429 || events[1].UncachedInputCostUSD != 0.1 ||
		events[1].CacheReadCostUSD != 0.2 || events[1].CacheCreationCostUSD != 0.3 ||
		events[1].OutputCostUSD != 0.4 || events[1].OtherCostUSD != 0.5 {
		t.Fatalf("events after migration = %+v", events)
	}
}

func TestOpenStateDatabaseResumesPartialUsageEventMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.db")
	createLegacyStateDatabase(t, path,
		`ALTER TABLE usage_events ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE usage_events ADD COLUMN executor_type TEXT NOT NULL DEFAULT ''`,
	)

	database, err := openStateDatabase(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer database.close()

	var version int
	if err := database.db.QueryRow(`SELECT schema_version FROM state_meta WHERE id = 1`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != stateDatabaseVersion {
		t.Fatalf("schema version = %d, want %d", version, stateDatabaseVersion)
	}
}

// TestOpenStateDatabaseMigratesVersionTwoSubscriptionSchema 验证版本二数据库升级后可持久化计划绑定和模型价格；t 提供测试生命周期。
func TestOpenStateDatabaseMigratesVersionTwoSubscriptionSchema(t *testing.T) {
	// path 是本用例创建的临时 SQLite 文件路径。
	path := filepath.Join(t.TempDir(), "state.db")
	// legacy 是按版本二结构打开的原始数据库；err 表示数据库操作错误。
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	// statements 是构造版本二数据库所需的建表和元数据语句。
	statements := []string{
		`CREATE TABLE state_meta (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			schema_version INTEGER NOT NULL,
			updated_at_ms INTEGER NOT NULL
		)`,
		`INSERT INTO state_meta (id, schema_version, updated_at_ms) VALUES (1, 2, 0)`,
		`CREATE TABLE key_configs (
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
	}
	// statement 表示当前执行的版本二数据库语句。
	for _, statement := range statements {
		// err 表示当前数据库语句的执行错误。
		if _, err := legacy.Exec(statement); err != nil {
			_ = legacy.Close()
			t.Fatal(err)
		}
	}
	// err 表示关闭版本二数据库连接时发生的错误。
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	// database 是经过当前迁移逻辑重新打开的状态数据库。
	database, err := openStateDatabase(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer database.close()
	// version 保存迁移完成后的数据库结构版本。
	var version int
	// err 表示读取数据库结构版本时发生的错误。
	if err := database.db.QueryRow(`SELECT schema_version FROM state_meta WHERE id = 1`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != stateDatabaseVersion {
		t.Fatalf("schema version = %d, want %d", version, stateDatabaseVersion)
	}
	// bindingColumn 保存 Key 配置表中计划绑定列的数量。
	var bindingColumn int
	// err 表示检查计划绑定列时发生的错误。
	if err := database.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('key_configs') WHERE name = 'subscription_plan_id'`).Scan(&bindingColumn); err != nil {
		t.Fatal(err)
	}
	if bindingColumn != 1 {
		t.Fatal("subscription_plan_id column was not added")
	}
	// err 表示保存带模型价格的计划和 Key 绑定时发生的错误。
	if err := database.saveStateWithPlans(
		[]KeyConfig{{ID: "team-a", Name: "Team A", Enabled: true, SubscriptionPlanID: "standard"}},
		[]SubscriptionPlan{{ID: "standard", Name: "Standard", Models: []ModelRule{{
			Model:                    "gpt-5.4",
			InputPricePerMillion:     2.5,
			OutputPricePerMillion:    15,
			CacheReadPricePerMillion: 0.25,
		}}}},
		nil,
	); err != nil {
		t.Fatal(err)
	}
	// keys 是重载后的 Key 配置；plans 是重载后的订阅计划；initialized 表示数据库已有状态；err 表示读取错误。
	keys, plans, _, initialized, err := database.loadStateWithPlans()
	if err != nil || !initialized || len(keys) != 1 || len(plans) != 1 ||
		keys[0].SubscriptionPlanID != "standard" || plans[0].ID != "standard" ||
		len(plans[0].Models) != 1 || plans[0].Models[0].InputPricePerMillion != 2.5 ||
		plans[0].Models[0].OutputPricePerMillion != 15 || plans[0].Models[0].CacheReadPricePerMillion != 0.25 {
		t.Fatalf("migrated subscription state: keys=%+v plans=%+v initialized=%v err=%v", keys, plans, initialized, err)
	}
}

func TestOpenStateDatabaseSerializesConcurrentMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.db")
	createLegacyStateDatabase(t, path)

	start := make(chan struct{})
	errors := make(chan error, 2)
	var group sync.WaitGroup
	for range 2 {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			database, err := openStateDatabase(path, time.Now)
			if err == nil {
				err = database.close()
			}
			errors <- err
		}()
	}
	close(start)
	group.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
}
