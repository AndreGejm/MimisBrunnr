# Running the system

This repository currently has five first-party Node entrypoints plus Docker
wrappers around the HTTP API and the thin direct MCP adapter.

## Shared runtime

All five Node entrypoints build the same service container from
`packages/infrastructure/src/bootstrap/build-service-container.ts`.

That container wires:

- note repositories on disk
- SQLite metadata, audit, token, import, archive, trace, and tool-output
  stores
- SQLite FTS
- Qdrant vector retrieval
- provider adapters
- auth policy
- coding bridge
- toolbox control surface
- the runtime command dispatcher

## Node entrypoints

### HTTP API

```bash
corepack pnpm api
```

Entrypoints:

- `apps/mimir-api/src/main.ts`
- `apps/mimir-api/src/server.ts`

The API binds to `MAB_API_HOST:MAB_API_PORT`.

### CLI

```bash
corepack pnpm cli -- version
corepack pnpm cli -- list-toolboxes --json "{}"
```

Entrypoint:

- `apps/mimir-cli/src/main.ts`

The CLI is JSON-in and JSON-out for commands that take a payload.

### Direct MCP adapter

```bash
corepack pnpm mcp
```

Entrypoints:

- `apps/mimir-mcp/src/main.ts`
- `apps/mimir-mcp/src/tool-definitions.ts`

Current transport behavior:

- stdio
- newline-delimited JSON messages
- `tools.listChanged = false`

It exposes the stable Mimir command catalog directly. It does not expose the
toolbox control tools.

### Toolbox control MCP adapter

```bash
corepack pnpm mcp:control
```

Entrypoints:

- `apps/mimir-control-mcp/src/main.ts`
- `apps/mimir-control-mcp/src/tool-definitions.ts`

Current transport behavior:

- stdio
- `Content-Length` framed JSON-RPC
- `tools.listChanged = false`

Default runtime assumptions when env overrides are absent:

- manifest directory: `docker/mcp`
- active profile: `bootstrap`
- client id: `codex`

### Toolbox broker MCP adapter

```bash
corepack pnpm --filter @mimir/toolbox-mcp serve
```

Entrypoints:

- `apps/mimir-toolbox-mcp/src/main.ts`
- `apps/mimir-toolbox-mcp/src/session-state.ts`
- `apps/mimir-toolbox-mcp/src/adapters/*`

Current transport behavior:

- stdio
- `Content-Length` framed JSON-RPC
- `tools.listChanged = true`
- `notifications/tools/list_changed`

The broker starts in `bootstrap` and changes the visible tool surface inside one
session.

## Docker entrypoints

### Local API stack

```bash
corepack pnpm docker:up
```

Tracked assets:

- `docker/compose.local.yml`
- `docker/mimir-api.Dockerfile`

### Direct MCP session container

```bash
corepack pnpm docker:mcp:build
docker compose -f docker/compose.mcp-session.yml up --build
```

Tracked assets:

- `docker/mimir-mcp.Dockerfile`
- `docker/compose.mcp-session.yml`
- `docker/mimir-mcp-session-entrypoint.mjs`
- `docker/mimir-mcp-session.env.example`

This wrapper still launches the thin direct MCP adapter. It is not the toolbox
broker.

## Health endpoints

The HTTP API exposes:

- `GET /health/live`
- `GET /health/ready`

Health logic lives in
`packages/infrastructure/src/health/runtime-health.ts`.

Current behavior:

- `live` returns `200` for pass or degraded, `503` for fail
- `ready` returns `200` only for pass, `503` for degraded or fail
- Qdrant failure is degraded for `live` and fatal for `ready`

## Current HTTP, CLI, and toolbox roles

Use the adapters this way:

- HTTP: operational or process-local integration
- CLI: operator workflows, audits, and scripted local use
- direct MCP: broad stable command-catalog access
- control MCP: toolbox discovery, approval, lease, reconnect
- broker MCP: constrained client session that can expand or contract in place

## Current storage surfaces

Primary runtime state lives in:

- `MAB_VAULT_ROOT` for canonical notes
- `MAB_STAGING_ROOT` for staging drafts
- `MAB_SQLITE_PATH` for SQLite-backed state
- `MAB_QDRANT_COLLECTION` for vector records

The Docker MCP session wrapper also validates required mounts and dependencies
before starting the direct MCP process.
