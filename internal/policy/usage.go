package policy

import (
	"sort"
	"sync"
	"time"
)

const (
	dayWindow          = 24 * time.Hour
	weekWindow         = 7 * 24 * time.Hour
	usageFlushInterval = 15 * time.Second
)

// usageLedger tracks per-key dollar usage with a daily window (UTC midnight
// reset) and a rolling 7-day weekly window. Usage is also broken down per exact model.
//
// 它是鉴权和报表的内存读取视图；成功计价必须先与请求事件一起提交到 SQLite，
// 提交成功后才发布到该视图，因此服务器重启不会依赖后台刷新周期恢复额度。
type usageLedger struct {
	mu  sync.Mutex
	now func() time.Time
	// usage by key id; nil entry allowed when a key has no usage recorded yet.
	entries map[string]*UsageState
}

func newUsageLedger(now func() time.Time) *usageLedger {
	if now == nil {
		now = time.Now
	}
	return &usageLedger{now: now, entries: make(map[string]*UsageState)}
}

// loadFromState 使用持久化状态初始化账本，并复制所有模型维度数据以避免共享可变映射。
func (l *usageLedger) loadFromState(usage map[string]*UsageState) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = make(map[string]*UsageState, len(usage))
	// id 和 state 分别表示当前恢复的 Key ID 与额度状态。
	for id, st := range usage {
		if st == nil {
			continue
		}
		l.entries[id] = cloneUsageState(st)
	}
}

// snapshot 返回可安全用于持久化和报表计算的完整深拷贝。
func (l *usageLedger) snapshot() map[string]*UsageState {
	l.mu.Lock()
	defer l.mu.Unlock()
	// out 保存与实时账本互不共享映射的额度快照。
	out := make(map[string]*UsageState, len(l.entries))
	// id 和 state 分别表示当前复制的 Key ID 与额度状态。
	for id, st := range l.entries {
		if st == nil {
			continue
		}
		out[id] = cloneUsageState(st)
	}
	return out
}

// cloneUsageState 深拷贝 state，确保 ByAlias 不与调用方共享底层映射。
// state 是待复制的额度状态，返回值是可独立修改的副本。
func cloneUsageState(state *UsageState) *UsageState {
	if state == nil {
		return &UsageState{ByAlias: make(map[string]AliasUsageWindows)}
	}
	// cloned 是额度窗口及模型统计的独立副本。
	cloned := *state
	cloned.ByAlias = make(map[string]AliasUsageWindows, len(state.ByAlias))
	// model 和 windows 分别表示模型名与该模型的日、周额度窗口。
	for model, windows := range state.ByAlias {
		cloned.ByAlias[model] = windows
	}
	return &cloned
}

// ensureDailyWindow resets the daily window if we crossed UTC midnight since it
// last started. Caller must hold the mutex.
func (l *usageLedger) ensureDailyWindowLocked(st *UsageState, now time.Time) {
	startOfDay := now.UTC().Truncate(dayWindow)
	if st.Daily.WindowStart.IsZero() || !sameDay(st.Daily.WindowStart, startOfDay) {
		st.Daily = UsageWindow{WindowStart: startOfDay}
	}
}

func (l *usageLedger) ensureWeeklyWindowLocked(st *UsageState, now time.Time) {
	// Rolling window: if the recorded start is older than 7 days, slide it
	// forward so only the trailing 7 days count. We drop the accumulated total
	// and reset the window to now (conservative — losing usage that aged out
	// rather than recomputing partial slices; acceptable for an over-quota guard).
	if st.Weekly.WindowStart.IsZero() || now.Sub(st.Weekly.WindowStart) >= weekWindow {
		st.Weekly = UsageWindow{WindowStart: now.UTC()}
	}
}

