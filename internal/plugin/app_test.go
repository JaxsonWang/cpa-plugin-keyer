package plugin

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/JaxsonWang/cpa-plugin-keyer/internal/policy"
)

func configureTestApp(t *testing.T, rpm int) (*App, string) {
	t.Helper()
	app := NewApp()
	t.Cleanup(app.Shutdown)
	plain := "cpa_plugin_test"
	hash, err := policy.HashKey(plain)
	if err != nil {
		t.Fatal(err)
	}
	yaml := []byte(`
enabled: true
state_file: "` + filepath.ToSlash(filepath.Join(t.TempDir(), "state.db")) + `"
keys:
  - id: team-a
    name: Team A
    enabled: true
    key_hash: "` + hash + `"
    key_preview: "cpa_plu..._test"
    rpm: ` + itoaForTest(rpm) + `
    models:
      - model: gpt-5.4
        billing_mode: tokens
        input_price_per_million: 2
        output_price_per_million: 8
`)
	req, _ := json.Marshal(LifecycleRequest{ConfigYAML: yaml})
	if _, err := app.HandleMethod(MethodPluginReconfigure, req); err != nil {
		t.Fatalf("configure: %v", err)
	}
	return app, plain
}

func itoaForTest(value int) string {
	if value == 0 {
		return "0"
	}
	var digits [20]byte
	i := len(digits)
	for value > 0 {
		i--
		digits[i] = byte('0' + value%10)
		value /= 10
	}
	return string(digits[i:])
}

