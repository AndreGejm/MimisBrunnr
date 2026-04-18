# mimir

mimir is a local-first TypeScript app and orchestrator for governed AI context, bounded retrieval, auth-gated transport adapters, and a vendored Python coding runtime.

mimisbrunnr is the AI context well inside mimir: the durable knowledge store and memory well where information is staged, validated, promoted, persisted, searched, and assembled into context packets. See `documentation/reference/terminology.md` for the canonical naming contract.

For a first-time user and operator manual covering setup, Docker Desktop, the orchestrator, Hermes-derived local-agent ideas, storing information, validation, review, retrieval, MCP, and troubleshooting, see `documentation/manuals/mimir-complete-manual.md`.

Repository identity:

- GitHub repository: `https://github.com/AndreGejm/MimisBrunnr`
- product/app/orchestrator: `mimir`
- stored context and durable memory layer: `mimisbrunnr`
- npm workspace scope: `@mimir/*`

Release metadata:

- `documentation/release/CHANGELOG.md`
- `documentation/release/RELEASE_NOTES.md`
- `documentation/release/v1.0.1-release-checklist.md`
- `documentation/release/contributor-beta-readiness.md`

## Current state

The tracked repository currently implements:

- a layered workspace with `packages/domain`, `packages/contracts`, `packages/application`, `packages/orchestration`, and `packages/infrastructure`
- three transport adapters over the same shared mimir runtime: HTTP (`apps/mimir-api`), CLI (`apps/mimir-cli`), and stdio MCP (`apps/mimir-mcp`)
- filesystem-backed canonical and staging note stores
- SQLite-backed metadata, audit, issued-token, revocation, session-archive, import-job, namespace, representation, local-agent trace, and tool-output spillover stores
- SQLite FTS lexical retrieval plus a Qdrant-backed vector adapter
- governed drafting, validation, promotion, refresh-draft creation, import-job recording, history queries, and session-archive creation
- a thin staging-review workflow exposing queue listing, note reading, acceptance, and rejection through CLI, HTTP, and MCP
- bounded retrieval, fenced agent-context assembly, non-authoritative session recall, direct context-packet assembly, decision-summary generation, namespace tree listing, and namespace node reads
- actor-registry authorization with static credentials, centrally issued tokens, revocation support, and operator auth-control surfaces
- a read-only Docker AI tool registry with manifest discovery, validation, and package-plan surfaces
- an external-source adapter registry with a read-only Obsidian vault adapter gated by allowed and denied globs
- a vendored Python runtime in `runtimes/local_experts` that handles coding tasks through a Node-to-Python bridge

The tracked repository does not currently include:

- GitHub Actions or other tracked CI/CD definitions
- Kubernetes, Helm, Terraform, or deployment descriptors beyond the tracked local Docker profiles
- a tracked migration system for SQLite
- a tracked dotenv loader for Node processes

## Architecture snapshot

```text
HTTP / CLI / MCP
        |
        v
buildServiceContainer()
        |
        +--> ActorAuthorizationPolicy
        +--> MimirOrchestrator
        |       +--> MimisbrunnrDomainController
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

See `documentation/architecture/overview.md` for the package-level map and `documentation/architecture/runtime-flow.md` for request and promotion flow details.

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
corepack pnpm install
corepack pnpm build
```

The root package scripts are the supported install and build entrypoints. `scripts/` contains narrow operator helpers for launcher installation, Codex MCP setup, diagnostics, toolbox audit/sync, review, cleanup, and wrapper entrypoints; it does not contain a one-shot bootstrap script. An experimental Windows installer backend now lives under `scripts/installers/windows/`, but it is currently an environment/audit/repo-prepare/toolbox-audit/toolbox-prepare/docker-mcp-audit/docker-mcp-apply-plan/plan/apply/state contract rather than the full guided bootstrap flow.

If `corepack enable` cannot install a global `pnpm` shim on your machine, run the
workspace commands as `corepack pnpm ...` directly.

## Configuration model

