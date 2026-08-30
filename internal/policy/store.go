package policy

import (
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type Store struct {
	mu         sync.RWMutex
	updateMu   sync.Mutex
	persistMu  sync.Mutex
	enabled    bool
	statePath  string
	keys       map[string]*KeyConfig
	keysByHash map[string]*KeyConfig
	plans      map[string]*SubscriptionPlan
	limiter    *RateLimiter
	usage      *usageLedger
	database   *stateDatabase
	now        func() time.Time
	historyErr error
	flusher    *usageFlusher
}

type AuthDecision struct {
	Known       bool
	Allowed     bool
	KeyID       string
	Principal   string
	Requested   string
	Rule        ModelRule
	Reason      string
	ModelList   bool
	RateLimited bool
	CostLimited bool
	PreCharged  bool
}

func NewStore() *Store {
	return &Store{
		enabled:    DefaultConfig().Enabled,
		keys:       make(map[string]*KeyConfig),
		keysByHash: make(map[string]*KeyConfig),
		plans:      make(map[string]*SubscriptionPlan),
		limiter:    NewRateLimiter(),
		usage:      newUsageLedger(time.Now),
		now:        time.Now,
	}
}

func (s *Store) SetClock(now func() time.Time) {
	if now == nil {
		return
	}
	s.mu.Lock()
	s.now = now
	s.limiter = NewRateLimiterWithClock(now)
	s.usage = newUsageLedger(now)
	if s.database != nil {
		s.database.setClock(now)
	}
	s.mu.Unlock()
}

// Configure 从 cfg 初始化或重新加载 SQLite 状态，并阻止计价事务跨越数据库切换边界。
// cfg 是插件配置，返回值表示配置校验、状态加载或持久化是否成功。
func (s *Store) Configure(cfg Config) error {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	if err := normalizeConfig(&cfg); err != nil {
		return err
	}
	statePath, err := ResolveStatePath(cfg.StateFile)
	if err != nil {
		return err
	}

	// Persist usage to the previous state file before replacing the in-memory
	// store. This keeps reconfigure from losing the latest accounting window.
	if err := s.StopUsageFlusher(); err != nil {
		return fmt.Errorf("flush previous state database: %w", err)
	}
	s.persistMu.Lock()
	defer s.persistMu.Unlock()

	s.mu.RLock()
	clockNow := s.now
	s.mu.RUnlock()
	if clockNow == nil {
		clockNow = time.Now
	}
	database, err := openStateDatabase(statePath, clockNow)
	if err != nil {
		return err
	}
	keys, plans, loadedUsage, initialized, err := database.loadStateWithPlans()
	if err != nil {
		_ = database.close()
		return err
	}
	if !initialized {
		keys = cfg.Keys
		plans = cfg.SubscriptionPlans
		loadedUsage = make(map[string]*UsageState)
	}
	loadedConfig := Config{
		Enabled:           cfg.Enabled,
		StateFile:         cfg.StateFile,
		Keys:              keys,
		SubscriptionPlans: plans,
	}
	if err := normalizeConfig(&loadedConfig); err != nil {
		_ = database.close()
		return fmt.Errorf("load state database: %w", err)
	}
	keys = loadedConfig.Keys
	plans = loadedConfig.SubscriptionPlans

	next := make(map[string]*KeyConfig, len(keys))
	preparedKeys := make([]KeyConfig, 0, len(keys))
	nextPlans := make(map[string]*SubscriptionPlan, len(plans))
	preparedPlans := make([]SubscriptionPlan, 0, len(plans))
	maskedPreviews := make(map[string]string, len(keys))
	now := clockNow().UTC()
	for i := range keys {
		item := keys[i]
		if item.CreatedAt.IsZero() {
			item.CreatedAt = now
		}
		if item.UpdatedAt.IsZero() {
			item.UpdatedAt = item.CreatedAt
		}
		next[item.ID] = &item
		preparedKeys = append(preparedKeys, item)
		maskedPreviews[strings.ToLower(item.ID)] = MaskKeyPreview(item.KeyPreview)
	}
	for i := range plans {
		item := plans[i]
		if item.CreatedAt.IsZero() {
			item.CreatedAt = now
		}
		if item.UpdatedAt.IsZero() {
			item.UpdatedAt = item.CreatedAt
		}
		nextPlans[item.ID] = copySubscriptionPlan(&item)
		preparedPlans = append(preparedPlans, item)
	}
	sort.Slice(preparedKeys, func(i, j int) bool { return preparedKeys[i].ID < preparedKeys[j].ID })
	sort.Slice(preparedPlans, func(i, j int) bool { return preparedPlans[i].ID < preparedPlans[j].ID })
	nextUsage := newUsageLedger(clockNow)
	nextUsage.loadFromState(loadedUsage)
	if err := database.saveStateWithPlans(preparedKeys, preparedPlans, nextUsage.snapshot()); err != nil {
		_ = database.close()
		if !initialized {
			return fmt.Errorf("seed state database: %w", err)
		}
		return fmt.Errorf("normalize state database: %w", err)
	}
	if err := database.backfillKeyPreviews(maskedPreviews); err != nil {
		_ = database.close()
		return err
	}

	s.mu.Lock()
	oldDatabase := s.database
	s.enabled = cfg.Enabled
	s.statePath = statePath
	s.keys = next
	s.plans = nextPlans
	s.rebuildKeysByHashLocked()
	if s.limiter == nil {
		s.limiter = NewRateLimiter()
	}
	s.usage = nextUsage
	s.database = database
	s.historyErr = nil
	s.mu.Unlock()
	if oldDatabase != nil {
		_ = oldDatabase.close()
	}
	return nil
}

func (s *Store) Enabled() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.enabled
}

