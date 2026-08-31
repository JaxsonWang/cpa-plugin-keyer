package plugin

import (
	"net/http"

	"github.com/JaxsonWang/cpa-plugin-keyer/internal/plugin/web"
	"github.com/JaxsonWang/cpa-plugin-keyer/internal/policy"
)

const (
	// viewerKeyPath 是读取当前下游 Key 详情的只读资源路径。
	viewerKeyPath = "/viewer/key"
	// viewerKeyUsagePath 是读取当前下游 Key 模型用量的只读资源路径。
	viewerKeyUsagePath = "/viewer/key/usage"
	// viewerUsageOverviewPath 是读取当前下游 Key 用量概览的只读资源路径。
	viewerUsageOverviewPath = "/viewer/usage/overview"
	// viewerUsageAnalysisPath 是读取当前下游 Key 用量分析的只读资源路径。
	viewerUsageAnalysisPath = "/viewer/usage/analysis"
	// viewerUsageEventsPath 是读取当前下游 Key 请求事件的只读资源路径。
	viewerUsageEventsPath = "/viewer/usage/events"
	// viewerModelsPath 是按当前下游 Key 返回 OpenAI 兼容模型列表的资源路径。
	viewerModelsPath = "/viewer/models"
	// viewerModelsFallbackStatus 通知反向代理当前凭据不属于 Keyer，应交回 CPA 原生认证链。
	viewerModelsFallbackStatus = http.StatusTeapot
)

// viewerModelsResponse 表示 OpenAI 兼容的模型列表响应。
type viewerModelsResponse struct {
	// Object 是模型列表对象类型。
	Object string `json:"object"`
	// Data 是当前 Key 被允许访问的模型条目。
	Data []viewerModel `json:"data"`
}

// viewerModel 表示 OpenAI 兼容模型列表中的单个模型。
type viewerModel struct {
	// ID 是客户端请求模型时使用的精确名称。
	ID string `json:"id"`
	// Object 是模型条目的对象类型。
	Object string `json:"object"`
	// Created 是兼容 OpenAI 协议的稳定创建时间占位值。
	Created int64 `json:"created"`
	// OwnedBy 标识模型列表由 Keyer 当前策略生成。
	OwnedBy string `json:"owned_by"`
}

// handleViewerResource 通过插件实例 a 根据 path 处理只读资源；req 携带当前请求凭据和筛选参数。
func (a *App) handleViewerResource(path string, req ManagementRequest) ManagementResponse {
	switch path {
	case viewerKeyPath, viewerKeyUsagePath, viewerUsageOverviewPath, viewerUsageAnalysisPath, viewerUsageEventsPath, viewerModelsPath:
	default:
		// status、headers 和 body 分别是静态网页资源的状态码、响应头和响应体。
		status, headers, body := web.Serve(path)
		return ManagementResponse{StatusCode: status, Headers: headers, Body: body}
	}

	if path == viewerModelsPath {
		return a.handleViewerModels(req)
	}

	// key 是通过当前 bearer 凭据解析出的 Key；ok 表示该 Key 可使用 Viewer。
	key, ok := a.viewerKey(req.Headers)
	if !ok {
		return jsonError(http.StatusUnauthorized, "viewer_unauthorized", "key is invalid or unavailable")
	}

	// filter 是强制限定到当前 Key 的用量查询条件。
	filter := usageFilterFromQuery(req.Query)
	filter.KeyID = key.ID
	switch path {
	case viewerKeyPath:
		return jsonResponse(http.StatusOK, map[string]any{"keys": a.publicKeys([]policy.KeyConfig{key})})
	case viewerKeyUsagePath:
		return a.keyUsage(key.ID)
	case viewerUsageOverviewPath:
		// overview 是当前 Key 的用量概览；err 表示 SQLite 查询错误。
		overview, err := a.store.UsageOverview(filter)
		if err != nil {
			return jsonError(http.StatusInternalServerError, "usage_store_error", err.Error())
		}
		return jsonResponse(http.StatusOK, overview)
	case viewerUsageAnalysisPath:
		// analysis 是当前 Key 的用量分析；err 表示 SQLite 查询错误。
		analysis, err := a.store.UsageAnalysis(filter)
		if err != nil {
			return jsonError(http.StatusInternalServerError, "usage_store_error", err.Error())
		}
		return jsonResponse(http.StatusOK, analysis)
	case viewerUsageEventsPath:
		// page 是请求事件页码。
		page := positiveQueryInt(req.Query, "page", 1)
		// pageSize 是每页请求事件数量。
		pageSize := positiveQueryInt(req.Query, "page_size", 50)
		// events 是当前 Key 的请求事件页；err 表示 SQLite 查询错误。
		events, err := a.store.UsageEvents(filter, page, pageSize)
		if err != nil {
			return jsonError(http.StatusInternalServerError, "usage_store_error", err.Error())
		}
		return jsonResponse(http.StatusOK, events)
	}
	return jsonError(http.StatusNotFound, "not_found", "unknown viewer route")
}

// handleViewerModels 通过插件实例 a 按 req 中的凭据返回当前 Key 的有效模型列表；未知凭据交给反向代理回退 CPA。
func (a *App) handleViewerModels(req ManagementRequest) ManagementResponse {
	// decision 是复用模型列表策略链得到的认证和权限判定。
	decision := a.store.Authenticate(http.MethodGet, "/v1/models", req.Headers, req.Query, nil)
	if !decision.Known {
		return ManagementResponse{StatusCode: viewerModelsFallbackStatus}
	}
	if !decision.Allowed {
		return jsonError(http.StatusUnauthorized, "models_unauthorized", "model list is unavailable for this key")
	}

	// key 是应用订阅方案后的有效 Key 策略；ok 表示策略仍存在。
	key, ok := a.store.EffectiveKey(decision.KeyID)
	if !ok {
		return jsonError(http.StatusInternalServerError, "key_policy_unavailable", "key policy is unavailable")
	}
	// models 保存按有效策略顺序生成的 OpenAI 兼容模型条目。
	models := make([]viewerModel, 0, len(key.Models))
	// rule 是当前转换的模型白名单规则。
	for _, rule := range key.Models {
		models = append(models, viewerModel{
			ID:      rule.Model,
			Object:  "model",
			Created: 0,
			OwnedBy: PluginID,
		})
	}
	return jsonResponse(http.StatusOK, viewerModelsResponse{Object: "list", Data: models})
}

// viewerKey 通过插件实例 a 根据 headers 验证 Viewer 凭据，并返回当前原始 Key 策略及是否可读。
func (a *App) viewerKey(headers http.Header) (policy.KeyConfig, bool) {
	// decision 是只验证 Key 身份和启用状态的 Viewer 认证结果。
	decision := a.store.AuthenticateKey(headers, nil)
	if !decision.Known || !decision.Allowed {
		return policy.KeyConfig{}, false
	}
	return a.keyByID(decision.KeyID)
}
