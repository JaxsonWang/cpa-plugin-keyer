package policy

import (
	"net/http"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// TestRecordUsagePersistsQuotaAndEventBeforeReturn 验证 RecordUsage 返回前已同时持久化额度和事件；t 提供测试生命周期。
func TestRecordUsagePersistsQuotaAndEventBeforeReturn(t *testing.T) {
	// now 是两次 Store 实例使用的固定数据库时钟。
	now := time.Date(2026, 8, 30, 16, 0, 0, 0, time.UTC)
	// path 是两个 Store 共享的 SQLite 状态文件。
	path := filepath.Join(t.TempDir(), "state.db")
	// first 模拟仍在运行、尚未刷新和关闭的插件实例。
	first := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))
	// cost 是本次请求计算出的美元成本。
	cost := first.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, UsageDetail{
		Provider:     "openai",
		InputTokens:  1_000_000,
		OutputTokens: 500_000,
	})
	if !nearly(cost, 6) {
		t.Fatalf("cost = %v, want 6", cost)
	}
	if err := first.UsageStoreError(); err != nil {
		t.Fatalf("synchronous persistence failed: %v", err)
	}

	// second 模拟服务器在没有等待后台刷新时立即重启后的新插件实例。
	second := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))
	// summary 是新实例直接从 SQLite 恢复出的额度汇总。
	summary := second.UsageSummaryFor(second.Keys()[0])
	if !nearly(summary.DailyUSD, 6) || !nearly(summary.WeeklyUSD, 6) || summary.DailyCallCount != 1 {
		t.Fatalf("usage after immediate restart = %+v, want one $6 call", summary)
	}
	// page 是新实例读取到的请求事件页。
	page := mustUsageEvents(t, second, UsageHistoryFilter{KeyID: "team-a"}, 1, 100)
	if page.Total != 1 || len(page.Events) != 1 || !nearly(page.Events[0].CostUSD, 6) {
		t.Fatalf("events after immediate restart = %+v, want one $6 event", page)
	}
}

// TestStateDatabaseUsesFullSynchronousDurability 验证 SQLite 提交会同步 WAL 以承受系统级重启；t 提供测试生命周期。
func TestStateDatabaseUsesFullSynchronousDurability(t *testing.T) {
	// now 是数据库连接初始化使用的固定时钟。
	now := time.Date(2026, 8, 30, 16, 15, 0, 0, time.UTC)
	// path 是本次持久性配置测试的 SQLite 文件。
	path := filepath.Join(t.TempDir(), "state.db")
	// store 是待检查 SQLite 同步级别的插件实例。
	store := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))
	// synchronous 是 SQLite 当前连接返回的同步级别，2 表示 FULL。
	var synchronous int
	if err := store.runtimeHistory().db.QueryRow(`PRAGMA synchronous`).Scan(&synchronous); err != nil {
		t.Fatal(err)
	}
	if synchronous != 2 {
		t.Fatalf("PRAGMA synchronous = %d, want FULL(2)", synchronous)
	}
}

// TestRecordUsageCommitsConcurrentCostsBeforeReturn 验证并发请求逐笔同步提交且重启后没有遗漏；t 提供测试生命周期。
func TestRecordUsageCommitsConcurrentCostsBeforeReturn(t *testing.T) {
	// now 是并发请求和重启恢复共用的固定时钟。
	now := time.Date(2026, 8, 30, 16, 30, 0, 0, time.UTC)
	// path 是并发写入和恢复读取共用的 SQLite 文件。
	path := filepath.Join(t.TempDir(), "state.db")
	// first 是接收并发计价请求的插件实例。
	first := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))
	// requestCount 是本次并发回归测试写入的请求总数。
	const requestCount = 25
	// workers 等待所有并发 RecordUsage 调用完成。
	var workers sync.WaitGroup
	workers.Add(requestCount)
	// index 表示当前启动的并发请求序号。
	for index := 0; index < requestCount; index++ {
		go func() {
			defer workers.Done()
			first.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, UsageDetail{
				Provider:    "openai",
				InputTokens: 100_000,
			})
		}()
	}
	workers.Wait()
	if err := first.UsageStoreError(); err != nil {
		t.Fatalf("concurrent synchronous persistence failed: %v", err)
	}

	// second 模拟全部请求刚返回后立即启动的新插件实例。
	second := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))
	// summary 是新实例恢复的并发请求额度汇总。
	summary := second.UsageSummaryFor(second.Keys()[0])
	if !nearly(summary.DailyUSD, 5) || summary.DailyCallCount != requestCount {
		t.Fatalf("concurrent usage after restart = %+v, want %d calls and $5", summary, requestCount)
	}
	// page 是新实例读取的全部并发请求事件。
	page := mustUsageEvents(t, second, UsageHistoryFilter{KeyID: "team-a"}, 1, 100)
	if page.Total != requestCount || len(page.Events) != requestCount {
		t.Fatalf("concurrent events = %d/%d, want %d", page.Total, len(page.Events), requestCount)
	}
}