func (s *Store) runtimeComponents() (*RateLimiter, *usageLedger) {
	s.mu.RLock()
	limiter := s.limiter
	usage := s.usage
	s.mu.RUnlock()
	return limiter, usage
}

func (s *Store) runtimeHistory() *stateDatabase {
	s.mu.RLock()
	history := s.database
	s.mu.RUnlock()
	return history
}

func (s *Store) StatePath() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.statePath
}

// AuthenticateKey validates only the downstream credential identity. Model,
// RPM and budget policy is deliberately deferred to AuthorizeModel so a valid
// key that exceeds a policy limit remains authenticated and can receive the
// real 403/429 policy response from request interception.
func (s *Store) AuthenticateKey(headers http.Header, query map[string][]string) AuthDecision {
	rawKey := ExtractAPIKey(headers, query)
	key, enabled := s.findBySecretWhenEnabled(rawKey)
	if !enabled {
		return AuthDecision{Reason: "plugin_disabled"}
	}
	if key == nil {
		return AuthDecision{Reason: "unknown_key"}
	}
	key = s.learnKeyPreview(key, rawKey)
	decision := AuthDecision{Known: true, KeyID: key.ID, Principal: key.ID}
	if !key.Enabled {
		decision.Reason = "key_disabled"
		return decision
	}
	decision.Allowed = true
	decision.Reason = "authenticated"
	return decision
}

// AuthenticateWebSocket is retained for callers that explicitly authenticate
// an Upgrade request. It has the same identity-only semantics as HTTP auth.
func (s *Store) AuthenticateWebSocket(headers http.Header, query map[string][]string) AuthDecision {
	return s.AuthenticateKey(headers, query)
}

func (s *Store) Authenticate(method, path string, headers http.Header, query map[string][]string, body []byte) AuthDecision {
	requested := ExtractRequestedModel(path, query, body)
	decision := s.authorize(headers, query, requested, IsModelsEndpoint(path), false)
	if !decision.Allowed || decision.ModelList {
		return decision
	}
	if decision.Rule.BillingMode == "per_call" && IsImageVideoEndpoint(path) {
		model := decision.Rule.Model
		if model == "" {
			model = decision.Requested
		}
		s.RecordUsage(decision.KeyID, model, model, false, UsageDetail{})
		decision.PreCharged = true
	}
	return decision
}

// AuthorizeModel applies the per-execution policy used by WebSocket request
// interception. It is also safe for a request whose body omitted model because
// CPA supplies the resolved requested model separately.
func (s *Store) AuthorizeModel(headers http.Header, query map[string][]string, requested string) AuthDecision {
	return s.authorize(headers, query, strings.TrimSpace(requested), false, true)
}