func decodeResult[T any](t *testing.T, raw []byte) T {
	t.Helper()
	var envelope Envelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	if !envelope.OK {
		t.Fatalf("plugin envelope failed: %+v", envelope.Error)
	}
	var result T
	if err := json.Unmarshal(envelope.Result, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func pluginHeaders(key string) http.Header {
	return http.Header{"Authorization": []string{"Bearer " + key}}
}

func websocketHeaders(key string) http.Header {
	headers := pluginHeaders(key)
	headers.Set("Connection", "keep-alive, Upgrade")
	headers.Set("Upgrade", "websocket")
	return headers
}

func TestRegistrationUsesRequestInterceptorWithoutModelRouter(t *testing.T) {
	app := NewApp()
	t.Cleanup(app.Shutdown)
	registration := app.registration()
	if !registration.Capabilities.FrontendAuthProvider || !registration.Capabilities.RequestInterceptor || !registration.Capabilities.UsagePlugin {
		t.Fatalf("required capabilities missing: %+v", registration.Capabilities)
	}
	raw, err := json.Marshal(registration)
	if err != nil {
		t.Fatal(err)
	}
	for _, removed := range []string{"model_router", "scheduler", "response_interceptor"} {
		if strings.Contains(string(raw), removed) {
			t.Fatalf("removed routing capability %q still registered: %s", removed, raw)
		}
	}
}

func TestHTTPAuthenticationDefersExactModelPolicyToInterceptor(t *testing.T) {
	app, plain := configureTestApp(t, 60)
	allowed, _ := json.Marshal(FrontendAuthRequest{
		Method:  http.MethodPost,
		Path:    "/v1/responses",
		Headers: pluginHeaders(plain),
		Body:    []byte(`{"model":"gpt-5.4"}`),
	})
	raw, err := app.HandleMethod(MethodFrontendAuthAuthenticate, allowed)
	if err != nil {
		t.Fatal(err)
	}
	response := decodeResult[FrontendAuthResponse](t, raw)
	if !response.Authenticated || response.Principal != "team-a" {
		t.Fatalf("allowed response = %+v", response)
	}
	if _, routed := response.Metadata["target_model"]; routed {
		t.Fatalf("authentication leaked removed routing metadata: %+v", response.Metadata)
	}
	allowedIntercept, _ := json.Marshal(RequestInterceptRequest{
		SourceFormat:   "openai-response",
		RequestedModel: "gpt-5.4",
		Headers:        pluginHeaders(plain),
		Body:           []byte(`{"model":"gpt-5.4"}`),
	})
	raw, err = app.HandleMethod(MethodRequestInterceptBefore, allowedIntercept)
	if err != nil {
		t.Fatal(err)
	}
	if response := decodeResult[RequestInterceptResponse](t, raw); response.Terminate {
		t.Fatalf("allowed model rejected by interceptor: %+v", response)
	}

	denied, _ := json.Marshal(FrontendAuthRequest{
		Method:  http.MethodPost,
		Path:    "/v1/responses",
		Headers: pluginHeaders(plain),
		Body:    []byte(`{"model":"gpt-5.4-mini"}`),
	})
	raw, err = app.HandleMethod(MethodFrontendAuthAuthenticate, denied)
	if err != nil {
		t.Fatal(err)
	}
	if !decodeResult[FrontendAuthResponse](t, raw).Authenticated {
		t.Fatal("valid key was reported as invalid for an unlisted model")
	}
	deniedIntercept, _ := json.Marshal(RequestInterceptRequest{
		SourceFormat:   "openai-response",
		RequestedModel: "gpt-5.4-mini",
		Headers:        pluginHeaders(plain),
		Body:           []byte(`{"model":"gpt-5.4-mini"}`),
	})
	raw, err = app.HandleMethod(MethodRequestInterceptBefore, deniedIntercept)
	if err != nil {
		t.Fatal(err)
	}
	interceptResponse := decodeResult[RequestInterceptResponse](t, raw)
	if !interceptResponse.Terminate || interceptResponse.StatusCode != http.StatusForbidden || !strings.Contains(string(interceptResponse.ResponseBody), "model_not_allowed") {
		t.Fatalf("unlisted model response = %+v, want model_not_allowed 403", interceptResponse)
	}
}

func TestHTTPWeeklyLimitKeepsLegacyKeyAuthenticatedAndReturns429(t *testing.T) {
	app, plain := configureTestApp(t, 60)
	key := app.Store().Keys()[0]
	key.WeeklyLimitUSD = 1
	if err := app.Store().UpsertKey(key, false); err != nil {
		t.Fatal(err)
	}
	if cost := app.Store().RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, policy.UsageDetail{
		Provider:    "codex",
		InputTokens: 500_000,
	}); cost != 1 {
		t.Fatalf("seed cost = %v, want 1", cost)
	}

	auth, _ := json.Marshal(FrontendAuthRequest{
		Method:  http.MethodPost,
		Path:    "/v1/responses",
		Headers: pluginHeaders(plain),
		Body:    []byte(`{"model":"gpt-5.4"}`),
	})
	raw, err := app.HandleMethod(MethodFrontendAuthAuthenticate, auth)
	if err != nil {
		t.Fatal(err)
	}
	if response := decodeResult[FrontendAuthResponse](t, raw); !response.Authenticated || response.Principal != "team-a" {
		t.Fatalf("over-budget legacy key authentication = %+v, want authenticated", response)
	}

	intercept, _ := json.Marshal(RequestInterceptRequest{
		SourceFormat:   "openai-response",
		RequestedModel: "gpt-5.4",
		Headers:        pluginHeaders(plain),
		Body:           []byte(`{"model":"gpt-5.4"}`),
	})
	raw, err = app.HandleMethod(MethodRequestInterceptBefore, intercept)
	if err != nil {
		t.Fatal(err)
	}
	response := decodeResult[RequestInterceptResponse](t, raw)
	if !response.Terminate || response.StatusCode != http.StatusTooManyRequests || !strings.Contains(string(response.ResponseBody), "weekly_exceeded") {
		t.Fatalf("weekly-limit response = %+v, want weekly_exceeded 429", response)
	}
}

func TestWebSocketHandshakeDefersLimitsToEveryExecutionFrame(t *testing.T) {
	app, plain := configureTestApp(t, 1)
	handshake, _ := json.Marshal(FrontendAuthRequest{
		Method:  http.MethodGet,
		Path:    "/v1/responses",
		Headers: websocketHeaders(plain),
	})
	for i := 0; i < 2; i++ {
		raw, err := app.HandleMethod(MethodFrontendAuthAuthenticate, handshake)
		if err != nil {
			t.Fatal(err)
		}
		if !decodeResult[FrontendAuthResponse](t, raw).Authenticated {
			t.Fatalf("handshake %d consumed or failed policy", i+1)
		}
	}

	frame, _ := json.Marshal(RequestInterceptRequest{
		SourceFormat:   "openai-response",
		RequestedModel: "gpt-5.4",
		Model:          "gpt-5.4",
		Stream:         true,
		Headers:        websocketHeaders(plain),
		Body:           []byte(`{"type":"response.create","model":"gpt-5.4"}`),
	})
	raw, err := app.HandleMethod(MethodRequestInterceptBefore, frame)
	if err != nil {
		t.Fatal(err)
	}
	if response := decodeResult[RequestInterceptResponse](t, raw); response.Terminate {
		t.Fatalf("first frame rejected: %+v", response)
	}

	raw, err = app.HandleMethod(MethodRequestInterceptBefore, frame)
	if err != nil {
		t.Fatal(err)
	}
	response := decodeResult[RequestInterceptResponse](t, raw)
	if !response.Terminate || response.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("second frame = %+v, want 429 termination", response)
	}
	if !strings.Contains(string(response.ResponseBody), "rpm_exceeded") {
		t.Fatalf("missing structured reason: %s", response.ResponseBody)
	}
}