// TestRecordUsageDoesNotPublishMemoryStateWhenTransactionFails 验证事务失败时不会只更新内存形成第二份账本；t 提供测试生命周期。
func TestRecordUsageDoesNotPublishMemoryStateWhenTransactionFails(t *testing.T) {
	// now 是事务失败场景使用的固定时钟。
	now := time.Date(2026, 8, 30, 17, 0, 0, 0, time.UTC)
	// path 是本次失败场景的 SQLite 文件。
	path := filepath.Join(t.TempDir(), "state.db")
	// store 是待关闭底层数据库后执行计价的插件实例。
	store := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))
	// database 是用于制造明确事务失败的当前数据库连接。
	database := store.runtimeHistory()
	if err := database.close(); err != nil {
		t.Fatal(err)
	}
	// cost 仍表示纯计算得到的请求价格，持久化结果由 UsageStoreError 暴露。
	cost := store.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, UsageDetail{
		Provider:    "openai",
		InputTokens: 1_000_000,
	})
	if !nearly(cost, 2) {
		t.Fatalf("cost = %v, want 2", cost)
	}
	if err := store.UsageStoreError(); err == nil {
		t.Fatal("RecordUsage did not expose the SQLite transaction failure")
	}
	// summary 是事务失败后的实时内存额度，必须保持提交前状态。
	summary := store.UsageSummaryFor(store.Keys()[0])
	if summary.DailyUSD != 0 || summary.DailyCallCount != 0 {
		t.Fatalf("memory usage changed after failed transaction: %+v", summary)
	}
}

// TestRecordUsageRollsBackQuotaWhenEventInsertFails 验证事件插入失败会回滚同一事务中的额度写入；t 提供测试生命周期。
func TestRecordUsageRollsBackQuotaWhenEventInsertFails(t *testing.T) {
	// now 是事务回滚场景使用的固定时钟。
	now := time.Date(2026, 8, 30, 17, 15, 0, 0, time.UTC)
	// path 是本次事务回滚场景的 SQLite 文件。
	path := filepath.Join(t.TempDir(), "state.db")
	// store 是安装事件拒绝触发器后执行计价的插件实例。
	store := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))
	// database 是创建测试触发器和读取持久化状态的当前数据库。
	database := store.runtimeHistory()
	if _, err := database.db.Exec(`
		CREATE TRIGGER reject_usage_event
		BEFORE INSERT ON usage_events
		BEGIN
			SELECT RAISE(ABORT, 'reject usage event');
		END`); err != nil {
		t.Fatal(err)
	}
	store.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, UsageDetail{
		Provider:    "openai",
		InputTokens: 1_000_000,
	})
	if err := store.UsageStoreError(); err == nil {
		t.Fatal("RecordUsage did not expose the event insert failure")
	}
	// summary 是事件插入失败后的实时内存额度。
	summary := store.UsageSummaryFor(store.Keys()[0])
	if summary.DailyUSD != 0 || summary.DailyCallCount != 0 {
		t.Fatalf("memory usage changed after rolled-back transaction: %+v", summary)
	}
	// persistedCount 是 SQLite 中 team-a 额度行的数量。
	var persistedCount int
	if err := database.db.QueryRow(`SELECT COUNT(*) FROM usage_state WHERE key_id = ?`, "team-a").Scan(&persistedCount); err != nil {
		t.Fatal(err)
	}
	if persistedCount != 0 {
		t.Fatalf("persisted usage rows = %d, want 0 after rollback", persistedCount)
	}
}

