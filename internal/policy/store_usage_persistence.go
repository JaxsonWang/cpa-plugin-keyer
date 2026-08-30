package policy

import "errors"

// persistUsageEvent 将不改变额度的请求事件立即写入 SQLite，并保存可由宿主读取的持久化错误。
// database 是当前状态数据库，event 是已经完成计价判断的请求事件。
func (s *Store) persistUsageEvent(database *stateDatabase, event UsageEvent) {
	if database == nil {
		s.setHistoryError(errors.New("state database is not configured"))
		return
	}
	s.persistMu.Lock()
	// persistErr 是请求事件即时落库的结果。
	persistErr := database.record(event)
	s.persistMu.Unlock()
	s.setHistoryError(persistErr)
}

// persistUsageCost 将一次成功计价的额度状态和请求事件同步提交，并在提交成功后更新内存账本。
// database 与 ledger 是当前持久化和内存账本；event 为空时只同步额度状态；其余参数描述本次计价增量。
func (s *Store) persistUsageCost(database *stateDatabase, ledger *usageLedger, event *UsageEvent, keyID, model string, breakdown UsageCostBreakdown, outputTokens, callCount int64) {
	if ledger == nil {
		s.setHistoryError(errors.New("usage ledger is not configured"))
		return
	}
	if database == nil {
		s.setHistoryError(errors.New("state database is not configured"))
		return
	}
	s.persistMu.Lock()
	// persistErr 是额度状态与可选请求事件的原子提交结果。
	persistErr := ledger.recordCost(
		keyID,
		model,
		breakdown.TotalUSD,
		breakdown.CacheReadUSD,
		breakdown.CacheReadTokens,
		breakdown.NonCacheInputTokens,
		outputTokens,
		callCount,
		// state 是本次提交成功后应成为实时账本的完整 Key 状态。
		func(state *UsageState) error {
			return database.persistUsageEntry(keyID, state, event)
		},
	)
	s.persistMu.Unlock()
	s.setHistoryError(persistErr)
}