func TestWebSocketInterceptorRejectsUnlistedModelAndIgnoresNativeKeys(t *testing.T) {
	app, plain := configureTestApp(t, 60)
	request := RequestInterceptRequest{
		SourceFormat:   "openai-response",
		RequestedModel: "gpt-5.4-mini",
		Headers:        websocketHeaders(plain),
		Body:           []byte(`{"type":"response.create","model":"gpt-5.4-mini"}`),
	}
	rawRequest, _ := json.Marshal(request)
	raw, err := app.HandleMethod(MethodRequestInterceptBefore, rawRequest)
	if err != nil {
		t.Fatal(err)
	}
	response := decodeResult[RequestInterceptResponse](t, raw)
	if !response.Terminate || response.StatusCode != http.StatusForbidden {
		t.Fatalf("unlisted model = %+v, want 403 termination", response)
	}

	request.Headers = websocketHeaders("native-key-owned-by-cpa")
	rawRequest, _ = json.Marshal(request)
	raw, err = app.HandleMethod(MethodRequestInterceptBefore, rawRequest)
	if err != nil {
		t.Fatal(err)
	}
	if response := decodeResult[RequestInterceptResponse](t, raw); response.Terminate {
		t.Fatalf("plugin intercepted another auth provider's key: %+v", response)
	}
}

func TestWebSocketInterceptorEnforcesBudgetPerExecution(t *testing.T) {
	app, plain := configureTestApp(t, 60)
	key := app.Store().Keys()[0]
	key.DailyLimitUSD = 1
	if err := app.Store().UpsertKey(key, false); err != nil {
		t.Fatal(err)
	}
	if cost := app.Store().RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, policy.UsageDetail{
		Provider:    "codex",
		InputTokens: 500_000,
	}); cost != 1 {
		t.Fatalf("seed cost = %v, want 1", cost)
	}

	frame, _ := json.Marshal(RequestInterceptRequest{
		RequestedModel: "gpt-5.4",
		Headers:        websocketHeaders(plain),
		Body:           []byte(`{"type":"response.create","model":"gpt-5.4"}`),
	})
	raw, err := app.HandleMethod(MethodRequestInterceptBefore, frame)
	if err != nil {
		t.Fatal(err)
	}
	response := decodeResult[RequestInterceptResponse](t, raw)
	if !response.Terminate || response.StatusCode != http.StatusTooManyRequests || !strings.Contains(string(response.ResponseBody), "daily_exceeded") {
		t.Fatalf("budget response = %+v, want daily-exceeded 429", response)
	}
}

