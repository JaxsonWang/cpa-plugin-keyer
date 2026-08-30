package plugin

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"github.com/JaxsonWang/cpa-plugin-keyer/internal/policy"
)

// TestPerCallInterceptorStopsWhenSynchronousPersistenceFails 验证按次计价落库失败时请求不会继续转发；t 提供测试生命周期。
func TestPerCallInterceptorStopsWhenSynchronousPersistenceFails(t *testing.T) {
	// app 是执行请求前拦截和按次计价的插件实例，plain 是对应的下游明文 Key。
	app, plain := configureTestApp(t, 60)
	// key 是增加按次计价媒体模型后的 Key 配置副本。
	key := app.Store().Keys()[0]
	key.Models = append(key.Models, policy.ModelRule{
		Model:       "grok-imagine-image-quality",
		BillingMode: "per_call",
		PerCallUSD:  2,
	})
	if err := app.Store().UpsertKey(key, false); err != nil {
		t.Fatal(err)
	}
	// database 是用于安装明确失败触发器的独立 SQLite 连接。
	database, err := sql.Open("sqlite", app.Store().StatePath())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if _, err := database.Exec(`
		CREATE TRIGGER reject_plugin_usage_event
		BEFORE INSERT ON usage_events
		BEGIN
			SELECT RAISE(ABORT, 'reject plugin usage event');
		END`); err != nil {
		t.Fatal(err)
	}
	// intercept 是会触发按次计价的媒体请求。
	intercept, err := json.Marshal(RequestInterceptRequest{
		SourceFormat:   "openai-image",
		RequestedModel: "grok-imagine-image-quality",
		Headers:        pluginHeaders(plain),
		Body:           []byte(`{"model":"grok-imagine-image-quality","prompt":"a boat"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	// response 和 handleErr 分别表示宿主响应及同步持久化错误。
	response, handleErr := app.HandleMethod(MethodRequestInterceptBefore, intercept)
	if handleErr == nil || !strings.Contains(handleErr.Error(), "reject plugin usage event") {
		t.Fatalf("HandleMethod error = %v, want synchronous persistence failure", handleErr)
	}
	if response != nil {
		t.Fatalf("HandleMethod response = %q, want nil on persistence failure", response)
	}
	// summary 是失败事务后的实时额度，必须保持未计价状态。
	summary := app.Store().UsageSummaryFor(app.Store().Keys()[0])
	if summary.DailyUSD != 0 || summary.DailyCallCount != 0 {
		t.Fatalf("usage changed after failed interceptor transaction: %+v", summary)
	}
}
