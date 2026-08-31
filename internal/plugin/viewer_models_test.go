package plugin

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/JaxsonWang/cpa-plugin-keyer/internal/policy"
)

// callViewerModels 调用 app 的模型列表资源；t 管理测试失败，key 是请求使用的 bearer 凭据。
func callViewerModels(t *testing.T, app *App, key string) ManagementResponse {
	t.Helper()
	// request 是发送给插件管理资源边界的模型列表请求；err 表示请求编码错误。
	request, err := json.Marshal(ManagementRequest{
		Method:  http.MethodGet,
		Path:    "/v0/resource/plugins/cpa-keyer" + viewerModelsPath,
		Headers: pluginHeaders(key),
	})
	if err != nil {
		t.Fatal(err)
	}
	// raw 是插件 ABI 返回的原始信封；err 表示插件调用错误。
	raw, err := app.HandleMethod(MethodManagementHandle, request)
	if err != nil {
		t.Fatal(err)
	}
	return decodeResult[ManagementResponse](t, raw)
}

// TestViewerModelsReturnsEffectiveSubscriptionModels 验证模型列表使用订阅方案生效策略；t 提供测试生命周期。
func TestViewerModelsReturnsEffectiveSubscriptionModels(t *testing.T) {
	// app 和 plain 分别是测试插件实例及其下游明文 Key。
	app, plain := configureTestApp(t, 60)
	// boundKeyIDs 是绑定到订阅方案的完整 Key ID 集合。
	boundKeyIDs := []string{"team-a"}
	// plan 是覆盖 Key 原始模型的有效订阅方案。
	plan := policy.SubscriptionPlan{
		ID:                  "models-plan",
		Name:                "Models Plan",
		RPM:                 30,
		Models:              []policy.ModelRule{{Model: "claude-sonnet"}, {Model: "gpt-5.4-mini"}},
		AllowModelsEndpoint: true,
		ExpiresAt:           time.Now().UTC().Add(time.Hour),
	}
	// savedPlan 是持久化后的订阅方案；err 表示方案写入错误。
	savedPlan, err := app.Store().UpsertSubscriptionPlan(plan, &boundKeyIDs, true)
	if err != nil {
		t.Fatal(err)
	}
	if savedPlan.ID != plan.ID {
		t.Fatalf("saved plan = %+v", savedPlan)
	}

	// response 是当前 Key 的模型列表资源响应。
	response := callViewerModels(t, app, plain)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("models response = %+v, body = %s", response, response.Body)
	}
	// payload 是解码后的 OpenAI 兼容模型列表。
	var payload viewerModelsResponse
	// err 表示模型列表 JSON 解码错误。
	err = json.Unmarshal(response.Body, &payload)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Object != "list" || len(payload.Data) != 2 ||
		payload.Data[0].ID != "claude-sonnet" || payload.Data[1].ID != "gpt-5.4-mini" ||
		payload.Data[0].Object != "model" || payload.Data[0].OwnedBy != PluginID {
		t.Fatalf("models payload = %+v", payload)
	}
}

// TestViewerModelsSeparatesUnknownAndRejectedKeys 验证未知凭据回退而 Keyer 拒绝状态不回退；t 提供测试生命周期。
func TestViewerModelsSeparatesUnknownAndRejectedKeys(t *testing.T) {
	// app 和 plain 分别是测试插件实例及其下游明文 Key。
	app, plain := configureTestApp(t, 60)
	// unknown 是 Keyer 不认识的 CPA 原生凭据响应。
	unknown := callViewerModels(t, app, "CPA_NATIVE_KEY")
	if unknown.StatusCode != viewerModelsFallbackStatus || len(unknown.Body) != 0 {
		t.Fatalf("unknown key response = %+v", unknown)
	}

	// hidden 是未开启模型列表权限的已知 Keyer Key 响应。
	hidden := callViewerModels(t, app, plain)
	if hidden.StatusCode != http.StatusUnauthorized {
		t.Fatalf("hidden models response = %+v", hidden)
	}

	// key 是准备切换为禁用状态的原始 Key 配置。
	key := app.Store().Keys()[0]
	key.Enabled = false
	key.AllowModelsEndpoint = true
	// err 表示禁用 Key 写回内存状态的错误。
	err := app.Store().UpsertKey(key, false)
	if err != nil {
		t.Fatal(err)
	}
	// disabled 是已禁用 Keyer Key 的模型列表响应。
	disabled := callViewerModels(t, app, plain)
	if disabled.StatusCode != http.StatusUnauthorized {
		t.Fatalf("disabled models response = %+v", disabled)
	}
}

// TestViewerModelsRejectsExpiredSubscription 验证过期订阅方案不会进入 CPA 原生回退；t 提供测试生命周期。
func TestViewerModelsRejectsExpiredSubscription(t *testing.T) {
	// app 和 plain 分别是测试插件实例及其下游明文 Key。
	app, plain := configureTestApp(t, 60)
	// boundKeyIDs 是绑定到过期方案的完整 Key ID 集合。
	boundKeyIDs := []string{"team-a"}
	// plan 是已经过期但允许读取模型列表的订阅方案。
	plan := policy.SubscriptionPlan{
		ID:                  "expired-plan",
		Name:                "Expired Plan",
		RPM:                 30,
		Models:              []policy.ModelRule{{Model: "gpt-5.4"}},
		AllowModelsEndpoint: true,
		ExpiresAt:           time.Now().UTC().Add(-time.Hour),
	}
	// savedPlan 是持久化后的过期方案；err 表示方案写入错误。
	savedPlan, err := app.Store().UpsertSubscriptionPlan(plan, &boundKeyIDs, true)
	if err != nil {
		t.Fatal(err)
	}
	if savedPlan.ID != plan.ID {
		t.Fatalf("saved plan = %+v", savedPlan)
	}
	// response 是过期 Keyer Key 的模型列表响应。
	response := callViewerModels(t, app, plain)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired models response = %+v", response)
	}
}
