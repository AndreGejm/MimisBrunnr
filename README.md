# Multi Agent Brain

Local-first TypeScript monorepo for governed note memory, bounded retrieval, auth-gated transport adapters, and a vendored Python coding runtime.

## What this repository contains

- a layered workspace with `packages/domain`, `packages/contracts`, `packages/application`, `packages/orchestration`, and `packages/infrastructure`
- three transport adapters: HTTP (`apps/brain-api`), CLI (`apps/brain-cli`), and stdio MCP (`apps/brain-mcp`)
- filesystem-backed canonical and staging note stores
- SQLite-backed metadata, audit, issued-token, revocation, session-archive, import-job, namespace, and representation stores
- SQLite FTS lexical retrieval and a Qdrant-backed vector adapter
- a vendored Python runtime in `runtimes/local_experts` that handles coding tasks through a Node-to-Python bridge

## Current scope

The tracked code currently exposes:

- governed drafting, validation, promotion, refresh-draft creation, import-job recording, history queries, and session-archive creation
- bounded retrieval, direct context-packet assembly, decision-summary generation, namespace tree listing, and namespace node reads
- actor-registry authorization with static credentials, centrally issued tokens, revocation support, and administrative auth-control surfaces
- a model-role/provider abstraction that supports heuristic, hash, Docker/Ollama-compatible, and optional paid OpenAI-compatible providers

The tracked repository does **not** currently contain:

- GitHub Actions or other tracked CI/CD definitions
- Kubernetes, Helm, Terraform, or other deployment descriptors beyond `docker/compose.local.yml`
- a tracked migration system; SQLite schema creation happens inside adapter initialization code
- a tracked dotenv loader for Node processes; the code reads `process.env` directly

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

See `docs/architecture/overview.md` for the full package-level map and `docs/architecture/runtime-flow.md` for request and promotion flow details.

## Quickstart

### 1. Install workspace dependencies

The repo requires Node `>=22.0.0` and `pnpm@10.7.0` according to `package.json`.

```bash
corepack enable
pnpm install
pnpm build
```

### 2. Choose a runtime profile

#### Minimal local profile

This profile stays inside the repo and matches the provider mix used by the TypeScript test harnesses:

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

Important:

- `.env.example` is a reference file, but the Node applications do not load `.env` automatically
- set environment variables in your shell, process manager, or container runtime before starting the app
- without Qdrant, retrieval continues in degraded mode where possible, `GET /health/live` warns, and `GET /health/ready` fails

#### Model-backed Docker profile

`docker/compose.local.yml` starts `brain-api` plus Qdrant and sets all retrieval/drafting/reranking providers to the Docker/Ollama-compatible profile:

```bash
docker compose -f docker/compose.local.yml up --build
```

That compose profile is **not** identical to the repo defaults in `packages/infrastructure/src/config/env.ts`. It is an explicit container profile.

### 3. Run an entrypoint

```bash
pnpm api
pnpm cli -- version
pnpm mcp
```

## Configuration

- Environment reference: `docs/reference/env-vars.md`
- Setup and profile guidance: `docs/setup/configuration.md`
- Runbook and health behavior: `docs/operations/running.md`

Two configuration details matter immediately:

- if `MAB_VAULT_ROOT` is unset on Windows, `packages/infrastructure/src/config/env.ts` defaults it to `F:\Dev\AI Context Brain`
- if `MAB_VAULT_ROOT` is unset on non-Windows platforms, it defaults to `./vault/canonical`

If you want a repo-local development run on Windows, set `MAB_VAULT_ROOT` explicitly instead of relying on the Windows default.

## How to test

```bash
pnpm typecheck
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
- `docs/architecture/overview.md`
- `docs/architecture/runtime-flow.md`
- `docs/architecture/invariants-and-boundaries.md`
- `docs/reference/interfaces.md`
- `docs/reference/repo-map.md`
- `docs/agents/ai-navigation-guide.md`

`docs/planning/` contains planning and historical rollout material. It is useful for context, but it is not the primary source of truth for the current runtime.

## Known limitations and active documentation risks

- `packages/contracts/src/mcp/index.ts` still exports `inspect-gap.tool.ts`, while `apps/brain-mcp` currently exposes `import_resource` and `create_session_archive` instead
- namespace browsing is currently backed by rows in the `notes` table; imported jobs and session archives are stored, but they are not exposed through the namespace tree
- Python runtime dependencies are described in `runtimes/local_experts/README.md`, but the repo does not include a tracked Python lockfile or packaging manifest
- no tracked CI pipeline validates docs, builds, or tests automatically

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
- Test commands come from the root `package.json`

### Assumptions

- None

### TODO gaps

- If this repo later adds tracked CI, deployment descriptors, or migration tooling, update this README and `docs/reference/repo-map.md`
