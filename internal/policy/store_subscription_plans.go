package policy

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// copySubscriptionPlan 复制 plan 及其模型切片，并返回与原数据互不共享切片的副本。
func copySubscriptionPlan(plan *SubscriptionPlan) *SubscriptionPlan {
	if plan == nil {
		return nil
	}
	// cloned 是订阅计划的值副本。
	cloned := *plan
	cloned.Models = append([]ModelRule(nil), plan.Models...)
	return &cloned
}

// effectiveKeyLocked 在持有 s 读锁或写锁时，将 key 绑定的计划策略应用到返回副本。
func (s *Store) effectiveKeyLocked(key *KeyConfig) *KeyConfig {
	// effective 是用于鉴权和管理展示的 Key 策略副本。
	effective := copyKey(key)
	if effective == nil || strings.TrimSpace(effective.SubscriptionPlanID) == "" {
		return effective
	}
	// plan 是 Key 当前绑定的订阅计划。
	plan := s.plans[effective.SubscriptionPlanID]
	if plan == nil {
		return effective
	}
	effective.RPM = plan.RPM
	effective.Models = append([]ModelRule(nil), plan.Models...)
	effective.AllowModelsEndpoint = plan.AllowModelsEndpoint
	effective.DailyLimitUSD = plan.DailyLimitUSD
	effective.WeeklyLimitUSD = plan.WeeklyLimitUSD
	effective.SubscriptionExpiresAt = plan.ExpiresAt
	return effective
}

// currentTime 返回 s 配置的 UTC 时钟时间。
func (s *Store) currentTime() time.Time {
	s.mu.RLock()
	// now 是 Store 当前使用的时钟函数。
	now := s.now
	s.mu.RUnlock()
	if now == nil {
		return time.Now().UTC()
	}
	return now().UTC()
}

// rebuildKeysByHashLocked 在持有 s 写锁时重建 Key 哈希索引。
func (s *Store) rebuildKeysByHashLocked() {
	// ids 保存待索引的 Key ID，并通过排序保证冲突处理稳定。
	ids := make([]string, 0, len(s.keys))
	// id 表示当前遍历到的 Key ID。
	for id := range s.keys {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	// byHash 保存规范化 Key 哈希到 Key 配置的索引。
	byHash := make(map[string]*KeyConfig, len(ids))
	// id 表示当前建立哈希索引的 Key ID。
	for _, id := range ids {
		// key 是当前 Key 配置。
		key := s.keys[id]
		if key == nil {
			continue
		}
		// hash 是规范化后的 Key 哈希。
		hash := strings.ToLower(strings.TrimSpace(key.KeyHash))
		if hash == "" {
			continue
		}
		// exists 表示当前哈希是否已经建立稳定索引。
		if _, exists := byHash[hash]; !exists {
			byHash[hash] = key
		}
	}
	s.keysByHash = byHash
}

// ModelRuleForModel 在 k 的模型规则中查找 model，并返回规则及是否存在。
func (k *KeyConfig) ModelRuleForModel(model string) (ModelRule, bool) {
	model = strings.TrimSpace(model)
	if model == "" {
		return ModelRule{}, false
	}
	// rule 表示当前检查的模型规则。
	for _, rule := range k.Models {
		if strings.EqualFold(strings.TrimSpace(rule.Model), model) {
			return rule, true
		}
	}
	return ModelRule{}, false
}

// Keys 返回 s 当前持久化的原始 Key 策略副本。
func (s *Store) Keys() []KeyConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.keysSnapshotLocked()
}

// EffectiveKeys 返回已应用订阅计划的管理视图；原始 Key 策略仍由 Keys 返回。
func (s *Store) EffectiveKeys() []KeyConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	// keys 收集应用计划后的 Key 副本。
	keys := make([]KeyConfig, 0, len(s.keys))
	// key 表示当前计算有效策略的原始 Key。
	for _, key := range s.keys {
		// effective 是应用计划后的 Key 策略。
		if effective := s.effectiveKeyLocked(key); effective != nil {
			keys = append(keys, *effective)
		}
	}
	// 排序回调中的 i 和 j 是待比较的 Key 下标。
	sort.Slice(keys, func(i, j int) bool { return keys[i].ID < keys[j].ID })
	return keys
}

// EffectiveKey 按 id 返回应用订阅计划后的 Key 策略及是否存在。
func (s *Store) EffectiveKey(id string) (KeyConfig, bool) {
	id = strings.TrimSpace(id)
	s.mu.RLock()
	defer s.mu.RUnlock()
	// key 是精确匹配或忽略大小写匹配到的原始 Key。
	key := s.keys[id]
	if key == nil {
		// candidateID 和 candidate 表示当前候选 Key 的 ID 与配置。
		for candidateID, candidate := range s.keys {
			if strings.EqualFold(candidateID, id) {
				key = candidate
				break
			}
		}
	}
	// effective 是应用计划后的 Key 策略。
	effective := s.effectiveKeyLocked(key)
	if effective == nil {
		return KeyConfig{}, false
	}
	return *effective, true
}