func (s *Store) authorize(headers http.Header, query map[string][]string, requested string, modelList, requireModel bool) AuthDecision {
	rawKey := ExtractAPIKey(headers, query)
	key, enabled := s.findBySecretWhenEnabled(rawKey)
	if !enabled {
		return AuthDecision{Reason: "plugin_disabled"}
	}
	if key == nil {
		return AuthDecision{Reason: "unknown_key"}
	}
	key = s.learnKeyPreview(key, rawKey)
	decision := AuthDecision{
		Known:     true,
		KeyID:     key.ID,
		Principal: key.ID,
		Requested: strings.TrimSpace(requested),
		ModelList: modelList,
	}
	if !key.Enabled {
		decision.Reason = "key_disabled"
		return decision
	}
	if !key.SubscriptionExpiresAt.IsZero() && !s.currentTime().Before(key.SubscriptionExpiresAt) {
		decision.Reason = "subscription_expired"
		return decision
	}
	if modelList {
		if key.AllowModelsEndpoint {
			decision.Allowed = true
			decision.Reason = "models_endpoint_allowed"
		} else {
			decision.Reason = "models_endpoint_disabled"
		}
		return decision
	}
	if decision.Requested == "" {
		if requireModel {
			decision.Reason = "model_required"
			return decision
		}
	} else {
		rule, ok := key.ModelRuleForModel(decision.Requested)
		if !ok {
			decision.Reason = "model_not_allowed"
			return decision
		}
		decision.Rule = rule
	}
	limiter, usage := s.runtimeComponents()
	if limiter != nil && !limiter.Allow(key.ID, key.RPM) {
		decision.RateLimited = true
		decision.Reason = "rpm_exceeded"
		return decision
	}
	if usage != nil {
		if reason, _ := usage.OverLimit(*key); reason != "" {
			decision.CostLimited = true
			decision.Reason = reason
			return decision
		}
	}
	decision.Allowed = true
	decision.Reason = "allowed"
	return decision
}

// RecordResponseCost 为非流式集成调用解析响应 Token，并在返回前同步持久化额度状态。
// headers、query、requested 和 body 分别表示鉴权信息、查询参数、请求模型和响应正文，返回值是本次美元成本。
func (s *Store) RecordResponseCost(headers http.Header, query map[string][]string, requested string, body []byte) float64 {
	if !s.Enabled() {
		return 0
	}
	key := s.findBySecret(ExtractAPIKey(headers, query))
	if key == nil || !key.Enabled {
		return 0
	}
	model := strings.TrimSpace(requested)
	if model == "" {
		return 0
	}
	usage := ParseTokenUsage(body)
	if !usage.Found {
		return 0
	}
	inputPrice, outputPrice, _, priced := key.PriceForModel(model)
	// cost 是按普通输入和输出 Token 计算出的本次请求成本。
	cost := ComputeCost(inputPrice, outputPrice, priced, usage)
	// ledger 是当前 Key 额度的内存读取视图。
	_, ledger := s.runtimeComponents()
	if priced && ledger != nil {
		// breakdown 保存同步额度状态所需的计价与 Token 增量。
		breakdown := UsageCostBreakdown{
			TotalUSD:            cost,
			UncachedInputUSD:    float64(usage.PromptTokens) / 1_000_000 * inputPrice,
			OutputUSD:           float64(usage.CompletionTokens) / 1_000_000 * outputPrice,
			NonCacheInputTokens: int64(usage.PromptTokens),
		}
		s.persistUsageCost(s.runtimeHistory(), ledger, nil, key.ID, model, breakdown, int64(usage.CompletionTokens), 1)
	}
	return cost
}

