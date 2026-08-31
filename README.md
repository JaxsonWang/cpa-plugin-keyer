# cpa-keyer

WebSocket-compatible downstream API-key policy plugin for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).

It issues plugin-owned `cpa_…` keys and enforces an exact model allow-list, RPM, daily/weekly USD budgets, and token/per-call accounting without overriding CPA model resolution.

| | |
|---|---|
| **Repository** | [JaxsonWang/cpa-plugin-keyer](https://github.com/JaxsonWang/cpa-plugin-keyer) |
| **License** | MIT |
| **中文说明** | [README.zh-CN.md](./README.zh-CN.md) |

## Configuration

CLIProxyAPI plugin configuration:

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

CPA plugin store source:

```text
https://raw.githubusercontent.com/JaxsonWang/cpa-plugin-keyer/main/registry.json
```

Add this URL to `plugins.store-sources`, then select the `JaxsonWang` entry for
`cpa-keyer`.

Key policies, usage, and request events are stored in the SQLite `state_file`.
Use the Web UI or Management API to create keys; the plaintext key is returned
once. Do not also add plugin-issued keys to CPA's native `api-keys`, because
that creates a separate native authentication path.

### Filtered model list

Keyer exposes `/v0/resource/plugins/cpa-keyer/viewer/models`. A known and
enabled Keyer key with `allow_models_endpoint` receives only the effective
models assigned directly or by its subscription plan. Disabled, expired, or
model-list-disabled Keyer keys receive `401`; a key unknown to Keyer returns
the internal dispatch status `418` so the reverse proxy can pass CPA-native
keys to CPA's original model list.

Use exact Nginx locations so generation and streaming routes remain unchanged.
`HOST:PORT` below must be CPA's internal listener, not the public Nginx endpoint:

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

Run `nginx -t` before reloading. Keyer keys use the filtered response; CPA
native keys keep CPA's original global model-list behavior.

## Web Management UI

After the plugin loads:

```text
http://HOST:PORT/v0/resource/plugins/cpa-keyer/index.html
```

Log in with the CPA management secret. The UI provides key management, direct model selection, models.dev price synchronization, budget/RPM policy, per-model usage, overview charts, analysis, and request events. The management secret remains in memory rather than `localStorage`.

### Per-key read-only view

Open the following URL to view one downstream Keyer key without entering the
CPA management secret or exposing the `management.html` entry:

```text
https://HOST:8317/v0/resource/plugins/cpa-keyer/index.html#/key/<KEY>
```

The key is authenticated as a bearer credential and can access only its own
Key details, overview, and request events. The viewer has no create, edit,
delete, rotate, enable/disable, quota-reset, RPM-reset, or cross-key access.
Navigation keeps the key-scoped routes under `/key/<KEY>`, including
`/overview` and `/events`.

The key stays in the URL fragment and in browser memory; it is not written to
`localStorage`. Treat the complete URL as a secret because anyone who receives
the downstream key can use it for the permissions assigned to that key.

Development:

```bash
cd web
npm ci
VITE_CPA_BASE=http://127.0.0.1:8317 npm run dev
```

## Management API

Exact plugin paths under `/v0/management/plugins/cpa-keyer`:

- `GET/POST/PATCH/DELETE /keys`;
- `POST /keys/rotate`;
- `POST /keys/reset-rpm`;
- `POST /keys/reset-usage` (clears daily and weekly usage for every key);
- `GET /keys/usage`;
- `GET /usage/overview`;
- `GET /usage/analysis`;
- `GET /usage/events`;
- `GET /status`.

Create a key; `plain_key` is returned once:

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

## Build and test

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

Build the embedded UI and Linux shared libraries:

```bash
make web-build
make build-linux-amd64
# or: make build-linux
```