func TestHTTPAuthenticationDoesNotConsumeRPMAndInterceptorCountsOnce(t *testing.T) {
	app, plain := configureTestApp(t, 1)
	auth, _ := json.Marshal(FrontendAuthRequest{
		Method:  http.MethodPost,
		Path:    "/v1/responses",
		Headers: pluginHeaders(plain),
		Body:    []byte(`{"model":"gpt-5.4"}`),
	})
	raw, err := app.HandleMethod(MethodFrontendAuthAuthenticate, auth)
	if err != nil || !decodeResult[FrontendAuthResponse](t, raw).Authenticated {
		t.Fatalf("authentication failed: %v", err)
	}
	intercept, _ := json.Marshal(RequestInterceptRequest{
		RequestedModel: "gpt-5.4",
		Headers:        pluginHeaders(plain),
		Body:           []byte(`{"model":"gpt-5.4"}`),
	})
	raw, err = app.HandleMethod(MethodRequestInterceptBefore, intercept)
	if err != nil {
		t.Fatal(err)
	}
	if response := decodeResult[RequestInterceptResponse](t, raw); response.Terminate {
		t.Fatalf("first HTTP execution rejected: %+v", response)
	}

	// Re-authentication still only validates identity and must not consume RPM.
	raw, err = app.HandleMethod(MethodFrontendAuthAuthenticate, auth)
	if err != nil || !decodeResult[FrontendAuthResponse](t, raw).Authenticated {
		t.Fatalf("second authentication failed: %v", err)
	}
	raw, err = app.HandleMethod(MethodRequestInterceptBefore, intercept)
	if err != nil {
		t.Fatal(err)
	}
	response := decodeResult[RequestInterceptResponse](t, raw)
	if !response.Terminate || response.StatusCode != http.StatusTooManyRequests || !strings.Contains(string(response.ResponseBody), "rpm_exceeded") {
		t.Fatalf("second HTTP execution = %+v, want rpm_exceeded 429", response)
	}
}

func TestHTTPQueryKeyKeepsAuthenticationTimePolicyEnforcement(t *testing.T) {
	app, plain := configureTestApp(t, 1)
	auth, _ := json.Marshal(FrontendAuthRequest{
		Method: http.MethodPost,
		Path:   "/v1/responses",
		Query:  map[string][]string{"api_key": {plain}},
		Body:   []byte(`{"model":"gpt-5.4"}`),
	})
	raw, err := app.HandleMethod(MethodFrontendAuthAuthenticate, auth)
	if err != nil || !decodeResult[FrontendAuthResponse](t, raw).Authenticated {
		t.Fatalf("first query-key authentication failed: %v", err)
	}

	// The interceptor ABI has no query field. The original auth-time policy
	// path must therefore have consumed exactly one RPM slot for this request.
	raw, err = app.HandleMethod(MethodFrontendAuthAuthenticate, auth)
	if err != nil {
		t.Fatal(err)
	}
	if response := decodeResult[FrontendAuthResponse](t, raw); response.Authenticated {
		t.Fatalf("second query-key request bypassed RPM policy: %+v", response)
	}
}

func TestFrontendAuthenticationRejectsUnknownAndDisabledKeys(t *testing.T) {
	app, plain := configureTestApp(t, 60)

	for name, key := range map[string]string{
		"unknown":  "native-key-owned-by-cpa",
		"disabled": plain,
	} {
		if name == "disabled" {
			configured := app.Store().Keys()[0]
			configured.Enabled = false
			if err := app.Store().UpsertKey(configured, false); err != nil {
				t.Fatal(err)
			}
		}
		request, _ := json.Marshal(FrontendAuthRequest{
			Method:  http.MethodPost,
			Path:    "/v1/responses",
			Headers: pluginHeaders(key),
			Body:    []byte(`{"model":"gpt-5.4"}`),
		})
		raw, err := app.HandleMethod(MethodFrontendAuthAuthenticate, request)
		if err != nil {
			t.Fatal(err)
		}
		if response := decodeResult[FrontendAuthResponse](t, raw); response.Authenticated {
			t.Fatalf("%s key authenticated: %+v", name, response)
		}
	}
}

