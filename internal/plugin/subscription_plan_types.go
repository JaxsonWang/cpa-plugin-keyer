package plugin

import "github.com/JaxsonWang/cpa-plugin-keyer/internal/policy"

// subscriptionPlanWriteRequest 表示订阅计划写入接口的可选字段。
type subscriptionPlanWriteRequest struct {
	ID                  string              `json:"id"`                              // ID 是订阅计划唯一标识。
	Name                *string             `json:"name,omitempty"`                  // Name 是计划显示名称。
	RPM                 *int                `json:"rpm,omitempty"`                   // RPM 是每分钟请求上限。
	Models              *[]policy.ModelRule `json:"models,omitempty"`                // Models 是计划允许的模型及计价规则。
	DailyLimitUSD       *float64            `json:"daily_limit_usd,omitempty"`       // DailyLimitUSD 是每日美元用量上限。
	WeeklyLimitUSD      *float64            `json:"weekly_limit_usd,omitempty"`      // WeeklyLimitUSD 是每周美元用量上限。
	AllowModelsEndpoint *bool               `json:"allow_models_endpoint,omitempty"` // AllowModelsEndpoint 控制模型列表接口权限。
	ExpiresAt           *string             `json:"expires_at,omitempty"`            // ExpiresAt 是计划到期时间。
	KeyIDs              *[]string           `json:"key_ids,omitempty"`               // KeyIDs 是计划保存后的完整绑定集合。
}

// publicSubscriptionPlan 表示管理接口返回的订阅计划。
type publicSubscriptionPlan struct {
	ID                  string             `json:"id"`                              // ID 是订阅计划唯一标识。
	Name                string             `json:"name"`                            // Name 是计划显示名称。
	RPM                 int                `json:"rpm"`                             // RPM 是每分钟请求上限。
	Models              []policy.ModelRule `json:"models"`                          // Models 是计划允许的模型及计价规则。
	DailyLimitUSD       float64            `json:"daily_limit_usd"`                 // DailyLimitUSD 是每日美元用量上限。
	WeeklyLimitUSD      float64            `json:"weekly_limit_usd"`                // WeeklyLimitUSD 是每周美元用量上限。
	AllowModelsEndpoint bool               `json:"allow_models_endpoint,omitempty"` // AllowModelsEndpoint 表示是否允许访问模型列表接口。
	ExpiresAt           string             `json:"expires_at,omitempty"`            // ExpiresAt 是计划到期时间。
	KeyIDs              []string           `json:"key_ids"`                         // KeyIDs 是当前绑定的 Key ID 集合。
	CreatedAt           string             `json:"created_at,omitempty"`            // CreatedAt 是计划创建时间。
	UpdatedAt           string             `json:"updated_at,omitempty"`            // UpdatedAt 是计划最近更新时间。
}