Configuration is read from `process.env` by `packages/infrastructure/src/config/env.ts`.

The current technical compatibility prefix is still `MAB_`. Treat `MAB_` as a
legacy-compatible environment prefix until a dedicated environment migration
adds and verifies broader `MIMIR_*` aliases. New user-facing prose should say
mimir for the app/orchestrator and mimisbrunnr for the stored context layer.

Important:

- `.env.example` is reference material only
- the Node entrypoints do not auto-load `.env`
- if `MAB_DATA_ROOT` is unset on Windows, host state defaults under `%USERPROFILE%\.mimir`
- if `MAB_DATA_ROOT` is unset on non-Windows platforms, host state defaults under `$HOME/.mimir`
- `MAB_VAULT_ROOT`, `MAB_STAGING_ROOT`, and `MAB_SQLITE_PATH` can still override the derived paths individually

If you want repo-local development state, set `MAB_VAULT_ROOT`,
`MAB_STAGING_ROOT`, and `MAB_SQLITE_PATH` explicitly.

See `documentation/reference/env-vars.md` for the full environment variable list.

## Run locally

### Minimal repo-local profile

This profile keeps state inside the repository and matches the provider mix used by the end-to-end tests:

```dotenv
MAB_NODE_ENV=development
MAB_VAULT_ROOT=./vault/canonical
MAB_STAGING_ROOT=./vault/staging
MAB_SQLITE_PATH=./state/mimisbrunnr.sqlite
MAB_QDRANT_URL=http://127.0.0.1:6333
MAB_QDRANT_COLLECTION=mimisbrunnr_chunks
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
corepack pnpm api
corepack pnpm cli -- version
corepack pnpm mcp
```

Entrypoints:

- HTTP API: `corepack pnpm api`
- CLI: `corepack pnpm cli -- <command>`
- MCP server: `corepack pnpm mcp`

## Run with Docker

The repository now tracks two Docker runtime shapes:

- `docker/compose.local.yml` for the local HTTP runtime
- `docker/mimir-mcp.Dockerfile` plus `docker/mimir-mcp-session-entrypoint.mjs`
  for an on-demand stdio MCP session container

### What the compose profile starts

- `mimir-api`
- `qdrant`

### What it configures

- canonical notes under `/data/vault/canonical`
- staging drafts under `/data/vault/staging`
- SQLite state under `/data/state/mimisbrunnr.sqlite`
- Qdrant at `http://qdrant:6333`
- model-backed providers against `http://model-runner.docker.internal:12434`
- embedding, reasoning, drafting, and reranking bound to the Docker/Ollama-compatible stack

Expected model names in that Docker/Ollama-compatible endpoint:

- `docker.io/ai/qwen3-embedding:0.6B-F16`
- `qwen3:4B-F16`
- `qwen3-coder`
- `qwen3-reranker`

### Start the tracked HTTP Docker profile

```bash
docker compose -f docker/compose.local.yml up --build
```

Or use the workspace scripts:

```bash
corepack pnpm docker:up
corepack pnpm docker:down
```

Important profile note:

- the compose profile is intentionally more model-backed than the generic local defaults
- generic defaults use `hash` embeddings and `heuristic` reasoning unless you override them
- the compose profile forces the main provider selectors to the Docker/Ollama-compatible stack

### Start a session-scoped Docker MCP container

Tracked Docker MCP assets:

- `docker/mimir-mcp.Dockerfile`
- `docker/mimir-mcp-session.env.example`
- `docker/mimir-mcp-session.actor-registry.example.json`
- `docker/compose.mcp-session.yml`
- `documentation/operations/docker-mcp-session.md`

Build the image:

```bash
corepack pnpm docker:mcp:build
```

Validate the profile before connecting a client:

```bash
docker run --rm \
  --env-file docker/mimir-mcp-session.env \
  --mount type=bind,src=<HOST_CANONICAL_ROOT>,dst=/data/vault/canonical \
  --mount type=bind,src=<HOST_STAGING_ROOT>,dst=/data/vault/staging \
  --mount type=bind,src=<HOST_STATE_ROOT>,dst=/data/state \
  --mount type=bind,src=<HOST_AUTH_CONFIG_ROOT>,dst=/config/auth,readonly \
  --add-host host.docker.internal:host-gateway \
  --add-host model-runner.docker.internal:host-gateway \
  mimir-mcp-session:local \
  --validate-only
```

Launch the MCP session:

```bash
docker run --rm -i \
  --env-file docker/mimir-mcp-session.env \
  --mount type=bind,src=<HOST_CANONICAL_ROOT>,dst=/data/vault/canonical \
  --mount type=bind,src=<HOST_STAGING_ROOT>,dst=/data/vault/staging \
  --mount type=bind,src=<HOST_STATE_ROOT>,dst=/data/state \
  --mount type=bind,src=<HOST_AUTH_CONFIG_ROOT>,dst=/config/auth,readonly \
  --add-host host.docker.internal:host-gateway \
  --add-host model-runner.docker.internal:host-gateway \
  mimir-mcp-session:local
```

This mode is intentionally session-scoped. It keeps canonical, staging, state,
and auth data on the host and refuses to start if required mounts, models,
Qdrant, or the fixed session actor contract are missing.

## MCP setup

The tracked MCP adapter is a stdio server exposed by `apps/mimir-mcp`.

### Local stdio MCP server

```bash
corepack pnpm mcp
```

Behavior:

- JSON-RPC over stdio with Content-Length framing
- shared transport validation
- optional fixed session actor defaults through `MAB_MCP_DEFAULT_*`
- delegation into the same shared runtime used by the HTTP and CLI adapters

### Generic MCP client command configuration

If your MCP client accepts a local command, point it at the built server:

```json
{
  "command": "pnpm",
  "args": ["mcp"],
  "cwd": "<REPO_ROOT>"
}
```

If your machine does not have a working global `pnpm` shim, use:

```json
{
  "command": "corepack",
  "args": ["pnpm", "mcp"],
  "cwd": "<REPO_ROOT>"
}
```

If your client prefers an explicit Node entrypoint after build, use:

```json
{
  "command": "node",
  "args": ["apps/mimir-mcp/dist/main.js"],
  "cwd": "<REPO_ROOT>"
}
```

### Docker plus MCP

The tracked Docker MCP profile is intended for on-demand session launch, not an
always-on background container.

Recommended setup:

1. build `docker/mimir-mcp.Dockerfile`
2. copy `docker/mimir-mcp-session.env.example` to `docker/mimir-mcp-session.env`
3. mount canonical, staging, state, and config explicitly
4. run `docker run --rm -i ... mimir-mcp-session:local`

See `documentation/operations/docker-mcp-session.md` for the exact command shape,
validation step, and MCP client snippet.

## HTTP and CLI surfaces

### HTTP

- health: `GET /health/live`, `GET /health/ready`
- system: auth status, issued-token listing, token issuance, token introspection, token revocation, freshness, version
- context: search, tree, node, packet, decision summary
- governance: drafts, refresh drafts, validate, promote, import resource, history query, session archives
- coding: `POST /v1/coding/execute`, `POST /v1/coding/traces`, `POST /v1/coding/tool-output`
- tools: `POST /v1/tools/ai`, `POST /v1/tools/ai/check`, `POST /v1/tools/ai/package-plan`

### CLI

- `version`
- `auth-status`
- `auth-issued-tokens`
- `auth-introspect-token`
- `freshness-status`
- `issue-auth-token`
- `revoke-auth-token`
- `execute-coding-task`
- `list-agent-traces`
- `show-tool-output`
- `list-ai-tools`
- `check-ai-tools`
- `tools-package-plan`
- `search-context`
- `search-session-archives`
- `assemble-agent-context`
- `list-context-tree`
- `read-context-node`
- `get-context-packet`
- `fetch-decision-summary`
- `draft-note`
- `create-refresh-draft`
- `create-refresh-drafts`
- `validate-note`
- `promote-note`
- `list-review-queue`
- `read-review-note`
- `accept-note`
- `reject-note`
- `import-resource`
- `query-history`
- `create-session-archive`

