# Repository map

This map is based on tracked repository content. It intentionally separates tracked repo structure from untracked workspace residue.

## Top-level tracked map

| Path | Purpose |
| --- | --- |
| `README.md` | canonical project overview |
| `documentation/CONTRIBUTING.md` | contributor guidance |
| `package.json` | root scripts and engine requirements |
| `pnpm-workspace.yaml` | workspace definition |
| `pnpm-lock.yaml` | lockfile |
| `.env.example` | reference env template |
| `apps/` | transport entrypoints |
| `packages/` | layered TypeScript code |
| `docker/` | Dockerfile and compose profile |
| `documentation/` | canonical docs plus planning/history docs |
| `runtimes/` | vendored Python coding runtime |
| `tests/` | end-to-end test suite |
| `scripts/` | currently only a placeholder README |

## Major subsystems

### Transport adapters

- `apps/brain-api`
- `apps/brain-cli`
- `apps/brain-mcp`

### Shared runtime layers

- `packages/domain`
- `packages/contracts`
- `packages/application`
- `packages/orchestration`
- `packages/infrastructure`

### Vendored coding runtime

- `runtimes/local_experts`

## Execution surfaces

### Application entrypoints

- HTTP: `apps/brain-api/src/main.ts`
- CLI: `apps/brain-cli/src/main.ts`
- MCP: `apps/brain-mcp/src/main.ts`

### Shared bootstrap

- `packages/infrastructure/src/bootstrap/build-service-container.ts`

### Orchestration root

- `packages/orchestration/src/root/multi-agent-orchestrator.ts`

### Coding bridge

- `packages/infrastructure/src/coding/python-coding-controller-bridge.ts`
- `runtimes/local_experts/bridge.py`

### Docker entrypoint

- `docker/brain-api.Dockerfile`
- `docker/compose.local.yml`

## Storage surfaces

### Filesystem-backed

- canonical repository: `packages/infrastructure/src/vault/file-system-canonical-note-repository.ts`
- staging repository: `packages/infrastructure/src/vault/file-system-staging-note-repository.ts`

### SQLite-backed

- metadata: `packages/infrastructure/src/sqlite/sqlite-metadata-control-store.ts`
- audit: `packages/infrastructure/src/sqlite/sqlite-audit-log.ts`
- issued tokens: `packages/infrastructure/src/sqlite/sqlite-issued-token-store.ts`
- revocations: `packages/infrastructure/src/sqlite/sqlite-revocation-store.ts`
- import jobs: `packages/infrastructure/src/sqlite/sqlite-import-job-store.ts`
- session archives: `packages/infrastructure/src/sqlite/sqlite-session-archive-store.ts`
- namespace: `packages/infrastructure/src/sqlite/sqlite-context-namespace-store.ts`
- representations: `packages/infrastructure/src/sqlite/sqlite-context-representation-store.ts`
- shared connection: `packages/infrastructure/src/sqlite/shared-sqlite-connection.ts`

### Search/indexing

- lexical FTS: `packages/infrastructure/src/fts/sqlite-fts-index.ts`
- vector index: `packages/infrastructure/src/vector/qdrant-vector-index.ts`

## Integration surfaces

### External service adapters

- Qdrant: `packages/infrastructure/src/vector/qdrant-vector-index.ts`
- Ollama-compatible providers:
  - `packages/infrastructure/src/providers/ollama-embedding-provider.ts`
  - `packages/infrastructure/src/providers/ollama-local-reasoning-provider.ts`
  - `packages/infrastructure/src/providers/ollama-drafting-provider.ts`
  - `packages/infrastructure/src/providers/ollama-reranker-provider.ts`
- paid OpenAI-compatible provider:
  - `packages/infrastructure/src/providers/openai-compatible-local-reasoning-provider.ts`

### Internal process boundary

- Python subprocess runtime: `runtimes/local_experts/**`

## Test surfaces

### Node end-to-end tests

- `tests/e2e/context-authority-contracts.test.mjs`
- `tests/e2e/context-namespace.test.mjs`
- `tests/e2e/context-representations.test.mjs`
- `tests/e2e/retrieval-trace.test.mjs`
- `tests/e2e/retrieval-strategy-diff.test.mjs`
- `tests/e2e/hierarchical-retrieval.test.mjs`
- `tests/e2e/session-archives.test.mjs`
- `tests/e2e/service-boundaries-and-regression.test.mjs`
- `tests/e2e/import-pipeline.test.mjs`
- `tests/e2e/transport-adapters.test.mjs`
- `tests/e2e/mcp-adapter.test.mjs`
- `tests/e2e/local-model-providers.test.mjs`

### Python test surface

- `runtimes/local_experts/tests/test_safety_gate.py`

## Documentation surfaces

### Canonical current-state docs

- `README.md`
- `documentation/CONTRIBUTING.md`
- `documentation/setup/*`
- `documentation/architecture/*`
- `documentation/operations/*`
- `documentation/testing/*`
- `documentation/reference/*`
- `documentation/agents/ai-navigation-guide.md`

### Historical/planning docs

- `documentation/planning/*`
- `documentation/superpowers/plans/*`

## Tracked absences

The tracked repo currently has no:

- `.github/` workflow definitions
- Kubernetes manifests
- Terraform
- migration directory
- tracked bootstrap scripts in `scripts/`

## Local workspace residue note

The current workspace may contain untracked items such as:

- `.codesight/`
- `.cursorrules`
- `AGENTS.md`
- `CLAUDE.md`
- `codex.md`
- `vault/`

Those are not part of the tracked repository unless they are later committed.

## Evidence status

### Verified facts

- This file is based on tracked files plus local `git status --short` to separate untracked workspace residue

### Assumptions

- None

### TODO gaps

- If the tracked repo gains CI, deployment, migration, or bootstrap surfaces, add them here