// SubscriptionPlans 返回 s 当前订阅计划的有序副本。
func (s *Store) SubscriptionPlans() []SubscriptionPlan {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.plansSnapshotLocked()
}

// plansSnapshotLocked 在持有 s 读锁或写锁时返回订阅计划快照。
func (s *Store) plansSnapshotLocked() []SubscriptionPlan {
	// plans 收集订阅计划副本。
	plans := make([]SubscriptionPlan, 0, len(s.plans))
	// plan 表示当前复制的订阅计划。
	for _, plan := range s.plans {
		if plan != nil {
			plans = append(plans, *copySubscriptionPlan(plan))
		}
	}
	// 排序回调中的 i 和 j 是待比较的计划下标。
	sort.Slice(plans, func(i, j int) bool { return plans[i].ID < plans[j].ID })
	return plans
}

// UpsertSubscriptionPlan 新建或更新 input，并在 boundKeyIDs 非空指针时原子替换完整绑定集合；create 表示是否要求目标尚不存在。
func (s *Store) UpsertSubscriptionPlan(input SubscriptionPlan, boundKeyIDs *[]string, create bool) (SubscriptionPlan, error) {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()

	// normalized 承载经过统一配置校验的计划输入。
	normalized := Config{SubscriptionPlans: []SubscriptionPlan{input}}
	if err := normalizeConfig(&normalized); err != nil {
		return SubscriptionPlan{}, err
	}
	// plan 是规范化后的计划。
	plan := normalized.SubscriptionPlans[0]
	// now 是本次写入使用的统一时间。
	now := s.currentTime()

	// 持久化锁保证用量快照与计划配置在同一临界区保存，避免旧快照覆盖新用量。
	s.persistMu.Lock()
	defer s.persistMu.Unlock()

	s.mu.RLock()
	// keys 是当前原始 Key 快照。
	keys := s.keysSnapshotLocked()
	// plans 是当前计划快照。
	plans := s.plansSnapshotLocked()
	// usage 是与配置一并写入的最新用量快照。
	usage := s.usageSnapshotLocked()
	// database 是当前 SQLite 状态数据库。
	database := s.database
	s.mu.RUnlock()

	// planIndex 是目标计划在快照中的下标，-1 表示不存在。
	planIndex := -1
	// i 表示当前检查的计划下标。
	for i := range plans {
		if plans[i].ID == plan.ID {
			planIndex = i
			break
		}
	}
	if create && planIndex >= 0 {
		return SubscriptionPlan{}, fmt.Errorf("subscription plan %q already exists", plan.ID)
	}
	if !create && planIndex < 0 {
		return SubscriptionPlan{}, fmt.Errorf("subscription plan %q does not exist", plan.ID)
	}
	if planIndex >= 0 {
		plan.CreatedAt = plans[planIndex].CreatedAt
	} else {
		plan.CreatedAt = now
	}
	plan.UpdatedAt = now

	// selected 保存去重后的完整绑定 Key ID 集合。
	selected := make(map[string]struct{})
	if boundKeyIDs != nil {
		// id 表示当前标准化的绑定 Key ID。
		for _, id := range *boundKeyIDs {
			id = strings.TrimSpace(id)
			if id != "" {
				selected[id] = struct{}{}
			}
		}
		// id 表示当前验证的绑定 Key ID。
		for id := range selected {
			// found 表示绑定目标是否存在。
			found := false
			// key 表示当前检查的 Key 配置。
			for _, key := range keys {
				if key.ID != id {
					continue
				}
				found = true
				if key.SubscriptionPlanID != "" && key.SubscriptionPlanID != plan.ID {
					return SubscriptionPlan{}, fmt.Errorf("key %q is already bound to subscription plan %q", id, key.SubscriptionPlanID)
				}
				break
			}
			if !found {
				return SubscriptionPlan{}, fmt.Errorf("key %q does not exist", id)
			}
		}
		// i 表示当前更新绑定关系的 Key 下标。
		for i := range keys {
			// shouldBind 表示当前 Key 是否属于提交的完整绑定集合。
			_, shouldBind := selected[keys[i].ID]
			if keys[i].SubscriptionPlanID == plan.ID && !shouldBind {
				keys[i].SubscriptionPlanID = ""
				keys[i].UpdatedAt = now
			}
			if shouldBind && keys[i].SubscriptionPlanID == "" {
				keys[i].SubscriptionPlanID = plan.ID
				keys[i].UpdatedAt = now
			}
		}
	}

	if planIndex >= 0 {
		plans[planIndex] = plan
	} else {
		plans = append(plans, plan)
		// 排序回调中的 i 和 j 是待比较的计划下标。
		sort.Slice(plans, func(i, j int) bool { return plans[i].ID < plans[j].ID })
	}
	if err := saveConfigurationState(database, keys, plans, usage); err != nil {
		return SubscriptionPlan{}, err
	}
	s.replaceConfigurationState(keys, plans)
	return plan, nil
}