// ensureModelWindow applies the same window logic to a per-model daily/weekly slice.
func (l *usageLedger) ensureModelWindowLocked(w *UsageWindow, daily bool, now time.Time) {
	if daily {
		startOfDay := now.UTC().Truncate(dayWindow)
		if w.WindowStart.IsZero() || !sameDay(w.WindowStart, startOfDay) {
			*w = UsageWindow{WindowStart: startOfDay}
		}
		return
	}
	if w.WindowStart.IsZero() || now.Sub(w.WindowStart) >= weekWindow {
		*w = UsageWindow{WindowStart: now.UTC()}
	}
}

func sameDay(a, b time.Time) bool {
	a = a.UTC()
	b = b.UTC()
	return a.Year() == b.Year() && a.Month() == b.Month() && a.Day() == b.Day()
}

// RecordCost 将一次请求的金额、Token 和调用次数写入内存账本。
// id 与 model 标识 Key 和模型；amount 与 cacheCost 是总成本和缓存成本；其余参数是本次请求的统计增量。
func (l *usageLedger) RecordCost(id, model string, amount, cacheCost float64, cacheReadTokens, inputTokens, outputTokens int64, callCount int64) {
	_ = l.recordCost(id, model, amount, cacheCost, cacheReadTokens, inputTokens, outputTokens, callCount, nil)
}

// recordCost 先构造下一份额度状态，在 persist 成功后才替换实时账本，从而保持内存与 SQLite 一致。
// persist 接收本次提交后的完整 Key 状态；为空时只更新内存，返回值表示持久化是否成功。
func (l *usageLedger) recordCost(id, model string, amount, cacheCost float64, cacheReadTokens, inputTokens, outputTokens int64, callCount int64, persist func(*UsageState) error) error {
	if id == "" {
		return nil
	}
	// now 是日、周窗口推进使用的统一时间。
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	// state 是基于当前账本生成、尚未对实时读取生效的下一状态。
	state := cloneUsageState(l.entries[id])
	l.applyCostLocked(state, model, amount, cacheCost, cacheReadTokens, inputTokens, outputTokens, callCount, now)
	if persist != nil {
		if err := persist(state); err != nil {
			return err
		}
	}
	l.entries[id] = state
	return nil
}

// applyCostLocked 把一次请求的统计增量应用到 state；调用方必须持有账本互斥锁。
// state 是待更新状态，now 是窗口判断时间，其余参数描述本次请求的金额和 Token 增量。
func (l *usageLedger) applyCostLocked(state *UsageState, model string, amount, cacheCost float64, cacheReadTokens, inputTokens, outputTokens int64, callCount int64, now time.Time) {
	// st 是为了保持以下窗口更新表达紧凑而使用的状态别名。
	st := state
	l.ensureDailyWindowLocked(st, now)
	l.ensureWeeklyWindowLocked(st, now)
	st.Daily.TotalUSD = normalizePrice(st.Daily.TotalUSD + amount)
	st.Weekly.TotalUSD = normalizePrice(st.Weekly.TotalUSD + amount)
	st.Daily.CallCount += callCount
	st.Weekly.CallCount += callCount
	if cacheReadTokens > 0 {
		st.Daily.CacheReadTokens += cacheReadTokens
		st.Weekly.CacheReadTokens += cacheReadTokens
	}
	if cacheCost > 0 {
		st.Daily.CacheCostUSD = normalizePrice(st.Daily.CacheCostUSD + cacheCost)
		st.Weekly.CacheCostUSD = normalizePrice(st.Weekly.CacheCostUSD + cacheCost)
	}
	if inputTokens > 0 {
		st.Daily.InputTokens += inputTokens
		st.Weekly.InputTokens += inputTokens
	}
	if outputTokens > 0 {
		st.Daily.OutputTokens += outputTokens
		st.Weekly.OutputTokens += outputTokens
	}

	// modelEntry 是当前模型在日、周窗口内的额度和 Token 统计。
	modelEntry := st.ByAlias[model]
	l.ensureModelWindowLocked(&modelEntry.Daily, true, now)
	l.ensureModelWindowLocked(&modelEntry.Weekly, false, now)
	modelEntry.Daily.TotalUSD = normalizePrice(modelEntry.Daily.TotalUSD + amount)
	modelEntry.Weekly.TotalUSD = normalizePrice(modelEntry.Weekly.TotalUSD + amount)
	modelEntry.Daily.CallCount += callCount
	modelEntry.Weekly.CallCount += callCount
	modelEntry.Daily.CacheReadTokens += cacheReadTokens
	modelEntry.Weekly.CacheReadTokens += cacheReadTokens
	modelEntry.Daily.CacheCostUSD = normalizePrice(modelEntry.Daily.CacheCostUSD + cacheCost)
	modelEntry.Weekly.CacheCostUSD = normalizePrice(modelEntry.Weekly.CacheCostUSD + cacheCost)
	modelEntry.Daily.InputTokens += inputTokens
	modelEntry.Weekly.InputTokens += inputTokens
	modelEntry.Daily.OutputTokens += outputTokens
	modelEntry.Weekly.OutputTokens += outputTokens
	st.ByAlias[model] = modelEntry
}

