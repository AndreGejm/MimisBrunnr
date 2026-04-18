# Installation

This repository is a Node.js monorepo with a vendored Python runtime. Installation is mostly dependency setup plus choosing a runtime profile.

## Prerequisites

### Required

- Node `>=22.0.0`
- `pnpm@10.7.0` (the root `package.json` declares this package manager version)

### Optional, depending on what you want to run

- Python 3 for the vendored coding runtime (`MAB_CODING_RUNTIME_PYTHON_EXECUTABLE` defaults to `py` on Windows and `python3` elsewhere)
- Qdrant if you want the vector index to be reachable
- Docker Model Runner / Ollama-compatible endpoints if you want model-backed drafting, reasoning, reranking, embeddings, or coding flows
- Docker if you want to use `docker/compose.local.yml`

The repo does not include a tracked Python lockfile or packaging manifest. The vendored runtime README lists `fastmcp`, `httpx`, and `pytest` as suggested dependencies.

## Install workspace dependencies

```bash
corepack enable
corepack pnpm install
corepack pnpm build
```

There is no one-shot bootstrap script; the root package scripts are the supported installation/build entrypoints. The tracked `scripts/` helpers install launcher aliases, configure Codex MCP access, run diagnostics, and provide review/cleanup wrappers.

An experimental Windows installer backend now exists under `scripts/installers/windows/`, but it is currently a headless preparatory surface for environment detection, clean-repo preparation, access auditing, dry-run write planning, tracked access apply, and persisted installer state. It is not yet the full guided bootstrap flow. See [`windows-installer.md`](./windows-installer.md).

If `corepack enable` cannot install a global `pnpm` shim, run every workspace
command as `corepack pnpm ...` directly.

## Experimental Windows installer backend

Current Windows-only backend commands:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation detect-environment `
  -Json

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation audit-install-surface `
  -Json

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation prepare-repo-workspace `
  -Json

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation audit-toolbox-assets `
  -Json

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation prepare-toolbox-runtime `
  -Json

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation audit-docker-mcp-toolkit `
  -Json

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation plan-docker-mcp-toolkit-apply `
  -Json

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation plan-client-access `
  -Json

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation apply-client-access `
  -Json

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation show-state `
  -Json
```

What this backend does today:

- reports machine/runtime prerequisites in a stable format
- prepares a clean local repo checkout through guarded `corepack pnpm install --frozen-lockfile` and `corepack pnpm build`
- normalizes `doctor-default-access.mjs` into a stable result envelope
- validates tracked `docker/mcp` toolbox assets through the real compiler and
  Docker runtime-plan path
- writes a compiled toolbox runtime artifact for later Docker apply work
- inspects the live Docker MCP Toolkit state through `docker mcp`
- prepares a reviewed Docker Toolkit apply plan and blocks honestly when the
  installed Toolkit surface is incompatible with the compiled commands
- exposes a dry-run write plan for launcher, client-config, and install-manifest mutations
- executes the tracked default-access installer and reports resulting health plus created backups
- resolves client configuration through a generic client definition layer
- persists installer state under `%LOCALAPPDATA%\Mimir\installer` by default
- exposes Docker tool registry and `compose.tools.yml` status through the same report

What it does not do yet:

- clone or update the repo
- prepare dirty repos automatically
- apply Docker/runtime assets
- mutate Docker Toolkit state
- provide a GUI flow

Current client support is still limited to Codex, but the backend contract no
longer hard-codes Codex-specific configuration logic in the entrypoint itself.

## Choose a configuration profile

## Minimal repo-local profile

If you want the runtime state to stay inside the repository and you do not want model-backed providers yet, set these environment variables before starting a process:

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

- `packages/application/src/services/staging-draft-service.ts` falls back to a deterministic draft body when no drafting provider is configured
- `packages/infrastructure/src/vector/qdrant-vector-index.ts` uses `softFail: true` by default, so missing Qdrant degrades vector search instead of crashing the service
- the end-to-end tests repeatedly use the `hash` / `heuristic` / `disabled` / `local` provider profile

Important:

- `.env.example` is reference material only; the Node applications do not load `.env` files automatically
- if `MAB_DATA_ROOT` is unset, host state defaults under `%USERPROFILE%\.mimir` on Windows or `$HOME/.mimir` elsewhere
- override `MAB_VAULT_ROOT`, `MAB_STAGING_ROOT`, and `MAB_SQLITE_PATH` for repo-local or test-only state

## Containerized model-backed profile

The tracked container profile lives in `docker/compose.local.yml`:

```bash
docker compose -f docker/compose.local.yml up --build
```

That profile:

- builds the monorepo using `docker/mimir-api.Dockerfile`
- runs the HTTP adapter
- starts Qdrant
- points the app at `http://model-runner.docker.internal:12434`
- sets embedding, reasoning, drafting, and reranking providers to the Docker/Ollama-compatible stack

This compose profile is a deliberate runtime profile, not a restatement of the generic defaults in `packages/infrastructure/src/config/env.ts`.

## Global launcher aliases

The canonical launcher is `mimir`. The installer also creates compatibility launchers for old and shorthand names: `mimir-cli`, `mimis`, `mimis-cli`, `mimisbrunnr`, `mimisbrunnr-cli`, `mimirbrunnr`, `mimirbrunnr-cli`, `mimirsbrunnr`, `mimirsbrunnr-cli`, `brain`, `brain-cli`, `brain.CLI`, `multiagentbrain`, `multiagentbrain-cli`, `multiagent-brain`, `multi-agent-brain`, `multi-agent-brain-cli`, and `mab`.

Use `mimir` in new documentation and scripts. Keep the aliases only for backwards compatibility with existing habits, shell snippets, and agent skills.
## Verify the installation

After setting environment variables, run one or more of:

```bash
corepack pnpm cli -- version
corepack pnpm api
corepack pnpm mcp
corepack pnpm test:transport
corepack pnpm test
```

For Python runtime checks:

```bash
py -3 -m pytest runtimes/local_experts/tests/test_safety_gate.py -v   # Windows
python3 -m pytest runtimes/local_experts/tests/test_safety_gate.py -v # macOS/Linux
```

## What is not installed by default

- no `.env` loader
- no global launcher aliases unless you explicitly run `node scripts/install-mimir-launchers.mjs` or `node scripts/install-default-access.mjs`
- no tracked migration runner
- no one-shot local dev bootstrap script; tracked `scripts/` helpers and the current Windows installer backend are scoped operator utilities rather than a full bootstrap system

## Evidence status

### Verified facts

- Prerequisites and scripts come from `package.json`, app `package.json` files, `docker/mimir-api.Dockerfile`, and `runtimes/local_experts/README.md`
- Runtime defaults come from `packages/infrastructure/src/config/env.ts`
- Provider fallback behavior comes from `packages/application/src/services/staging-draft-service.ts` and `packages/infrastructure/src/vector/qdrant-vector-index.ts`

### Assumptions

- None

### TODO gaps

- If the repo gains a tracked `.env` loader or Python packaging metadata, update this file immediately