func TestModelsEndpointPermissionRemainsInFrontendAuthentication(t *testing.T) {
	app, plain := configureTestApp(t, 60)
	request, _ := json.Marshal(FrontendAuthRequest{
		Method:  http.MethodGet,
		Path:    "/v1/models",
		Headers: pluginHeaders(plain),
	})

	raw, err := app.HandleMethod(MethodFrontendAuthAuthenticate, request)
	if err != nil {
		t.Fatal(err)
	}
	if response := decodeResult[FrontendAuthResponse](t, raw); response.Authenticated {
		t.Fatalf("models endpoint authenticated while disabled: %+v", response)
	}

	key := app.Store().Keys()[0]
	key.AllowModelsEndpoint = true
	if err := app.Store().UpsertKey(key, false); err != nil {
		t.Fatal(err)
	}
	raw, err = app.HandleMethod(MethodFrontendAuthAuthenticate, request)
	if err != nil {
		t.Fatal(err)
	}
	if response := decodeResult[FrontendAuthResponse](t, raw); !response.Authenticated {
		t.Fatalf("models endpoint rejected while enabled: %+v", response)
	}
}

func TestPerCallMediaIsPreChargedOnceByHTTPInterceptor(t *testing.T) {
	app, plain := configureTestApp(t, 60)
	key := app.Store().Keys()[0]
	key.Models = append(key.Models, policy.ModelRule{
		Model:       "grok-imagine-image-quality",
		BillingMode: "per_call",
		PerCallUSD:  2,
	})
	if err := app.Store().UpsertKey(key, false); err != nil {
		t.Fatal(err)
	}

	auth, _ := json.Marshal(FrontendAuthRequest{
		Method:  http.MethodPost,
		Path:    "/v1/images/generations",
		Headers: pluginHeaders(plain),
		Body:    []byte(`{"model":"grok-imagine-image-quality","prompt":"a boat"}`),
	})
	raw, err := app.HandleMethod(MethodFrontendAuthAuthenticate, auth)
	if err != nil || !decodeResult[FrontendAuthResponse](t, raw).Authenticated {
		t.Fatalf("media authentication failed: %v", err)
	}
	if summary := app.Store().UsageSummaryFor(app.Store().Keys()[0]); summary.DailyUSD != 0 || summary.DailyCallCount != 0 {
		t.Fatalf("frontend auth pre-charged media usage: %+v", summary)
	}

	intercept, _ := json.Marshal(RequestInterceptRequest{
		SourceFormat:   "openai-image",
		RequestedModel: "grok-imagine-image-quality",
		Headers:        pluginHeaders(plain),
		Body:           []byte(`{"model":"grok-imagine-image-quality","prompt":"a boat"}`),
	})
	raw, err = app.HandleMethod(MethodRequestInterceptBefore, intercept)
	if err != nil {
		t.Fatal(err)
	}
	if response := decodeResult[RequestInterceptResponse](t, raw); response.Terminate {
		t.Fatalf("media request rejected: %+v", response)
	}
	if summary := app.Store().UsageSummaryFor(app.Store().Keys()[0]); summary.DailyUSD != 2 || summary.DailyCallCount != 1 {
		t.Fatalf("media pre-charge summary = %+v, want one $2 call", summary)
	}
}

func TestUsageUsesActualProviderAndExactModel(t *testing.T) {
	app, _ := configureTestApp(t, 60)
	request, _ := json.Marshal(UsageHandleRequest{
		Provider: "codex",
		Model:    "gpt-5.4",
		Alias:    "gpt-5.4",
		APIKey:   "team-a",
		Detail: UsageDetail{
			InputTokens:  1_000_000,
			OutputTokens: 1_000_000,
		},
	})
	if _, err := app.HandleMethod(MethodUsageHandle, request); err != nil {
		t.Fatal(err)
	}
	key, rows, ok := app.Store().ModelUsageFor("team-a")
	if !ok || len(rows) != 1 || rows[0].Model != "gpt-5.4" {
		t.Fatalf("usage rows = %+v, key = %+v", rows, key)
	}
	if got := app.Store().UsageSummaryFor(key).DailyUSD; got != 10 {
		t.Fatalf("daily cost = %v, want 10", got)
	}
}