// UsageSummary is what the keys-list API reports for a key. The cache fields are
// reported for both the daily and weekly windows so the UI can show today's and
// the rolling-week's cache spend / hit-rate. CacheHitRate is not serialized
// here; the UI derives it as cacheRead / (cacheRead + input).
type UsageSummary struct {
	DailyUSD              float64   `json:"daily_usd"`
	WeeklyUSD             float64   `json:"weekly_usd"`
	DailyLimitUSD         float64   `json:"daily_limit_usd"`
	WeeklyLimitUSD        float64   `json:"weekly_limit_usd"`
	DailyResetAt          time.Time `json:"daily_reset_at,omitempty"`
	WeeklyResetAt         time.Time `json:"weekly_reset_at,omitempty"`
	DailyCacheCostUSD     float64   `json:"daily_cache_cost_usd,omitempty"`
	WeeklyCacheCostUSD    float64   `json:"weekly_cache_cost_usd,omitempty"`
	DailyCacheReadTokens  int64     `json:"daily_cache_read_tokens,omitempty"`
	WeeklyCacheReadTokens int64     `json:"weekly_cache_read_tokens,omitempty"`
	DailyInputTokens      int64     `json:"daily_input_tokens,omitempty"`
	WeeklyInputTokens     int64     `json:"weekly_input_tokens,omitempty"`
	// DailyCallCount / WeeklyCallCount: number of successful requests billed
	// into the window (token-billed or per-call). Failed requests don't count.
	// Reported for display only; not used for limit enforcement.
	DailyCallCount  int64 `json:"daily_call_count,omitempty"`
	WeeklyCallCount int64 `json:"weekly_call_count,omitempty"`
}

// Summary returns the current usage + limits for a key. Limits come from the
// KeyConfig; usage from the ledger. daily_reset_at = next UTC midnight;
// weekly_reset_at = window start + 7 days.
func (l *usageLedger) Summary(key KeyConfig) UsageSummary {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	st := l.entries[key.ID]
	summary := UsageSummary{
		DailyLimitUSD:  key.DailyLimitUSD,
		WeeklyLimitUSD: key.WeeklyLimitUSD,
		DailyResetAt:   now.UTC().Truncate(dayWindow).Add(dayWindow),
	}
	if st == nil {
		return summary
	}
	// Re-evaluate windows on read so a report never shows stale totals from a
	// window that already aged out.
	ensureSt := *st
	if ensureSt.ByAlias == nil {
		ensureSt.ByAlias = make(map[string]AliasUsageWindows)
	}
	l.ensureDailyWindowLocked(&ensureSt, now)
	l.ensureWeeklyWindowLocked(&ensureSt, now)
	summary.DailyUSD = ensureSt.Daily.TotalUSD
	summary.WeeklyUSD = ensureSt.Weekly.TotalUSD
	summary.DailyCacheCostUSD = ensureSt.Daily.CacheCostUSD
	summary.WeeklyCacheCostUSD = ensureSt.Weekly.CacheCostUSD
	summary.DailyCacheReadTokens = ensureSt.Daily.CacheReadTokens
	summary.WeeklyCacheReadTokens = ensureSt.Weekly.CacheReadTokens
	summary.DailyInputTokens = ensureSt.Daily.InputTokens
	summary.WeeklyInputTokens = ensureSt.Weekly.InputTokens
	summary.DailyCallCount = ensureSt.Daily.CallCount
	summary.WeeklyCallCount = ensureSt.Weekly.CallCount
	if !ensureSt.Weekly.WindowStart.IsZero() {
		summary.WeeklyResetAt = ensureSt.Weekly.WindowStart.Add(weekWindow)
	}
	return summary
}

