# cpa-keyer

面向 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 的下游 API Key 策略插件，支持 WebSocket。

插件签发自有的 `cpa_…` Key，在不覆盖 CPA 模型解析的前提下执行精确模型白名单、RPM、每日/每周美元预算以及按 Token/按次计费。

| | |
|---|---|
| **仓库** | [JaxsonWang/cpa-plugin-keyer](https://github.com/JaxsonWang/cpa-plugin-keyer) |
| **协议** | MIT |
| **English** | [README.md](./README.md) |

## 配置

CLIProxyAPI 插件配置：

```yaml
plugins:
  enabled: true
  dir: "plugins"
  configs:
    cpa-keyer:
      enabled: true
      priority: 10
      state_file: "cpa-keyer-state.db"
```

CPA 插件商店源：

```text
https://raw.githubusercontent.com/JaxsonWang/cpa-plugin-keyer/main/registry.json
```

将该地址添加到 `plugins.store-sources`，然后选择 `JaxsonWang` 来源中的 `cpa-keyer`。

Key 策略、用量和请求事件统一保存在 SQLite `state_file` 中。通过管理网页或管理 API 创建 Key，明文 Key 只返回一次。不要把插件签发的 Key 同时加入 CPA 原生 `api-keys`，否则会产生一条独立的原生认证路径。

### 按 Key 过滤模型列表

Keyer 提供 `/v0/resource/plugins/cpa-keyer/viewer/models`。已知、启用且开启 `allow_models_endpoint` 的 Keyer Key 只会得到当前 Key 直接配置或订阅方案生效后的模型；禁用、过期或关闭模型列表权限的 Keyer Key 返回 `401`；Keyer 不认识的 Key 返回仅供反向代理分流的 `418`，由 Nginx 将 CPA 原生 Key 交回 CPA 原始模型列表。

使用 Nginx 精确路径，避免影响推理和流式请求。以下 `HOST:PORT` 必须指向 CPA 内部监听地址，不能指向当前 Nginx 公共入口：

```nginx
location = /v1/models {
    proxy_intercept_errors on;
    error_page 418 = /__native_v1_models;
    proxy_pass http://HOST:PORT/v0/resource/plugins/cpa-keyer/viewer/models;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Host $host;
}

location = /__native_v1_models {
    internal;
    proxy_pass http://HOST:PORT/v1/models;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Host $host;
}

location = /openai/v1/models {
    proxy_intercept_errors on;
    error_page 418 = /__native_openai_models;
    proxy_pass http://HOST:PORT/v0/resource/plugins/cpa-keyer/viewer/models;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Host $host;
}

location = /__native_openai_models {
    internal;
    proxy_pass http://HOST:PORT/openai/v1/models;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Host $host;
}
```

重载前先执行 `nginx -t`。Keyer Key 使用过滤结果，CPA 原生 Key 保持 CPA 全局模型列表行为。

## 管理网页

插件加载后访问：

```text
http://HOST:PORT/v0/resource/plugins/cpa-keyer/index.html
```

使用 CPA management secret 登录。网页提供 Key 管理、真实模型选择、models.dev 价格同步、预算/RPM 策略、按模型用量、概览图表、用量分析和请求事件。管理密钥只保存在浏览器内存，不写入 `localStorage`。

### Key 详情只读访问

无需输入 CPA management secret，也无需经过 `management.html`，可以直接使用当前 Key 打开只读页面：

```text
https://HOST:8317/v0/resource/plugins/cpa-keyer/index.html#/key/<KEY>
```

该地址使用 Key 作为 bearer credential，只允许访问当前 Key 的“Key 详情”“概览”和“请求事件”。Viewer 不提供新增、编辑、删除、轮换、启停、重置额度、重置 RPM 或跨 Key 访问。页面内导航始终保留 `/key/<KEY>` 范围，包括 `/overview` 和 `/events`。

Key 只保存在 URL fragment 和浏览器内存，不写入 `localStorage`。完整地址应按密钥处理，因为获得该 Key 的人可以使用它已经拥有的下游访问权限。

开发模式：

```bash
cd web
npm ci
VITE_CPA_BASE=http://127.0.0.1:8317 npm run dev
```

## 管理 API

`/v0/management/plugins/cpa-keyer` 下的插件接口：

- `GET/POST/PATCH/DELETE /keys`；
- `POST /keys/rotate`；
- `POST /keys/reset-rpm`；
- `POST /keys/reset-usage`（清空所有 Key 的每日与每周用量）；
- `GET /keys/usage`；
- `GET /usage/overview`；
- `GET /usage/analysis`；
- `GET /usage/events`；
- `GET /status`。

创建 Key，`plain_key` 只返回一次：

```bash
curl -X POST "$CPA/v0/management/plugins/cpa-keyer/keys" \
  -H "Authorization: Bearer $MANAGEMENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "team-a",
    "name": "Team A",
    "rpm": 60,
    "daily_limit_usd": 10,
    "weekly_limit_usd": 50,
    "models": [
      {
        "model": "gpt-5.4",
        "billing_mode": "tokens",
        "input_price_per_million": 2,
        "output_price_per_million": 8,
        "cache_read_price_per_million": 0.2
      }
    ]
  }'
```

## 构建与测试

```bash
go test ./...

gofmt -w internal/plugin internal/policy
go vet ./...
go test -race ./internal/policy ./internal/plugin

cd web
npm ci
npm test
npm run typecheck
npm run build
```

构建内嵌网页和 Linux 共享库：

```bash
make web-build
make build-linux-amd64
# 或：make build-linux
```