// TestCacheOnlyUsageIsPricedAndPersisted 验证纯缓存读取请求仍会计价并同步到 SQLite；t 提供测试生命周期。
func TestCacheOnlyUsageIsPricedAndPersisted(t *testing.T) {
	// now 是纯缓存计价和重启恢复共用的固定时钟。
	now := time.Date(2026, 8, 30, 17, 30, 0, 0, time.UTC)
	// path 是纯缓存计价场景的 SQLite 文件。
	path := filepath.Join(t.TempDir(), "state.db")
	// first 是接收纯缓存 Token 请求的插件实例。
	first := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))
	// cost 是一百万缓存读取 Token 按每百万 0.2 美元计算的成本。
	cost := first.RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, UsageDetail{
		Provider:        "claude",
		CacheReadTokens: 1_000_000,
		TotalTokens:     1_000_000,
	})
	if !nearly(cost, 0.2) {
		t.Fatalf("cache-only cost = %v, want 0.2", cost)
	}
	if err := first.UsageStoreError(); err != nil {
		t.Fatalf("cache-only persistence failed: %v", err)
	}

	// second 模拟纯缓存请求返回后立即重启的插件实例。
	second := newHistoryStore(t, path, &now, PreviewKey("cpa_history_secret"))
	// summary 是从 SQLite 恢复的纯缓存额度统计。
	summary := second.UsageSummaryFor(second.Keys()[0])
	if !nearly(summary.DailyUSD, 0.2) || !nearly(summary.DailyCacheCostUSD, 0.2) || summary.DailyCacheReadTokens != 1_000_000 || summary.DailyCallCount != 1 {
		t.Fatalf("cache-only usage after restart = %+v", summary)
	}
	// page 是持久化后的纯缓存请求事件。
	page := mustUsageEvents(t, second, UsageHistoryFilter{KeyID: "team-a"}, 1, 100)
	if page.Total != 1 || !nearly(page.Events[0].CostUSD, 0.2) || page.Events[0].CacheReadTokens != 1_000_000 {
		t.Fatalf("cache-only event after restart = %+v", page)
	}
}

// TestUsageStateCopiesDoNotShareModelMaps 验证恢复输入和持久化快照都不会共享模型统计映射；t 提供测试生命周期。
func TestUsageStateCopiesDoNotShareModelMaps(t *testing.T) {
	// now 是账本窗口使用的固定时钟。
	now := time.Date(2026, 8, 30, 18, 0, 0, 0, time.UTC)
	// source 是用于初始化账本的持久化状态。
	source := map[string]*UsageState{
		"team-a": {
			Daily: UsageWindow{TotalUSD: 1},
			ByAlias: map[string]AliasUsageWindows{
				"gpt-5.4": {Daily: UsageWindow{TotalUSD: 1}},
			},
		},
	}
	// ledger 是从 source 深拷贝恢复的实时额度账本。
	ledger := newUsageLedger(func() time.Time { return now })
	ledger.loadFromState(source)
	// changedSource 是只写回 source 的模型窗口值。
	changedSource := source["team-a"].ByAlias["gpt-5.4"]
	changedSource.Daily.TotalUSD = 99
	source["team-a"].ByAlias["gpt-5.4"] = changedSource
	// firstSnapshot 是修改 source 后取得的实时账本快照。
	firstSnapshot := ledger.snapshot()
	if firstSnapshot["team-a"].ByAlias["gpt-5.4"].Daily.TotalUSD != 1 {
		t.Fatalf("loaded ledger shared source map: %+v", firstSnapshot)
	}
	// changedSnapshot 是只写回 firstSnapshot 的模型窗口值。
	changedSnapshot := firstSnapshot["team-a"].ByAlias["gpt-5.4"]
	changedSnapshot.Daily.TotalUSD = 77
	firstSnapshot["team-a"].ByAlias["gpt-5.4"] = changedSnapshot
	// secondSnapshot 用于确认前一份快照没有反向修改实时账本。
	secondSnapshot := ledger.snapshot()
	if secondSnapshot["team-a"].ByAlias["gpt-5.4"].Daily.TotalUSD != 1 {
		t.Fatalf("snapshot shared live ledger map: %+v", secondSnapshot)
	}
}

