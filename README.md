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
`cpa-keyer`. If the official `origin652` build is already installed,
record and back up `plugins.configs.cpa-key-policy.state_file` before
uninstalling that plugin entry, because uninstalling removes the saved plugin
config. Import the old JSON state into the new SQLite database before pointing
`cpa-keyer` at the `.db` path, then verify the existing keys and usage data.

Canonical key policy shape:

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

Use the Web UI or Management API to generate keys when possible. The plaintext key is returned once. Do not also add plugin-issued keys to CPA's native `api-keys`, because that creates a separate native authentication path.

Once the SQLite state file exists, its keys and usage are loaded as the runtime source of truth. The YAML keys in [`config.example.yaml`](./config.example.yaml) seed only a new empty database.

## Legacy v0.4.x model rules

When a legacy JSON state is explicitly imported into SQLite, its model rules
are normalized as follows; pointing `state_file` at the JSON file does not run
this migration automatically:

- a legacy direct rule with `target_model` becomes `{model: target_model}`;
- a legacy global alias contributes each target's real model as a direct rule;
- multiple targets become multiple allowed real models;
- duplicate real models are collapsed;
- alias/provider/group routing metadata is removed;
- pricing is preserved;
- historical `usage.by_alias` rows remain as residual history because an old alias cannot be truthfully assigned to one target model.

After importing:

- clients must send real CPA model names; old alias request names no longer resolve;
- keep the original JSON backup until key, usage, and event totals have been verified;
- start a new Codex session or restart the client, because an existing session may have cached the SSE fallback decision.

## Web Management UI

After the plugin loads:

```text
http://HOST:PORT/v0/resource/plugins/cpa-keyer/index.html
```

Log in with the CPA management secret. The UI provides key management, direct model selection, models.dev price synchronization, budget/RPM policy, per-model usage, overview charts, analysis, and request events. The management secret remains in memory rather than `localStorage`.

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

## WebSocket acceptance

1. Install the rebuilt plugin and restart CPA.
2. Start a fresh Codex session with `Authorization: Bearer cpa_…` and a real model name such as `gpt-5.4`.
3. Complete at least two turns so the client exercises incremental Responses state (`previous_response_id` / `response.append`).
4. Confirm RPM/usage increments per execution rather than per Upgrade.
5. Confirm CPA logs do not contain `1012 upstream requires HTTP replay` for the new session.