func TestManagementRegistrationOmitsRemovedRoutes(t *testing.T) {
	app := NewApp()
	t.Cleanup(app.Shutdown)
	registration := app.managementRegistration()
	for _, route := range registration.Routes {
		for _, removed := range []string{"/aliases", "/classify", "/catalog"} {
			if strings.Contains(route.Path, removed) {
				t.Fatalf("removed route still registered: %+v", route)
			}
		}
	}
}

func TestRegistrationUsesCpaKeyerIdentity(t *testing.T) {
	app := NewApp()
	t.Cleanup(app.Shutdown)
	registration := app.registration()
	if PluginID != "cpa-keyer" || registration.Metadata.Name != "Keyer" {
		t.Fatalf("plugin identity = %q / %q, want cpa-keyer / Keyer", PluginID, registration.Metadata.Name)
	}
	if registration.Metadata.Version != "0.7.1" {
		t.Fatalf("plugin version = %q, want 0.7.1", registration.Metadata.Version)
	}
	if registration.Metadata.GitHubRepository != "https://github.com/JaxsonWang/cpa-plugin-keyer" {
		t.Fatalf("repository = %q", registration.Metadata.GitHubRepository)
	}
}

func TestManagementResourceUsesKeyerDisplayName(t *testing.T) {
	app := NewApp()
	t.Cleanup(app.Shutdown)
	resources := app.managementRegistration().Resources
	if len(resources) != 1 || resources[0].Menu != "Keyer" {
		t.Fatalf("management resources = %+v, want Keyer menu", resources)
	}
}

func TestManagementRegistrationIncludesGlobalUsageReset(t *testing.T) {
	app := NewApp()
	t.Cleanup(app.Shutdown)
	for _, route := range app.managementRegistration().Routes {
		if route.Method == http.MethodPost && route.Path == "/plugins/cpa-keyer/keys/reset-usage" {
			return
		}
	}
	t.Fatal("global usage reset route was not registered")
}

func TestManagementRegistrationIncludesUsageReportingRoutes(t *testing.T) {
	app := NewApp()
	t.Cleanup(app.Shutdown)
	wanted := map[string]bool{
		"/plugins/cpa-keyer/usage/overview": false,
		"/plugins/cpa-keyer/usage/analysis": false,
		"/plugins/cpa-keyer/usage/events":   false,
	}
	for _, route := range app.managementRegistration().Routes {
		if route.Method == http.MethodGet {
			if _, ok := wanted[route.Path]; ok {
				wanted[route.Path] = true
			}
		}
	}
	for path, found := range wanted {
		if !found {
			t.Fatalf("usage reporting route not registered: %s", path)
		}
	}
}