// OverLimit reports whether a key is over its daily or weekly dollar limit.
// Returns the reason ("daily_exceeded"/"weekly_exceeded") and the offending
// summary when over; "" and zero summary otherwise.
func (l *usageLedger) OverLimit(key KeyConfig) (string, UsageSummary) {
	if key.DailyLimitUSD <= 0 && key.WeeklyLimitUSD <= 0 {
		return "", UsageSummary{}
	}
	s := l.Summary(key)
	if key.DailyLimitUSD > 0 && s.DailyUSD >= key.DailyLimitUSD {
		return "daily_exceeded", s
	}
	if key.WeeklyLimitUSD > 0 && s.WeeklyUSD >= key.WeeklyLimitUSD {
		return "weekly_exceeded", s
	}
	return "", UsageSummary{}
}

// resetUsage clears usage for a key (manual unlock) in memory only.
func (l *usageLedger) resetUsage(id string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, id)
}

// resetAllUsage clears every daily, weekly, per-model, and cache usage bucket.
func (l *usageLedger) resetAllUsage() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = make(map[string]*UsageState)
}

// ModelUsageEntry is one row of the exact-model usage breakdown returned by
// the key detail API.
type ModelUsageEntry struct {
	Model       string      `json:"model"`
	BillingMode string      `json:"billing_mode,omitempty"`
	PerCallUSD  float64     `json:"per_call_usd,omitempty"`
	InConfig    bool        `json:"in_config"`
	Daily       UsageWindow `json:"daily"`
	Weekly      UsageWindow `json:"weekly"`
}

// ModelUsage returns a per-model usage breakdown for a key: configured models
// (zero values when unused) merged with ledger residuals (models that have
// historical usage but are no longer in the key's config, InConfig=false).
// Windows are re-evaluated on read so an aged-out weekly total resets for
// display (the read does not mutate the ledger; the next write commits the
// reset, mirroring Summary). Rows are sorted by alias for stable display.
func (l *usageLedger) ModelUsage(key KeyConfig) []ModelUsageEntry {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()

	byModel := make(map[string]ModelUsageEntry, len(key.Models))
	for _, rule := range key.Models {
		byModel[rule.Model] = ModelUsageEntry{
			Model:       rule.Model,
			BillingMode: rule.BillingMode,
			PerCallUSD:  rule.PerCallUSD,
			InConfig:    true,
		}
	}

	if st := l.entries[key.ID]; st != nil {
		for model, w := range st.ByAlias {
			// Re-evaluate windows on a local copy so a stale weekly total resets
			// for display without mutating the ledger.
			l.ensureModelWindowLocked(&w.Daily, true, now)
			l.ensureModelWindowLocked(&w.Weekly, false, now)
			entry, ok := byModel[model]
			if !ok {
				entry = ModelUsageEntry{Model: model, InConfig: false}
			}
			entry.Daily = w.Daily
			entry.Weekly = w.Weekly
			byModel[model] = entry
		}
	}

	out := make([]ModelUsageEntry, 0, len(byModel))
	for _, entry := range byModel {
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Model < out[j].Model })
	return out
}