// RecordUsage 计算宿主上报请求的成本，并同步提交请求事件和当前 Key 额度状态。
// apiKeyOrID、requestedModel、model、failed 和 detail 描述请求身份、模型、失败状态及 Token 明细，返回值是本次美元成本。
func (s *Store) RecordUsage(apiKeyOrID, requestedModel, model string, failed bool, detail UsageDetail) float64 {
	if !s.Enabled() {
		return 0
	}
	key := s.findByID(apiKeyOrID)
	if key == nil || !key.Enabled {
		key = s.findBySecret(apiKeyOrID)
	}
	if key == nil || !key.Enabled {
		return 0
	}
	resolved := strings.TrimSpace(requestedModel)
	if resolved == "" {
		resolved = strings.TrimSpace(model)
	}
	if resolved == "" {
		resolved = "unknown"
	}
	upstreamModel := strings.TrimSpace(model)
	if upstreamModel == "" {
		upstreamModel = resolved
	}
	history := s.runtimeHistory()
	generate := true
	if detail.Generate != nil {
		generate = *detail.Generate
	}
	var ttftMS *int64
	if detail.TTFT > 0 {
		value := detail.TTFT.Milliseconds()
		if value > 0 {
			ttftMS = &value
		}
	}
	event := UsageEvent{
		Timestamp:           detail.RequestedAt,
		KeyID:               key.ID,
		KeyPreview:          MaskKeyPreview(key.KeyPreview),
		Provider:            detail.Provider,
		Model:               resolved,
		UpstreamModel:       upstreamModel,
		ReasoningEffort:     detail.ReasoningEffort,
		ExecutorType:        detail.ExecutorType,
		AuthType:            detail.AuthType,
		AuthIndex:           detail.AuthIndex,
		Source:              detail.Source,
		ServiceTier:         detail.ServiceTier,
		Generate:            generate,
		LatencyMS:           maxInt64(0, detail.Latency.Milliseconds()),
		TTFTMS:              ttftMS,
		StatusCode:          detail.FailureStatusCode,
		Failed:              failed,
		InputTokens:         detail.InputTokens,
		OutputTokens:        detail.OutputTokens,
		ReasoningTokens:     detail.ReasoningTokens,
		CachedTokens:        detail.CachedTokens,
		CacheReadTokens:     detail.CacheReadTokens,
		CacheCreationTokens: detail.CacheCreationTokens,
		TotalTokens:         detail.TotalTokens,
	}
	// recordEvent 将不改变额度状态的事件立即写入 SQLite。
	recordEvent := func() {
		s.persistUsageEvent(history, event)
	}
	rule, ok := key.ModelRuleForModel(resolved)
	if !ok {
		recordEvent()
		return 0
	}
	event.BillingMode = rule.BillingMode
	event.CostAvailable = true
	_, ledger := s.runtimeComponents()
	if rule.BillingMode == "per_call" {
		if failed {
			recordEvent()
			return 0
		}
		cost := rule.PerCallUSD
		event.CostUSD = cost
		event.OtherCostUSD = cost
		if ledger != nil {
			// breakdown 保存按次计价请求的完整成本增量。
			breakdown := UsageCostBreakdown{TotalUSD: cost}
			s.persistUsageCost(history, ledger, &event, key.ID, resolved, breakdown, 0, 1)
			return cost
		}
		recordEvent()
		return cost
	}
	usage := TokenUsage{
		PromptTokens:     int(detail.InputTokens),
		CompletionTokens: int(detail.OutputTokens),
		Found: detail.InputTokens > 0 || detail.OutputTokens > 0 ||
			detail.CachedTokens > 0 || detail.CacheReadTokens > 0 ||
			detail.CacheCreationTokens > 0 || detail.TotalTokens > 0,
	}
	if !usage.Found {
		recordEvent()
		return 0
	}
	inputPrice, outputPrice, cachePrice, priced := key.PriceForModel(resolved)
	event.CostAvailable = priced
	breakdown := ComputeUsageCostBreakdown(detail.Provider, inputPrice, outputPrice, cachePrice, priced, detail)
	event.CostUSD = breakdown.TotalUSD
	event.UncachedInputCostUSD = breakdown.UncachedInputUSD
	event.CacheReadCostUSD = breakdown.CacheReadUSD
	event.CacheCreationCostUSD = breakdown.CacheCreationUSD
	event.OutputCostUSD = breakdown.OutputUSD
	if !priced || ledger == nil {
		recordEvent()
		return breakdown.TotalUSD
	}
	s.persistUsageCost(history, ledger, &event, key.ID, resolved, breakdown, detail.OutputTokens, 1)
	return breakdown.TotalUSD
}

func (s *Store) UsageSummaryFor(key KeyConfig) UsageSummary {
	_, usage := s.runtimeComponents()
	if usage == nil {
		return UsageSummary{DailyLimitUSD: key.DailyLimitUSD, WeeklyLimitUSD: key.WeeklyLimitUSD}
	}
	return usage.Summary(key)
}

