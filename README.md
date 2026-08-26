# cpa-keyer

WebSocket-compatible downstream API-key policy plugin for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).

It issues plugin-owned `cpa_…` keys and enforces an exact model allow-list, RPM, daily/weekly USD budgets, and token/per-call accounting without overriding CPA model resolution.

| | |
|---|---|
| **Repository** | [JaxsonWang/cpa-plugin-keyer](https://github.com/JaxsonWang/cpa-plugin-keyer) |
| **License** | MIT |
| **中文说明** | [README.zh-CN.md](./README.zh-CN.md) |

## v0.7.7 focused filters and navigation icons

Request-event filters are limited to time range, Key ID, provider, and result.
Navigation icons now keep clear Phosphor fills in both light and dark themes
instead of inheriting generic SVG stroke rules.

## v0.7.6 CPA route-switch crash fix

Theme and language synchronization no longer creates cross-iframe
`MutationObserver` instances from the CPA parent realm. This prevents the host
document from retaining callbacks and rendering resources from plugin iframes
after route switches remove them. Initial values still come from the CPA DOM,
later changes use same-origin `storage` events, and ECharts now relies on its
normal React unmount cleanup instead of forced disposal during `pagehide`.

## v0.7.5 SQLite migration fix

SQLite schema upgrades now use an immediate write transaction and re-check the
version and existing columns while holding the write lock. Repeated
`plugin.reconfigure` calls and partially migrated databases no longer fail by
trying to add an already existing column.

## v0.7.4 navigation and iframe lifecycle

Key creation is now a persistent item in the embedded top navigation, and the
standalone desktop shell uses the same horizontal navigation instead of a
sidebar. When CPA removes the plugin iframe, Keyer explicitly disconnects host
observers and disposes every ECharts renderer before the iframe realm is
destroyed. Runtime dimensions absent from older request events are displayed as
`Not recorded` instead of the internal `unknown` sentinel.

## v0.7.3 usage analytics, CPA-integrated UI, and SQLite state

The embedded UI now follows CPA's light, white, and dark management themes and
uses a compact local section rail for Overview, Request events, Key management,
and Key creation. Native browser alerts and the redundant plugin logout action
are removed. The Key list also supports resetting one or multiple keys' daily
and weekly limits to zero.

Overview combines request/token trends with model, Key ID, and provider
breakdowns, latency and TTFT percentiles, cache efficiency, cost composition,
executor/auth/source/service-tier distributions, and a Key-by-model heatmap.
Request events keep the Key ID and a masked source such as `cpa_*****wxyz`,
never the plaintext credential, together with the timestamp, provider,
requested/upstream model, reasoning effort, executor and authentication type,
request source, service tier, HTTP failure status, latency, TTFT, token detail,
billing mode, and estimated cost available from CPA's `usage.handle` payload.
History is retained for 90 days without a fixed event-count cap.

`state_file` is now one SQLite database containing Key configuration, model
rules, daily/weekly aggregate state, and request events. JSON state files are
no longer used by the runtime persistence path or rewritten by the 15-second usage flusher.
An existing JSON state must be backed up and explicitly imported into the new
`.db` file before the plugin configuration is switched; keep the JSON source
until Key, aggregate, and event counts have been verified.

Use the offline migration command while CPA is stopped or no longer writing
the source JSON:

```bash
go run ./cmd/cpa-keyer-state-migrate \
  -source /CLIProxyAPI/data/cpa-key-policy-state.json \
  -destination /CLIProxyAPI/data/cpa-key-policy-state.db
```

The command imports keys, normalized model rules, daily/weekly aggregate state,
and retained request events in one transaction. It verifies the complete state
and event payloads, runs a SQLite checkpoint, leaves the JSON unchanged, and
refuses to overwrite an existing destination.

## v0.6.0 rename and management UI

The plugin ID is now `cpa-keyer`, and the repository is
[`JaxsonWang/cpa-plugin-keyer`](https://github.com/JaxsonWang/cpa-plugin-keyer).
Library/archive names, Management API paths, and resource paths use the new ID.
CPA displays the plugin and its resource menu as `Keyer`. The redesigned UI bundles all styles and SVG assets locally, syncs selected
model prices in one action from `https://models.dev/api.json`, and preserves the
complete create/edit form draft while the standalone model picker is open.

The rename does not change existing `cpa_…` keys. Before removing the old
plugin, record and back up the exact JSON path in
`plugins.configs.cpa-key-policy.state_file`. Import it into a new SQLite file,
then set `plugins.configs.cpa-keyer.state_file` to that `.db` path. Fresh
installs use the `cpa-keyer-state.db` default.

## v0.5.3 legacy-key compatibility

Existing plugin-issued keys remain valid after the JSON state is imported into
SQLite; upgrading does not require creating or rotating a key. Frontend authentication now validates key
identity separately from execution policy. An enabled key that exceeds RPM or a
daily/weekly budget is authenticated first, then receives a structured `429`
with `rpm_exceeded`, `daily_exceeded`, or `weekly_exceeded` instead of CPA
collapsing the policy rejection into `401 Invalid API key`. A disallowed model
similarly receives `403 model_not_allowed`.

Unknown keys, disabled keys, native CPA keys, existing usage data, per-call
media pre-charging, and the `allow_models_endpoint` behavior are unchanged.

## v0.5.x behavior

The policy invariant is:

> The plugin never routes or rewrites a model. Clients send a real model name that CPA can resolve natively, and the plugin only decides whether that exact name is allowed.

This keeps the native Responses WebSocket path available. The plugin registers only:

- frontend authentication;
- request interception;
- usage accounting;
- management API and embedded UI.

It does **not** register `model.route`, a scheduler, or a response interceptor.

### Preserved

- plugin-owned `cpa_…` key authentication;
- exact, case-insensitive model allow-lists;
- per-key RPM;
- daily and rolling-weekly USD limits;
- token pricing and fixed per-call pricing;
- per-key/per-model usage and cost totals;
- key create, edit, rotate, revoke, RPM reset, global daily/weekly usage reset, and usage UI;
- binary `allow_models_endpoint` policy for `GET /v1/models`.

### Removed

- aliases and model-name rewriting;
- provider pinning;
- multi-target priority/round-robin routing;
- credential group/tier scheduling;
- custom credential classification;
- plugin-side catalog aggregation.

Provider names shown in the model picker are discovery-only labels from CPA. They are never persisted into key policy and do not influence routing.

## Why this fixes Responses WebSocket fallback

The previous router hook returned a handled model override. CPA then disabled native WebSocket passthrough for that request. Incremental Responses frames such as `previous_response_id` / `response.append` could require HTTP replay, producing:

```text
1012 upstream requires HTTP replay
```

v0.5.0 leaves model resolution to CPA:

1. Frontend auth validates that the `cpa_…` key exists and is enabled. Authentication itself does not consume RPM or evaluate execution budgets.
2. Before every HTTP or WebSocket model execution, `request.intercept_before` checks the resolved requested model, RPM, and budget using the original authorization header.
3. Fixed per-call media requests remain pre-charged once during request interception.
4. Unknown/native CPA keys are left to other CPA auth providers.

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