func TestManagementUsageReportingUsesKeyIDAndRealUsageFields(t *testing.T) {
	app, plain := configureTestApp(t, 60)
	usageRequest, _ := json.Marshal(UsageHandleRequest{
		Provider: "codex", Model: "gpt-5.4", Alias: "gpt-5.4", APIKey: "team-a",
		Detail: UsageDetail{InputTokens: 1_000, OutputTokens: 200, ReasoningTokens: 50, CachedTokens: 100, TotalTokens: 1_200},
	})
	if _, err := app.HandleMethod(MethodUsageHandle, usageRequest); err != nil {
		t.Fatal(err)
	}
	failedRequest, _ := json.Marshal(UsageHandleRequest{
		Provider: "codex", Model: "gpt-5.4", Alias: "gpt-5.4", APIKey: "team-a", Failed: true,
	})
	if _, err := app.HandleMethod(MethodUsageHandle, failedRequest); err != nil {
		t.Fatal(err)
	}
	callManagement := func(path string) ManagementResponse {
		t.Helper()
		request, _ := json.Marshal(ManagementRequest{
			Method: http.MethodGet,
			Path:   path,
			Query:  map[string][]string{"range": {"24h"}, "key_id": {"team-a"}},
		})
		raw, err := app.HandleMethod(MethodManagementHandle, request)
		if err != nil {
			t.Fatal(err)
		}
		response := decodeResult[ManagementResponse](t, raw)
		if response.StatusCode != http.StatusOK {
			t.Fatalf("management response = %+v", response)
		}
		return response
	}

	overviewResponse := callManagement("/v0/management/plugins/cpa-keyer/usage/overview")
	var overview policy.UsageOverview
	if err := json.Unmarshal(overviewResponse.Body, &overview); err != nil {
		t.Fatal(err)
	}
	if overview.Totals.RequestCount != 2 || overview.Totals.SuccessCount != 1 || overview.Totals.FailureCount != 1 || overview.Totals.TotalTokens != 1_200 {
		t.Fatalf("overview totals = %+v", overview.Totals)
	}

	analysisResponse := callManagement("/v0/management/plugins/cpa-keyer/usage/analysis")
	var analysis policy.UsageAnalysis
	if err := json.Unmarshal(analysisResponse.Body, &analysis); err != nil {
		t.Fatal(err)
	}
	if len(analysis.ByKey) != 1 || analysis.ByKey[0].Name != "team-a" || len(analysis.ByProvider) != 1 || analysis.ByProvider[0].Name != "codex" {
		t.Fatalf("analysis = %+v", analysis)
	}

	eventsResponse := callManagement("/v0/management/plugins/cpa-keyer/usage/events")
	var events policy.UsageEventPage
	if err := json.Unmarshal(eventsResponse.Body, &events); err != nil {
		t.Fatal(err)
	}
	if events.Total != 2 || events.Events[0].KeyID != "team-a" || events.Events[0].KeyPreview != policy.MaskKeyPreview(policy.PreviewKey(plain)) || events.Events[0].Provider != "codex" {
		t.Fatalf("events = %+v", events)
	}
	if strings.Contains(string(eventsResponse.Body), plain) || strings.Contains(string(eventsResponse.Body), "cpa_plugin_test") {
		t.Fatalf("request events exposed the raw downstream key: %s", eventsResponse.Body)
	}
}

func TestManagementResetUsageClearsDailyAndWeeklyAndPersists(t *testing.T) {
	app, _ := configureTestApp(t, 60)
	if cost := app.Store().RecordUsage("team-a", "gpt-5.4", "gpt-5.4", false, policy.UsageDetail{
		Provider:    "codex",
		InputTokens: 1_000_000,
	}); cost != 2 {
		t.Fatalf("seed cost = %v, want 2", cost)
	}

	before := app.Store().UsageSummaryFor(app.Store().Keys()[0])
	if before.DailyUSD != 2 || before.WeeklyUSD != 2 {
		t.Fatalf("usage before reset = %+v, want daily and weekly usage", before)
	}

	request, _ := json.Marshal(ManagementRequest{
		Method: http.MethodPost,
		Path:   "/v0/management/plugins/cpa-keyer/keys/reset-usage",
	})
	raw, err := app.HandleMethod(MethodManagementHandle, request)
	if err != nil {
		t.Fatal(err)
	}
	response := decodeResult[ManagementResponse](t, raw)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("reset response = %+v, body = %s", response, response.Body)
	}

	after := app.Store().UsageSummaryFor(app.Store().Keys()[0])
	if after.DailyUSD != 0 || after.WeeklyUSD != 0 || after.DailyCallCount != 0 || after.WeeklyCallCount != 0 {
		t.Fatalf("usage after reset = %+v, want zero daily and weekly usage", after)
	}
	reloaded := policy.NewStore()
	t.Cleanup(func() { _ = reloaded.Close() })
	if err := reloaded.Configure(policy.Config{Enabled: true, StateFile: app.Store().StatePath()}); err != nil {
		t.Fatal(err)
	}
	persisted := reloaded.UsageSummaryFor(reloaded.Keys()[0])
	if persisted.DailyUSD != 0 || persisted.WeeklyUSD != 0 || persisted.DailyCallCount != 0 || persisted.WeeklyCallCount != 0 {
		t.Fatalf("persisted usage after reset = %+v, want empty", persisted)
	}
}
