package plugin

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// TestSubscriptionPlanManagementCRUDAndKeyBinding 验证计划价格、管理响应和 Key 有效策略在完整管理路径中保持一致；t 提供测试生命周期。
func TestSubscriptionPlanManagementCRUDAndKeyBinding(t *testing.T) {
	// app 是已配置的测试插件实例。
	app, _ := configureTestApp(t, 60)
	// expiresAt 是计划使用的固定精度到期时间。
	expiresAt := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	// body 是创建计划接口接收的完整 JSON 请求体。
	body, _ := json.Marshal(map[string]any{
		"id":   "standard",
		"name": "Standard",
		"rpm":  120,
		"models": []map[string]any{{
			"model":                        "gpt-5.4",
			"input_price_per_million":      2.5,
			"output_price_per_million":     15,
			"cache_read_price_per_million": 0.25,
		}},
		"daily_limit_usd":       10,
		"weekly_limit_usd":      50,
		"allow_models_endpoint": true,
		"expires_at":            expiresAt.Format(time.RFC3339),
		"key_ids":               []string{"team-a"},
	})
	// created 是创建计划管理接口的响应。
	created := app.createSubscriptionPlan(body)
	if created.StatusCode != http.StatusCreated {
		t.Fatalf("create subscription plan = %d, body=%s", created.StatusCode, created.Body)
	}
	// createPayload 是创建响应中需要核验的计划字段。
	var createPayload struct {
		SubscriptionPlan struct {
			ID        string   `json:"id"`         // ID 是创建响应中的计划唯一标识。
			ExpiresAt string   `json:"expires_at"` // ExpiresAt 是创建响应中的到期时间。
			KeyIDs    []string `json:"key_ids"`    // KeyIDs 是创建响应中的完整绑定集合。
			CreatedAt string   `json:"created_at"` // CreatedAt 是服务端生成的创建时间。
			UpdatedAt string   `json:"updated_at"` // UpdatedAt 是服务端生成的更新时间。
		} `json:"subscription_plan"` // SubscriptionPlan 是创建响应中的订阅计划对象。
	}
	// err 表示创建响应的 JSON 解码错误。
	if err := json.Unmarshal(created.Body, &createPayload); err != nil {
		t.Fatal(err)
	}
	if createPayload.SubscriptionPlan.ID != "standard" ||
		createPayload.SubscriptionPlan.ExpiresAt != expiresAt.Format(time.RFC3339) ||
		len(createPayload.SubscriptionPlan.KeyIDs) != 1 ||
		createPayload.SubscriptionPlan.CreatedAt == "" || createPayload.SubscriptionPlan.UpdatedAt == "" {
		t.Fatalf("create subscription plan payload = %+v", createPayload.SubscriptionPlan)
	}
	// plans 是管理接口读取到的公开计划集合。
	if plans := app.publicSubscriptionPlans(); len(plans) != 1 || plans[0].ID != "standard" ||
		len(plans[0].KeyIDs) != 1 || plans[0].KeyIDs[0] != "team-a" || plans[0].ExpiresAt == "" ||
		len(plans[0].Models) != 1 || plans[0].Models[0].InputPricePerMillion != 2.5 ||
		plans[0].Models[0].OutputPricePerMillion != 15 || plans[0].Models[0].CacheReadPricePerMillion != 0.25 {
		t.Fatalf("public subscription plans = %+v", plans)
	}
	// raw 是绑定前的原始 Key 配置；ok 表示目标 Key 是否存在。
	raw, ok := app.keyByID("team-a")
	if !ok {
		t.Fatal("bound key disappeared")
	}
	// view 是计划绑定后返回给管理端的有效 Key 策略。
	view := app.publicKeyFromConfig(raw)
	if view.SubscriptionPlanID != "standard" || view.SubscriptionPlanName != "Standard" ||
		view.RPM != 120 || len(view.Models) != 1 || view.Models[0].Model != "gpt-5.4" ||
		view.Models[0].InputPricePerMillion != 2.5 || view.Models[0].OutputPricePerMillion != 15 ||
		view.Models[0].CacheReadPricePerMillion != 0.25 ||
		view.BasePolicy.RPM != 60 {
		t.Fatalf("bound public key = %+v", view)
	}

	// unbindBody 是解除 Key 计划绑定的请求体。
	unbindBody, _ := json.Marshal(map[string]string{"key_id": "team-a", "subscription_plan_id": ""})
	// unbound 是解除绑定接口的响应。
	unbound := app.setKeySubscriptionPlan(unbindBody)
	if unbound.StatusCode != http.StatusOK {
		t.Fatalf("unbind key = %d, body=%s", unbound.StatusCode, unbound.Body)
	}
	// effective 是解除绑定后的有效策略；ok 表示目标 Key 是否仍存在。
	if effective, ok := app.Store().EffectiveKey("team-a"); !ok || effective.SubscriptionPlanID != "" || effective.RPM != 60 {
		t.Fatalf("unbound effective key = %+v, ok=%v", effective, ok)
	}
	// deleted 是删除空计划后的管理接口响应。
	deleted := app.deleteSubscriptionPlan("standard")
	if deleted.StatusCode != http.StatusOK || len(app.Store().SubscriptionPlans()) != 0 {
		t.Fatalf("delete subscription plan = %d, body=%s", deleted.StatusCode, deleted.Body)
	}
}

// TestManagementRegistersSubscriptionPlanRoutes 验证管理注册包含计划增删改查与 Key 绑定入口；t 提供测试生命周期。
func TestManagementRegistersSubscriptionPlanRoutes(t *testing.T) {
	// app 是待检查管理路由注册的插件实例。
	app := NewApp()
	t.Cleanup(app.Shutdown)
	// wanted 记录每个订阅计划管理路由是否已经注册。
	wanted := map[string]bool{
		http.MethodPatch + " /plugins/cpa-keyer/keys/subscription-plan": false,
		http.MethodGet + " /plugins/cpa-keyer/subscription-plans":       false,
		http.MethodPost + " /plugins/cpa-keyer/subscription-plans":      false,
		http.MethodPatch + " /plugins/cpa-keyer/subscription-plans":     false,
		http.MethodDelete + " /plugins/cpa-keyer/subscription-plans":    false,
	}
	// route 表示当前检查的管理路由。
	for _, route := range app.managementRegistration().Routes {
		// key 是由 HTTP 方法和路径组成的路由标识。
		key := route.Method + " " + route.Path
		// ok 表示当前路由是否属于期望集合。
		if _, ok := wanted[key]; ok {
			wanted[key] = true
		}
	}
	// route 是期望路由标识；registered 表示该路由是否已经出现。
	for route, registered := range wanted {
		if !registered {
			t.Fatalf("subscription plan route not registered: %s", route)
		}
	}
}