// SetKeySubscriptionPlan 将 keyID 绑定到 planID；planID 为空时解绑，并返回新的有效 Key 策略。
func (s *Store) SetKeySubscriptionPlan(keyID, planID string) (KeyConfig, error) {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	keyID = strings.TrimSpace(keyID)
	planID = strings.TrimSpace(planID)
	if keyID == "" {
		return KeyConfig{}, errors.New("key id is required")
	}

	s.persistMu.Lock()
	defer s.persistMu.Unlock()

	s.mu.RLock()
	// keys 是当前原始 Key 快照。
	keys := s.keysSnapshotLocked()
	// plans 是当前计划快照。
	plans := s.plansSnapshotLocked()
	// usage 是与配置一并写入的最新用量快照。
	usage := s.usageSnapshotLocked()
	// database 是当前 SQLite 状态数据库。
	database := s.database
	s.mu.RUnlock()
	if planID != "" {
		// known 表示目标计划是否存在。
		known := false
		// plan 表示当前检查的订阅计划。
		for _, plan := range plans {
			if plan.ID == planID {
				known = true
				break
			}
		}
		if !known {
			return KeyConfig{}, fmt.Errorf("subscription plan %q does not exist", planID)
		}
	}

	// index 是目标 Key 在快照中的下标，-1 表示不存在。
	index := -1
	// i 表示当前检查的 Key 下标。
	for i := range keys {
		if keys[i].ID == keyID {
			index = i
			break
		}
	}
	if index < 0 {
		return KeyConfig{}, ErrUnknownKey
	}
	if keys[index].SubscriptionPlanID != planID {
		keys[index].SubscriptionPlanID = planID
		keys[index].UpdatedAt = s.currentTime()
		if err := saveConfigurationState(database, keys, plans, usage); err != nil {
			return KeyConfig{}, err
		}
		s.replaceConfigurationState(keys, plans)
	}
	// effective 是绑定更新后的有效 Key；ok 表示 Key 是否存在。
	effective, ok := s.EffectiveKey(keyID)
	if !ok {
		return KeyConfig{}, ErrUnknownKey
	}
	return effective, nil
}

// DeleteSubscriptionPlan 删除 id 对应的计划，解绑关联 Key，并返回解绑数量。
func (s *Store) DeleteSubscriptionPlan(id string) (int, error) {
	s.updateMu.Lock()
	defer s.updateMu.Unlock()
	id = strings.TrimSpace(id)
	if id == "" {
		return 0, errors.New("subscription plan id is required")
	}

	s.persistMu.Lock()
	defer s.persistMu.Unlock()

	s.mu.RLock()
	// keys 是当前原始 Key 快照。
	keys := s.keysSnapshotLocked()
	// plans 是当前计划快照。
	plans := s.plansSnapshotLocked()
	// usage 是与配置一并写入的最新用量快照。
	usage := s.usageSnapshotLocked()
	// database 是当前 SQLite 状态数据库。
	database := s.database
	s.mu.RUnlock()
	// index 是目标计划在快照中的下标，-1 表示不存在。
	index := -1
	// i 表示当前检查的计划下标。
	for i := range plans {
		if plans[i].ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return 0, fmt.Errorf("subscription plan %q does not exist", id)
	}
	plans = append(plans[:index], plans[index+1:]...)
	// now 是解绑 Key 使用的统一更新时间。
	now := s.currentTime()
	// unbound 记录解除绑定的 Key 数量。
	unbound := 0
	// i 表示当前检查绑定关系的 Key 下标。
	for i := range keys {
		if keys[i].SubscriptionPlanID == id {
			keys[i].SubscriptionPlanID = ""
			keys[i].UpdatedAt = now
			unbound++
		}
	}
	if err := saveConfigurationState(database, keys, plans, usage); err != nil {
		return 0, err
	}
	s.replaceConfigurationState(keys, plans)
	return unbound, nil
}

// replaceConfigurationState 用 keys 和 plans 原子替换 s 的内存配置并重建哈希索引。
func (s *Store) replaceConfigurationState(keys []KeyConfig, plans []SubscriptionPlan) {
	// nextKeys 保存待替换的原始 Key 映射。
	nextKeys := make(map[string]*KeyConfig, len(keys))
	// i 表示当前复制的 Key 下标。
	for i := range keys {
		// item 是清除运行时到期值后的 Key 副本。
		item := keys[i]
		item.SubscriptionExpiresAt = time.Time{}
		nextKeys[item.ID] = copyKey(&item)
	}
	// nextPlans 保存待替换的订阅计划映射。
	nextPlans := make(map[string]*SubscriptionPlan, len(plans))
	// i 表示当前复制的计划下标。
	for i := range plans {
		// item 是当前订阅计划的值副本。
		item := plans[i]
		nextPlans[item.ID] = copySubscriptionPlan(&item)
	}
	s.mu.Lock()
	s.keys = nextKeys
	s.plans = nextPlans
	s.rebuildKeysByHashLocked()
	s.mu.Unlock()
}