The same thin review workflow is also reachable over HTTP on `/v1/review/*`
and over MCP through `list_review_queue`, `read_review_note`, `accept_note`,
and `reject_note`.

In enforced auth mode, the CLI auth-control commands also require operator or
system actor context in their JSON payloads. The payload-free path is only
reliable for `version`, and for auth-control commands when auth is not enforced.

See `documentation/reference/interfaces.md` for the canonical interface list.

## Health behavior

The HTTP adapter exposes:

- `GET /health/live`
- `GET /health/ready`

Important operational behavior:

- missing Qdrant is a warning in `live`
- missing Qdrant is a failure in `ready`

See `documentation/operations/running.md` for the current health model and runtime behavior.

## Verify your setup

```bash
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test:transport
corepack pnpm test
py -3 -m pytest runtimes/local_experts/tests/test_safety_gate.py -v   # Windows
python3 -m pytest runtimes/local_experts/tests/test_safety_gate.py -v # macOS/Linux
```

`corepack pnpm test` currently expands to `pnpm test:e2e`, which first runs
`pnpm build` and then executes the tracked end-to-end suite.

## Repository structure

```text
apps/          transport entrypoints
packages/      layered TypeScript modules
docker/        Dockerfile and local compose profile
documentation/          canonical docs plus planning/history docs
runtimes/      vendored Python coding runtime
tests/         end-to-end transport and service tests
scripts/       launcher, installer backend, doctor, review, and cleanup helpers
```

Full map: `documentation/reference/repo-map.md`

## Source-of-truth docs

- `documentation/setup/installation.md`
- `documentation/setup/configuration.md`
- `documentation/operations/running.md`
- `documentation/operations/docker-mcp-session.md`
- `documentation/architecture/overview.md`
- `documentation/architecture/runtime-flow.md`
- `documentation/architecture/invariants-and-boundaries.md`
- `documentation/reference/interfaces.md`
- `documentation/reference/env-vars.md`
- `documentation/reference/repo-map.md`
- `documentation/agents/ai-navigation-guide.md`
- `documentation/release/contributor-beta-readiness.md`

`documentation/planning/` is useful for history and rollout context, but it is not the primary source of truth for the current runtime.

## Known limitations and active documentation risks

- namespace browsing is currently backed by rows in the `notes` table; imported jobs and session archives are stored, but they are not exposed through the namespace tree
- the Docker MCP session profile still assumes Qdrant and the model endpoint are managed intentionally outside the session container
- there is no tracked CI pipeline validating docs, builds, or tests automatically

## AI-agent navigation

Start here if you are using an automated reviewer or coding agent:

- `documentation/agents/ai-navigation-guide.md`
- `documentation/reference/repo-map.md`
- `documentation/architecture/invariants-and-boundaries.md`

## Evidence status

### Verified facts

- This README is based on tracked code in `apps/`, `packages/`, `docker/`, `runtimes/`, `tests/`, and `documentation/`
- Runtime defaults come from `packages/infrastructure/src/config/env.ts`
- Transport surfaces come from `apps/mimir-api/src/server.ts`, `apps/mimir-cli/src/main.ts`, and `apps/mimir-mcp/src/main.ts`
- Docker behavior comes from `docker/mimir-api.Dockerfile`, `docker/compose.local.yml`, `docker/mimir-mcp.Dockerfile`, `docker/compose.mcp-session.yml`, and `docker/mimir-mcp-session-entrypoint.mjs`
- Test commands come from the root `package.json`

### Assumptions

- The generic MCP client command example will need minor format changes depending on the client you use

### TODO gaps

- If the repo adds dotenv loading, CI, deployment descriptors, migration tooling, or another Docker/MCP runtime shape, update this README and the setup/reference docs together
