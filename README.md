# Multi Agent Brain

Local-first TypeScript monorepo for governed note memory, bounded retrieval, auth-gated transport adapters, and a vendored Python coding runtime.

## Current state

The tracked repository currently implements:

- a layered workspace with `packages/domain`, `packages/contracts`, `packages/application`, `packages/orchestration`, and `packages/infrastructure`
- three transport adapters over the same shared runtime: HTTP (`apps/brain-api`), CLI (`apps/brain-cli`), and stdio MCP (`apps/brain-mcp`)
- filesystem-backed canonical and staging note stores
- SQLite-backed metadata, audit, issued-token, revocation, session-archive, import-job, namespace, and representation stores
- SQLite FTS lexical retrieval plus a Qdrant-backed vector adapter
- governed drafting, validation, promotion, refresh-draft creation, import-job recording, history queries, and session-archive creation
- bounded retrieval, direct context-packet assembly, decision-summary generation, namespace tree listing, and namespace node reads
- actor-registry authorization with static credentials, centrally issued tokens, revocation support, and operator auth-control surfaces
- a vendored Python runtime in `runtimes/local_experts` that handles coding tasks through a Node-to-Python bridge

The tracked repository does not currently include:

- GitHub Actions or other tracked CI/CD definitions
- Kubernetes, Helm, Terraform, or deployment descriptors beyond `docker/compose.local.yml`
- a tracked migration system for SQLite
- a tracked dotenv loader for Node processes
- a tracked Docker Compose profile for the MCP server itself

## Architecture snapshot

```text
HTTP / CLI / MCP
        |
        v
buildServiceContainer()
        |
        +--> ActorAuthorizationPolicy
        +--> MultiAgentOrchestrator
        |       +--> BrainDomainController
        |       \--> CodingDomainController
        |
        +--> Application services
        |       +--> retrieval / packet / summary
        |       +--> staging / validation / promotion / refresh
        |       +--> import / history / session archive / namespace
        |
        \--> Infrastructure adapters
                +--> filesystem vault repositories
                +--> SQLite stores + FTS
                +--> Qdrant vector index
                +--> local / paid model providers
                \--> Python coding bridge
```

See `docs/architecture/overview.md` for the package-level map and `docs/architecture/runtime-flow.md` for request and promotion flow details.

## Prerequisites

### Required

- Node `>=22.0.0`
- `pnpm@10.7.0`

### Optional, depending on what you want to run

- Python 3 for the vendored coding runtime
- Qdrant if you want vector retrieval to be reachable
- Docker Desktop and Docker Compose if you want the tracked container profile
- Docker Model Runner or another Ollama-compatible endpoint if you want model-backed retrieval, drafting, reranking, or coding flows

### Suggested Python packages for `runtimes/local_experts`

- `fastmcp`
- `httpx`
- `pytest`

The repository does not include a tracked Python lockfile or packaging manifest for the vendored runtime.

Example install:

```bash
python -m pip install fastmcp httpx pytest
```

## Install dependencies

```bash
corepack enable
pnpm install
pnpm build
```

The root package scripts are the supported install and build entrypoints. There is no tracked bootstrap script in `scripts/`.

## Configuration model

Configuration is read from `process.env` by `packages/infrastructure/src/config/env.ts`.

Important:

- `.env.example` is reference material only
- the Node entrypoints do not auto-load `.env`
- if `MAB_VAULT_ROOT` is unset on Windows, the runtime defaults to `F:\Dev\AI Context Brain`
- if `MAB_VAULT_ROOT` is unset on non-Windows platforms, the runtime defaults to `./vault/canonical`

If you want repo-local development state on Windows, set `MAB_VAULT_ROOT` explicitly instead of relying on the Windows default.

See `docs/reference/env-vars.md` for the full environment variable list.

## Run locally

### Minimal repo-local profile

This profile keeps state inside the repository and matches the provider mix used by the end-to-end tests:

```dotenv
MAB_NODE_ENV=development
MAB_VAULT_ROOT=./vault/canonical
MAB_STAGING_ROOT=./vault/staging
MAB_SQLITE_PATH=./state/multi-agent-brain.sqlite
MAB_QDRANT_URL=http://127.0.0.1:6333
MAB_QDRANT_COLLECTION=context_brain_chunks
MAB_EMBEDDING_PROVIDER=hash
MAB_REASONING_PROVIDER=heuristic
MAB_DRAFTING_PROVIDER=disabled
MAB_RERANKER_PROVIDER=local
MAB_API_HOST=127.0.0.1
MAB_API_PORT=8080
MAB_LOG_LEVEL=info
```

Why this works:

- draft creation has a deterministic fallback path when no drafting provider is configured
- missing Qdrant degrades vector retrieval instead of crashing the runtime
- the test suite repeatedly uses the `hash` / `heuristic` / `disabled` / `local` provider mix

### Start an entrypoint

```bash
pnpm api
pnpm cli -- version
pnpm mcp
```

Entrypoints:

- HTTP API: `pnpm api`
- CLI: `pnpm cli -- <command>`
- MCP server: `pnpm mcp`

## Run with Docker

The tracked container profile is the local HTTP runtime in `docker/compose.local.yml`.

### What the compose profile starts

- `brain-api`
- `qdrant`

### What it configures

- canonical notes under `/data/vault/canonical`
- staging drafts under `/data/vault/staging`
- SQLite state under `/data/state/multi-agent-brain.sqlite`
- Qdrant at `http://qdrant:6333`
- model-backed providers against `http://model-runner.docker.internal:12434`
- embedding, reasoning, drafting, and reranking bound to the Docker/Ollama-compatible stack

Expected model names in that Docker/Ollama-compatible endpoint:

- `docker.io/ai/qwen3-embedding:0.6B-F16`
- `qwen3:4B-F16`
- `qwen3-coder`
- `qwen3-reranker`

### Start the tracked Docker profile

```bash
docker compose -f docker/compose.local.yml up --build
```

Or use the workspace scripts:

```bash
pnpm docker:up
pnpm docker:down
```

Important profile note:

- the compose profile is intentionally more model-backed than the generic local defaults
- generic defaults use `hash` embeddings and `heuristic` reasoning unless you override them
- the compose profile forces the main provider selectors to the Docker/Ollama-compatible stack

## MCP setup

The tracked MCP adapter is a stdio server exposed by `apps/brain-mcp`.

### Local stdio MCP server

```bash
pnpm mcp
```

Behavior:

- JSON-RPC over stdio with Content-Length framing
- shared transport validation
- MCP-scoped actor defaults
- delegation into the same shared runtime used by the HTTP and CLI adapters

### Generic MCP client command configuration

If your MCP client accepts a local command, point it at the built server:

```json
{
  "command": "pnpm",
  "args": ["mcp"],
  "cwd": "/absolute/path/to/multi-agent-brain"
}
```

If your client prefers an explicit Node entrypoint after build, use:

```json
{
  "command": "node",
  "args": ["apps/brain-mcp/dist/main.js"],
  "cwd": "/absolute/path/to/multi-agent-brain"
}
```

### Docker plus MCP

There is no tracked Docker Compose service for the MCP server today.

Recommended setup:

1. use `docker/compose.local.yml` for the HTTP API plus Qdrant
2. run `pnpm mcp` locally from the repo for stdio MCP access
3. give the MCP process the same environment profile you want it to use

If you want a containerized MCP server, you can reuse `docker/brain-api.Dockerfile` and override the command, but that is not a tracked runtime profile in this repository yet.

## HTTP and CLI surfaces

### HTTP

- health: `GET /health/live`, `GET /health/ready`
- system: auth status, issued-token listing, token issuance, token introspection, token revocation, freshness, version
- context: search, tree, node, packet, decision summary
- governance: drafts, refresh drafts, validate, promote, import resource, history query, session archives
- coding: `POST /v1/coding/execute`

### CLI

- `version`
- `auth-status`
- `auth-issued-tokens`
- `auth-introspect-token`
- `freshness-status`
- `issue-auth-token`
- `revoke-auth-token`
- `execute-coding-task`
- `search-context`
- `list-context-tree`
- `read-context-node`
- `get-context-packet`
- `fetch-decision-summary`
- `draft-note`
- `create-refresh-draft`
- `create-refresh-drafts`
- `validate-note`
- `promote-note`
- `import-resource`
- `query-history`
- `create-session-archive`

See `docs/reference/interfaces.md` for the canonical interface list.

## Health behavior

The HTTP adapter exposes:

- `GET /health/live`
- `GET /health/ready`

Important operational behavior:

- missing Qdrant is a warning in `live`
- missing Qdrant is a failure in `ready`

See `docs/operations/running.md` for the current health model and runtime behavior.

## Verify your setup

```bash
pnpm build
pnpm typecheck
pnpm test:transport
pnpm test
python -m pytest runtimes/local_experts/tests/test_safety_gate.py -v
```

`pnpm test` currently expands to `pnpm test:e2e`, which first runs `pnpm build` and then executes the tracked end-to-end suite.

## Repository structure

```text
apps/          transport entrypoints
packages/      layered TypeScript modules
docker/        Dockerfile and local compose profile
docs/          canonical docs plus planning/history docs
runtimes/      vendored Python coding runtime
tests/         end-to-end transport and service tests
scripts/       currently only a placeholder README
```

Full map: `docs/reference/repo-map.md`

## Source-of-truth docs

- `docs/setup/installation.md`
- `docs/setup/configuration.md`
- `docs/operations/running.md`
- `docs/architecture/overview.md`
- `docs/architecture/runtime-flow.md`
- `docs/architecture/invariants-and-boundaries.md`
- `docs/reference/interfaces.md`
- `docs/reference/env-vars.md`
- `docs/reference/repo-map.md`
- `docs/agents/ai-navigation-guide.md`

`docs/planning/` is useful for history and rollout context, but it is not the primary source of truth for the current runtime.

## Known limitations and active documentation risks

- `packages/contracts/src/mcp/index.ts` still exports `inspect-gap.tool.ts`, while the MCP runtime currently exposes `import_resource` and `create_session_archive`
- namespace browsing is currently backed by rows in the `notes` table; imported jobs and session archives are stored, but they are not exposed through the namespace tree
- there is no tracked Docker Compose profile for the MCP server
- there is no tracked CI pipeline validating docs, builds, or tests automatically

## AI-agent navigation

Start here if you are using an automated reviewer or coding agent:

- `docs/agents/ai-navigation-guide.md`
- `docs/reference/repo-map.md`
- `docs/architecture/invariants-and-boundaries.md`

## Evidence status

### Verified facts

- This README is based on tracked code in `apps/`, `packages/`, `docker/`, `runtimes/`, `tests/`, and `docs/`
- Runtime defaults come from `packages/infrastructure/src/config/env.ts`
- Transport surfaces come from `apps/brain-api/src/server.ts`, `apps/brain-cli/src/main.ts`, and `apps/brain-mcp/src/main.ts`
- Docker behavior comes from `docker/brain-api.Dockerfile` and `docker/compose.local.yml`
- Test commands come from the root `package.json`

### Assumptions

- The generic MCP client command example will need minor format changes depending on the client you use

### TODO gaps

- If the repo adds a tracked Docker MCP profile, dotenv loading, CI, deployment descriptors, or migration tooling, update this README and the setup/reference docs together
