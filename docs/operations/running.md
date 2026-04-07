# Running the system

This repository exposes three Node entrypoints and one Docker compose profile.

## Entrypoints

### HTTP API

```bash
pnpm api
```

Entrypoint files:

- `apps/brain-api/src/main.ts`
- `apps/brain-api/src/server.ts`

The API listens on `MAB_API_HOST:MAB_API_PORT` and prints the bound address on startup.

### CLI

```bash
pnpm cli -- version
pnpm cli -- auth-status
```

Entrypoint file:

- `apps/brain-cli/src/main.ts`

The CLI is JSON-in / JSON-out for command handlers that accept payloads.

### MCP server

```bash
pnpm mcp
```

Entrypoint files:

- `apps/brain-mcp/src/main.ts`
- `apps/brain-mcp/src/tool-definitions.ts`

This is a stdio MCP server that uses Content-Length framing.

### Docker compose profile

```bash
docker compose -f docker/compose.local.yml up --build
```

Tracked runtime assets:

- `docker/brain-api.Dockerfile`
- `docker/compose.local.yml`

## Runtime behavior

All three Node entrypoints build the same shared container through `packages/infrastructure/src/bootstrap/build-service-container.ts`.

That shared container wires:

- auth policy
- orchestrator
- application services
- filesystem repositories
- SQLite-backed stores
- SQLite FTS
- Qdrant vector adapter
- local / paid provider adapters
- Python coding bridge

## Health endpoints

The HTTP adapter exposes:

- `GET /health/live`
- `GET /health/ready`

Health behavior comes from `packages/infrastructure/src/health/runtime-health.ts`.

### `live`

Checks:

- canonical vault directory access
- staging vault directory access
- SQLite reachability
- temporal-validity summary state
- Qdrant reachability

`live` returns:

- `200` for pass or degraded
- `503` for fail

Missing Qdrant is a warning in `live` mode, not an immediate fatal result.

### `ready`

Uses the same checks, but Qdrant failure is a fatal readiness issue.

`ready` returns:

- `200` only for pass
- `503` for degraded or fail

## Auth-control surfaces

Operator/admin surfaces reachable through the HTTP adapter:

- `GET /v1/system/auth`
- `GET /v1/system/auth/issued-tokens`
- `POST /v1/system/auth/issue-token`
- `POST /v1/system/auth/introspect-token`
- `POST /v1/system/auth/revoke-token`
- `GET /v1/system/freshness`
- `GET /v1/system/version`

The CLI exposes the same categories through commands such as `auth-status`, `auth-issued-tokens`, `issue-auth-token`, `auth-introspect-token`, `revoke-auth-token`, and `freshness-status`.

## Storage locations

Primary runtime state is stored in:

- canonical notes under `MAB_VAULT_ROOT`
- staging drafts under `MAB_STAGING_ROOT`
- SQLite state under `MAB_SQLITE_PATH`
- Qdrant collection named by `MAB_QDRANT_COLLECTION`

The workspace you are reading may also contain local untracked `vault/` content. That is workspace state, not tracked repository content.

## Background work and schedulers

The tracked repository does not contain a standalone worker or scheduler process.

Notable consequence:

- promotion outbox replay exists as service logic in `packages/application/src/services/promotion-orchestrator-service.ts`
- there is no tracked daemon or scheduled job that replays pending promotions out of process

## Coding runtime

Coding tasks route through:

- `packages/orchestration/src/coding/coding-domain-controller.ts`
- `packages/infrastructure/src/coding/python-coding-controller-bridge.ts`
- `runtimes/local_experts/bridge.py`

This flow starts a Python subprocess and passes task payloads through JSON stdin/stdout.

## Evidence status

### Verified facts

- Entrypoints come from the tracked `apps/*/src/main.ts` files and root package scripts
- Health behavior comes from `packages/infrastructure/src/health/runtime-health.ts`
- Shared runtime wiring comes from `packages/infrastructure/src/bootstrap/build-service-container.ts`

### Assumptions

- None

### TODO gaps

- If a dedicated worker/scheduler is added, document it here and in `docs/reference/repo-map.md`