func (s *Store) ModelUsageFor(keyID string) (KeyConfig, []ModelUsageEntry, bool) {
	key := s.findByID(keyID)
	if key == nil {
		return KeyConfig{}, nil, false
	}
	_, usage := s.runtimeComponents()
	if usage == nil {
		rows := make([]ModelUsageEntry, 0, len(key.Models))
		for _, rule := range key.Models {
			rows = append(rows, ModelUsageEntry{
				Model:       rule.Model,
				BillingMode: rule.BillingMode,
				PerCallUSD:  rule.PerCallUSD,
				InConfig:    true,
			})
		}
		return *key, rows, true
	}
	return *key, usage.ModelUsage(*key), true
}

func (s *Store) UsageOverview(filter UsageHistoryFilter) (UsageOverview, error) {
	if err := s.currentHistoryError(); err != nil {
		return UsageOverview{}, err
	}
	history := s.runtimeHistory()
	if history == nil {
		return UsageOverview{}, errors.New("state database is not configured")
	}
	return history.overview(filter)
}

func (s *Store) UsageAnalysis(filter UsageHistoryFilter) (UsageAnalysis, error) {
	if err := s.currentHistoryError(); err != nil {
		return UsageAnalysis{}, err
	}
	history := s.runtimeHistory()
	if history == nil {
		return UsageAnalysis{}, errors.New("state database is not configured")
	}
	return history.analysis(filter)
}

func (s *Store) UsageEvents(filter UsageHistoryFilter, page, pageSize int) (UsageEventPage, error) {
	if err := s.currentHistoryError(); err != nil {
		return UsageEventPage{}, err
	}
	history := s.runtimeHistory()
	if history == nil {
		return UsageEventPage{}, errors.New("state database is not configured")
	}
	return history.eventPage(filter, page, pageSize)
}

func (s *Store) UsageStoreError() error {
	return s.currentHistoryError()
}

func (s *Store) FindByAPIKey(raw string) *KeyConfig {
	return s.findBySecret(raw)
}

func (s *Store) findBySecret(raw string) *KeyConfig {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	hash, err := HashKey(raw)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.effectiveKeyLocked(s.keysByHash[strings.ToLower(strings.TrimSpace(hash))])
}

func (s *Store) findBySecretWhenEnabled(raw string) (*KeyConfig, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		s.mu.RLock()
		enabled := s.enabled
		s.mu.RUnlock()
		return nil, enabled
	}
	hash, err := HashKey(raw)
	if err != nil {
		return nil, true
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.enabled {
		return nil, false
	}
	return s.effectiveKeyLocked(s.keysByHash[strings.ToLower(strings.TrimSpace(hash))]), true
}

func (s *Store) learnKeyPreview(key *KeyConfig, rawKey string) *KeyConfig {
	if key == nil || strings.TrimSpace(key.KeyPreview) != "" || strings.TrimSpace(rawKey) == "" {
		return key
	}
	preview := PreviewKey(rawKey)
	if strings.TrimSpace(preview) == "" {
		return key
	}

	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	s.mu.RLock()
	current := s.keys[key.ID]
	database := s.database
	if current == nil || !strings.EqualFold(strings.TrimSpace(current.KeyHash), strings.TrimSpace(key.KeyHash)) {
		s.mu.RUnlock()
		return key
	}
	if strings.TrimSpace(current.KeyPreview) != "" {
		result := s.effectiveKeyLocked(current)
		s.mu.RUnlock()
		return result
	}
	s.mu.RUnlock()
	if database == nil {
		return key
	}

	s.persistMu.Lock()
	changed, err := database.updateKeyPreview(key.ID, key.KeyHash, preview)
	s.persistMu.Unlock()
	if err != nil {
		s.setHistoryError(err)
		return key
	}
	if !changed {
		return key
	}
	s.mu.Lock()
	current = s.keys[key.ID]
	if current != nil && strings.TrimSpace(current.KeyPreview) == "" && strings.EqualFold(strings.TrimSpace(current.KeyHash), strings.TrimSpace(key.KeyHash)) {
		current.KeyPreview = preview
		current.UpdatedAt = time.Now().UTC()
		key = s.effectiveKeyLocked(current)
	}
	s.mu.Unlock()
	return key
}

func (s *Store) setHistoryError(err error) {
	s.mu.Lock()
	s.historyErr = err
	s.mu.Unlock()
}

