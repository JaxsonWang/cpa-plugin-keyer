# cpa-keyer（中文说明）

面向 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 的 WebSocket 兼容下游 API Key 策略插件。

插件签发 `cpa_…` key，在不覆盖 CPA 模型解析的前提下执行精确模型白名单、RPM、每日/每周预算以及 token/按次计费。

| | |
|---|---|
| **仓库** | [JaxsonWang/cpa-plugin-keyer](https://github.com/JaxsonWang/cpa-plugin-keyer) |
| **协议** | MIT |
| **English** | [README.md](./README.md) |

## v0.7.7 筛选精简与导航图标

请求事件筛选仅保留时间范围、Key ID、供应商和结果。导航图标在浅色与暗色主题下均保持
清晰的 Phosphor 图标填充，不再被全局 SVG 描边样式覆盖。

## v0.7.6 CPA 菜单切换崩溃修复

主题与语言同步不再从 CPA 父页面创建跨 iframe `MutationObserver`，避免 CPA
切换路由并移除插件 iframe 后，父页面继续持有已销毁子页面的回调与渲染资源。
初始样式仍从 CPA DOM 读取，后续切换通过同源 `storage` 事件同步；ECharts
仅在 React 正常卸载时释放，不再在 iframe `pagehide` 阶段强制执行跨组件清理。

## v0.7.5 SQLite 迁移修复

SQLite schema 升级现在使用即时写事务串行化，并在持有写锁后重新检查版本与已有列。
重复的 `plugin.reconfigure` 或上次留下的部分迁移状态不会再因重复添加列而阻止插件注册。

## v0.7.4 导航与 iframe 生命周期

新建 Key 现在固定显示在内嵌顶部导航中，独立桌面界面也统一改为顶部横向菜单，不再使用
左侧栏。CPA 移除插件 iframe 时，Keyer 会先断开宿主观察器并释放全部 ECharts 渲染资源，
再销毁 iframe 上下文。旧请求事件缺少的运行维度统一显示为“未记录”，不再直接展示内部
`unknown` 标记。

## v0.7.3 用量分析、CPA 融合界面与 SQLite 状态

内嵌界面现已跟随 CPA 的浅色、白色和深色管理主题，并通过紧凑的插件内导航整合
概览、请求事件、Key 列表与新建 Key。原生浏览器弹窗和插件内部重复的退出功能已经移除；
Key 列表支持将单个或批量 Key 的每日、每周用量上限重置为 `0`。

概览页合并展示请求/Token 趋势、延迟与首字延迟分位数、缓存效率、费用构成、
执行器/认证方式/请求来源/服务层级分布，以及 Key × 模型热力图。请求事件保留 Key ID，
并在来源中展示 `cpa_*****wxyz` 这样的脱敏 Key，始终不保存明文凭据；同时记录 CPA
`usage.handle` 实际提供的时间、供应商、请求/实际模型、推理强度、执行器、认证方式、
请求来源、服务层级、失败 HTTP 状态、总延迟、首字延迟、Token 明细、计费方式和预估费用。
历史保留 90 天，不再设置固定事件条数上限。

`state_file` 现在是唯一的 SQLite 数据库，统一保存 Key 配置、模型规则、每日/每周累计
状态和逐请求事件；运行时不再使用 JSON state 文件持久化，也不会由 15 秒用量刷新器反复整文件
重写。现有 JSON state 必须先备份并显式导入新的 `.db` 文件，核对 Key、累计状态和
事件数量后再切换插件配置；完成校验前保留原 JSON 文件。

请在 CPA 已停止或不再写入旧 JSON 时执行离线迁移：

```bash
go run ./cmd/cpa-keyer-state-migrate \
  -source /CLIProxyAPI/data/cpa-key-policy-state.json \
  -destination /CLIProxyAPI/data/cpa-key-policy-state.db
```

命令会在同一事务中导入 Key、归一化后的模型规则、每日/每周累计状态和保留期内的请求
事件，随后校验完整状态与事件内容并执行 SQLite checkpoint。旧 JSON 不会被修改，目标
数据库已存在时也不会覆盖。

## v0.6.0 更名与管理界面

插件 ID 已从 `cpa-key-policy` 改为 `cpa-keyer`，仓库改为
[`JaxsonWang/cpa-plugin-keyer`](https://github.com/JaxsonWang/cpa-plugin-keyer)，共享库、
压缩包、管理 API 和资源路径均使用新名称；CPA 后台展示名统一为 `Keyer`。新界面内置全部样式与 SVG，不依赖 CDN；
模型价格可通过“同步价格”从 `https://models.dev/api.json` 按精确模型名批量更新，
新增/编辑 Key 在进入模型选择器前会保留全部表单草稿。

更名不会改变现有 `cpa_…` Key。升级时先记录并备份旧配置
`plugins.configs.cpa-key-policy.state_file` 指向的 JSON 文件，将其导入新的 SQLite
数据库后，再把 `.db` 路径写入 `plugins.configs.cpa-keyer.state_file`。不要直接用
新的空库替代旧状态；全新安装使用默认的 `cpa-keyer-state.db`。

## v0.5.3 旧 Key 兼容

旧 JSON 导入 SQLite 后，已有插件 Key 继续有效，升级无需新建或轮换 Key。前端鉴权现在只
确认 Key 身份，模型、RPM、每日/每周预算在请求拦截阶段执行。已启用 Key 超出
限制时，会返回带 `rpm_exceeded`、`daily_exceeded` 或 `weekly_exceeded` 的
结构化 `429`，不会再被 CPA 合并成 `401 Invalid API key`；模型未授权则返回
`403 model_not_allowed`。

未知 Key、已禁用 Key、CPA 原生 Key、已有用量数据、图片/视频按次预扣以及
`allow_models_endpoint` 行为均保持不变。

## v0.5.x 行为

核心不变量：

> 插件不再路由或改写模型。客户端必须发送 CPA 能原生解析的真实模型名；插件只判断该精确模型名是否允许。

这样 CPA 可以继续使用原生 Responses WebSocket。插件只注册：

- 前端鉴权；
- 请求拦截；
- 用量统计；
- 管理 API 与内嵌 UI。

不再注册 `model.route`、scheduler 或响应拦截器。

### 保留

- `cpa_…` key 鉴权；
- 精确且大小写不敏感的模型白名单；
- 单 key RPM；
- 每日与滚动每周美元上限；
- token 单价与固定按次计费；
- 单 key/单模型用量及金额统计；
- key 创建、编辑、轮换、撤销、RPM 重置、全局每日/每周用量重置与用量 UI；
- `GET /v1/models` 的二值 `allow_models_endpoint` 权限。

### 删除

- 别名及模型名改写；
- 指定 provider；
- 多目标 priority/round-robin；
- 凭证 group/tier 调度；
- 自定义凭证分类；
- 插件侧 catalog 聚合。

模型选择器中的 provider 只用于展示 CPA 发现结果，不写入 key policy，也不参与运行时路由。

## WebSocket 修复原理

旧版 `model.route` 返回已处理的模型覆盖后，CPA 会关闭该请求的原生 WebSocket passthrough。带 `previous_response_id` / `response.append` 的增量帧可能要求 HTTP replay，日志出现：

```text
1012 upstream requires HTTP replay
```

v0.5.0 让 CPA 原生解析真实模型：

1. 前端鉴权只确认 `cpa_…` key 存在且启用；鉴权本身不消耗 RPM，也不判断执行预算。
2. 每个 HTTP 或 WebSocket 模型执行进入 `request.intercept_before` 后，使用原始 Authorization header 检查真实模型、RPM 与预算。
3. 图片/视频固定按次计费仍在请求拦截阶段预扣一次。
4. 未知 key 或 CPA 原生 key 交给其他 CPA 鉴权 provider，不受本插件干扰。

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

将该 URL 添加到 `plugins.store-sources`，然后选择 `JaxsonWang` 来源的
`cpa-keyer`。如果已经安装官方源中的 `origin652` 版本，需要先卸载该插件
条目再切换商店来源。卸载前先记录
`plugins.configs.cpa-key-policy.state_file`，因为卸载会清除旧插件配置，但不会删除
独立的 state file。先把旧 JSON 导入新的 SQLite 数据库，再将 `.db` 路径配置给
`cpa-keyer`，最后打开页面核对原有 Key 与用量数据。

规范的 key policy：

```yaml
enabled: true
state_file: ./cpa-keyer-state.db

keys:
  - id: team-a
    name: Team A
    enabled: true
    key_hash: "sha256:REPLACE_WITH_SHA256_HEX"
    key_preview: "cpa_..."
    rpm: 60
    daily_limit_usd: 10
    weekly_limit_usd: 50
    allow_models_endpoint: false
    models:
      - model: gpt-5.4
        billing_mode: tokens
        input_price_per_million: 2
        output_price_per_million: 8
        cache_read_price_per_million: 0.2
```

优先使用网页或管理 API 生成 key；明文只返回一次。插件 key 不要再加入 CPA 原生 `api-keys`，否则会形成另一条原生鉴权路径。

SQLite state file 一旦初始化，其中的 keys 与 usage 就是运行时数据源；[`config.example.yaml`](./config.example.yaml) 中的 Key 只用于初始化新的空数据库。

## 旧 v0.4.x 模型规则

显式把旧 JSON state 导入 SQLite 时，模型规则按以下方式归一化；仅把
`state_file` 指向 JSON 文件不会自动执行迁移：

- 旧直连规则的 `target_model` 迁移为 `{model: target_model}`；
- 旧全局别名的每个 target 迁移成一个真实模型；
- 多 target 拆成多个允许的真实模型；
- 同名真实模型去重；
- 删除 alias/provider/group 路由字段；
- 保留定价；
- 旧 `usage.by_alias` 作为历史 residual 保留，因为旧别名无法可靠归属到某一个 target model。

导入后：

- 客户端必须发送真实 CPA 模型名，旧别名请求名不再生效；
- 核对 Key、累计用量和请求事件数量前保留原 JSON 备份；
- 新建 Codex session 或重启客户端，旧 session 可能已经缓存 SSE fallback。

## 管理网页

插件加载后访问：

```text
http://HOST:PORT/v0/resource/plugins/cpa-keyer/index.html
```

使用 CPA management secret 登录。网页提供 Key 管理、真实模型选择、models.dev 价格同步、预算/RPM、按模型用量、概览图表、分析与请求事件；管理密钥只保存在内存，不写 `localStorage`。

开发模式：

```bash
cd web
npm ci
VITE_CPA_BASE=http://127.0.0.1:8317 npm run dev
```

## 管理 API

`/v0/management/plugins/cpa-keyer` 下只保留：

- `GET/POST/PATCH/DELETE /keys`；
- `POST /keys/rotate`；
- `POST /keys/reset-rpm`；
- `POST /keys/reset-usage`（清空所有 key 的每日与每周用量）；
- `GET /keys/usage`；
- `GET /usage/overview`；
- `GET /usage/analysis`；
- `GET /usage/events`；
- `GET /status`。

创建 key，`plain_key` 只返回一次：

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

## WebSocket 验收

1. 安装新插件并重启 CPA。
2. 使用 `Authorization: Bearer cpa_…` 和真实模型名（如 `gpt-5.4`）创建新的 Codex session。
3. 至少连续完成两个 turn，覆盖 `previous_response_id` / `response.append`。
4. 确认 RPM/usage 按执行帧计数，而不是按 Upgrade 计数。
5. 确认新 session 的 CPA 日志不再出现 `1012 upstream requires HTTP replay`。