// TestUsageCostPrecisionBlocksAtExactLimit 验证十次 0.1 美元计价会得到精确 1 美元并触发额度限制；t 提供测试生命周期。
func TestUsageCostPrecisionBlocksAtExactLimit(t *testing.T) {
	// now 是精度边界和重启恢复共用的固定时钟。
	now := time.Date(2026, 8, 30, 18, 15, 0, 0, time.UTC)
	// path 是精度边界场景的 SQLite 文件。
	path := filepath.Join(t.TempDir(), "state.db")
	// secret 是本次测试的下游明文 Key，仅存在于测试进程。
	secret := "cpa_precision_limit"
	// hash 是 secret 对应的持久化哈希。
	hash := hashForUsageTest(t, secret)
	// createStore 创建共享同一 SQLite 文件的插件实例。
	createStore := func() *Store {
		// store 是当前创建并配置的精度测试实例。
		store := NewStore()
		store.SetClock(func() time.Time { return now })
		if err := store.Configure(Config{
			Enabled:   true,
			StateFile: path,
			Keys: []KeyConfig{{
				ID: "precision", Enabled: true, KeyHash: hash, DailyLimitUSD: 1,
				Models: []ModelRule{{Model: "image", BillingMode: "per_call", PerCallUSD: 0.1}},
			}},
		}); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = store.Close() })
		return store
	}
	// first 是连续写入十次 0.1 美元请求的实例。
	first := createStore()
	// index 表示当前写入的按次计价请求序号。
	for index := 0; index < 10; index++ {
		first.RecordUsage("precision", "image", "image", false, UsageDetail{})
	}
	// firstSummary 是十次计价后的实时额度汇总。
	firstSummary := first.UsageSummaryFor(first.Keys()[0])
	if firstSummary.DailyUSD != 1 {
		t.Fatalf("daily usage = %.17f, want exact 1", firstSummary.DailyUSD)
	}
	// headers 是额度鉴权使用的下游 Key 请求头。
	headers := http.Header{"Authorization": {"Bearer " + secret}}
	// decision 是达到精确额度边界后的鉴权结果。
	decision := first.Authenticate("POST", "/v1/images/generations", headers, nil, []byte(`{"model":"image"}`))
	if decision.Allowed || decision.Reason != "daily_exceeded" {
		t.Fatalf("decision at exact limit = %+v, want daily_exceeded", decision)
	}
	// second 模拟第十次请求返回后立即重启的新实例。
	second := createStore()
	// secondSummary 是从 SQLite 恢复出的精确额度汇总。
	secondSummary := second.UsageSummaryFor(second.Keys()[0])
	if secondSummary.DailyUSD != 1 || secondSummary.DailyCallCount != 10 {
		t.Fatalf("usage after restart = %+v, want exact $1 and 10 calls", secondSummary)
	}
}

// TestStatusUsesEffectiveSubscriptionLimits 验证状态接口使用订阅计划生效后的额度；t 提供测试生命周期。
func TestStatusUsesEffectiveSubscriptionLimits(t *testing.T) {
	// now 是订阅计划有效期判断使用的固定时钟。
	now := time.Date(2026, 8, 30, 18, 30, 0, 0, time.UTC)
	// hash 是测试 Key 的持久化哈希。
	hash := hashForUsageTest(t, "cpa_plan_status")
	// store 是基础额度为零、绑定有效订阅计划的插件实例。
	store := NewStore()
	store.SetClock(func() time.Time { return now })
	if err := store.Configure(Config{
		Enabled:   true,
		StateFile: filepath.Join(t.TempDir(), "state.db"),
		Keys: []KeyConfig{{
			ID: "team-a", Enabled: true, KeyHash: hash, SubscriptionPlanID: "cat-plan",
			Models: []ModelRule{{Model: "base"}},
		}},
		SubscriptionPlans: []SubscriptionPlan{{
			ID: "cat-plan", Name: "Cat", RPM: 10,
			Models: []ModelRule{{Model: "gpt-5.4"}}, WeeklyLimitUSD: 100,
			ExpiresAt: now.Add(time.Hour),
		}},
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	// status 是管理状态接口返回的完整状态对象。
	status := store.Status()
	// usage 是状态接口按 Key 返回的额度汇总。
	usage := status["usage"].(map[string]UsageSummary)
	if usage["team-a"].WeeklyLimitUSD != 100 {
		t.Fatalf("status weekly limit = %v, want effective plan limit 100", usage["team-a"].WeeklyLimitUSD)
	}
}