func (s *Store) currentHistoryError() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.historyErr
}

func (s *Store) findByID(id string) *KeyConfig {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	key := s.keys[id]
	if key == nil {
		for candidateID, candidate := range s.keys {
			if strings.EqualFold(candidateID, id) {
				key = candidate
				break
			}
		}
	}
	return s.effectiveKeyLocked(key)
}

func copyKey(key *KeyConfig) *KeyConfig {
	if key == nil {
		return nil
	}
	copy := *key
	copy.Models = append([]ModelRule(nil), key.Models...)
	copy.Aliases = nil
	return &copy
}

func (s *Store) keysSnapshotLocked() []KeyConfig {
	keys := make([]KeyConfig, 0, len(s.keys))
	for _, key := range s.keys {
		if key == nil {
			continue
		}
		keys = append(keys, *copyKey(key))
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].ID < keys[j].ID })
	return keys
}

// UpsertKey 新建或更新 input，并在 persist 为真时与最新额度状态一起提交到 SQLite。
func (s *Store) UpsertKey(input KeyConfig, persist bool) error {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	cfg := Config{Enabled: true, StateFile: s.StatePath(), Keys: []KeyConfig{input}}
	if err := normalizeConfig(&cfg); err != nil {
		return err
	}
	key := cfg.Keys[0]
	key.SubscriptionExpiresAt = time.Time{}
	now := time.Now().UTC()
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	if old := s.keys[key.ID]; old != nil && !old.CreatedAt.IsZero() {
		key.CreatedAt = old.CreatedAt
	} else if key.CreatedAt.IsZero() {
		key.CreatedAt = now
	}
	key.UpdatedAt = now
	s.keys[key.ID] = &key
	s.rebuildKeysByHashLocked()
	keys := s.keysSnapshotLocked()
	plans := s.plansSnapshotLocked()
	usage := s.usageSnapshotLocked()
	database := s.database
	s.mu.Unlock()
	if persist {
		return saveConfigurationState(database, keys, plans, usage)
	}
	return nil
}

// DeleteKey 删除 id 对应的 Key，并在同一持久化临界区保存配置和最新额度快照。
func (s *Store) DeleteKey(id string) error {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("id is required")
	}
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	if _, ok := s.keys[id]; !ok {
		s.mu.Unlock()
		return ErrUnknownKey
	}
	delete(s.keys, id)
	s.rebuildKeysByHashLocked()
	keys := s.keysSnapshotLocked()
	plans := s.plansSnapshotLocked()
	usage := s.usageSnapshotLocked()
	delete(usage, id)
	database := s.database
	limiter := s.limiter
	ledger := s.usage
	s.mu.Unlock()
	if limiter != nil {
		limiter.Reset(id)
	}
	if ledger != nil {
		ledger.resetUsage(id)
	}
	return saveConfigurationState(database, keys, plans, usage)
}

// RotateKey 为 id 生成新密钥，并在同一持久化临界区保存配置和最新额度快照。
func (s *Store) RotateKey(id string) (string, KeyConfig, error) {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	id = strings.TrimSpace(id)
	if id == "" {
		return "", KeyConfig{}, errors.New("id is required")
	}
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	plain, err := GenerateKey()
	if err != nil {
		return "", KeyConfig{}, err
	}
	hash, err := HashKey(plain)
	if err != nil {
		return "", KeyConfig{}, err
	}
	s.mu.Lock()
	key := s.keys[id]
	if key == nil {
		s.mu.Unlock()
		return "", KeyConfig{}, ErrUnknownKey
	}
	key.KeyHash = hash
	key.KeyPreview = PreviewKey(plain)
	key.UpdatedAt = time.Now().UTC()
	result := *copyKey(key)
	s.rebuildKeysByHashLocked()
	keys := s.keysSnapshotLocked()
	plans := s.plansSnapshotLocked()
	usage := s.usageSnapshotLocked()
	database := s.database
	limiter := s.limiter
	s.mu.Unlock()
	if limiter != nil {
		limiter.Reset(id)
	}
	if err := saveConfigurationState(database, keys, plans, usage); err != nil {
		return "", KeyConfig{}, err
	}
	return plain, result, nil
}

func (s *Store) ResetRPM(id string) error {
	if strings.TrimSpace(id) == "" {
		return errors.New("id is required")
	}
	limiter, _ := s.runtimeComponents()
	if limiter != nil {
		limiter.Reset(id)
	}
	return nil
}

func (s *Store) usageSnapshotLocked() map[string]*UsageState {
	if s.usage == nil {
		return make(map[string]*UsageState)
	}
	return s.usage.snapshot()
}

func (s *Store) FlushUsage() error {
	// Serialize the snapshot with persistence. Taking the snapshot before this
	// lock could let an older background flush overwrite a manual usage reset.
	s.persistMu.Lock()
	defer s.persistMu.Unlock()

	s.mu.RLock()
	usage := s.usageSnapshotLocked()
	database := s.database
	s.mu.RUnlock()
	if database == nil {
		return nil
	}
	return database.saveUsage(usage)
}

// ResetAllUsage clears every key's daily and weekly usage and persists the
// reset before changing the in-memory ledger. A persistence failure therefore
// leaves the live counters untouched instead of making disk and memory diverge.
func (s *Store) ResetAllUsage() error {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()

	s.persistMu.Lock()
	defer s.persistMu.Unlock()

	s.mu.RLock()
	usage := s.usage
	database := s.database
	s.mu.RUnlock()
	if database != nil {
		if err := database.saveUsage(make(map[string]*UsageState)); err != nil {
			return err
		}
	}
	if usage != nil {
		usage.resetAllUsage()
	}
	return nil
}

// saveConfigurationState 将 keys、plans 和 usage 作为一份完整状态写入 database；调用方必须持有持久化锁。
func saveConfigurationState(database *stateDatabase, keys []KeyConfig, plans []SubscriptionPlan, usage map[string]*UsageState) error {
	if database == nil {
		return errors.New("state database is not configured")
	}
	return database.saveStateWithPlans(keys, plans, usage)
}

type usageFlusher struct {
	stopCh   chan struct{}
	doneCh   chan struct{}
	stopOnce sync.Once
	store    *Store
}

func (s *Store) StartUsageFlusher() func() {
	s.mu.Lock()
	if s.flusher != nil {
		flusher := s.flusher
		s.mu.Unlock()
		return flusher.stop
	}
	flusher := &usageFlusher{stopCh: make(chan struct{}), doneCh: make(chan struct{}), store: s}
	s.flusher = flusher
	s.mu.Unlock()
	go flusher.loop()
	return flusher.stop
}

func (s *Store) StopUsageFlusher() error {
	s.mu.Lock()
	flusher := s.flusher
	s.flusher = nil
	s.mu.Unlock()
	if flusher != nil {
		flusher.stop()
		<-flusher.doneCh
	}
	return s.FlushUsage()
}

// Close 停止后台刷新，并在阻止新计价事务后关闭当前 SQLite 数据库。
func (s *Store) Close() error {
	flushErr := s.StopUsageFlusher()
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	database := s.database
	s.database = nil
	s.mu.Unlock()
	if database == nil {
		return flushErr
	}
	return errors.Join(flushErr, database.close())
}

func (f *usageFlusher) stop() {
	f.stopOnce.Do(func() { close(f.stopCh) })
}

func (f *usageFlusher) loop() {
	defer close(f.doneCh)
	ticker := time.NewTicker(usageFlushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			_ = f.store.FlushUsage()
		case <-f.stopCh:
			return
		}
	}
}

// Status 返回插件运行状态，并使用订阅计划生效后的 Key 策略生成额度汇总。
func (s *Store) Status() map[string]any {
	keys := s.EffectiveKeys()
	limiter, usage := s.runtimeComponents()
	status := map[string]any{
		"enabled":    s.Enabled(),
		"state_file": s.StatePath(),
		"storage":    "sqlite",
		"key_count":  len(keys),
	}
	if limiter != nil {
		status["rpm_usage"] = limiter.Snapshot()
	}
	if usage != nil {
		status["usage"] = usageSummaryForKeys(usage, keys)
	}
	return status
}

func usageSummaryForKeys(usage *usageLedger, keys []KeyConfig) map[string]UsageSummary {
	out := make(map[string]UsageSummary, len(keys))
	for _, key := range keys {
		out[key.ID] = usage.Summary(key)
	}
	return out
}
