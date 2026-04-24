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
| `.github/workflows/` | targeted GitHub Actions workflows for VoltAgent contract and canary coverage |
| `apps/` | transport entrypoints |
| `packages/` | layered TypeScript code |
| `docker/` | Dockerfiles, compose profiles, and Docker AI tool manifests |
| `documentation/` | canonical setup, runtime, operations, reference, and release docs |
| `docs/` | internal planning/spec snapshots for recent work |
| `runtimes/` | vendored Python coding runtime |
| `tests/` | end-to-end test suite |
| `scripts/` | launcher wrappers, access installers, installer backend, diagnostics, review GUI, and governed cleanup wrapper |

## Major subsystems

### Transport adapters

- `apps/mimir-api`
- `apps/mimir-cli`
- `apps/mimir-mcp`

### Shared runtime layers

- command catalog: `packages/contracts/src/orchestration/command-catalog.ts`
- shared runtime command dispatcher: `packages/infrastructure/src/transport/runtime-command-dispatcher.ts`
- transport validator registry: `packages/infrastructure/src/transport/request-validation.ts`
- request field validators: `packages/infrastructure/src/transport/request-field-validation.ts`
- coding request validators: `packages/infrastructure/src/transport/coding-request-validation.ts`
- transport validation error type: `packages/infrastructure/src/transport/transport-validation-error.ts`
- environment/config modules: `packages/infrastructure/src/config/*.ts` via `packages/infrastructure/src/config/env.ts`
- provider factory registry: `packages/infrastructure/src/providers/provider-factory-registry.ts`
- Docker AI tool registry facade: `packages/infrastructure/src/tools/tool-registry.ts`
- tool manifest store and descriptor builders: `packages/infrastructure/src/tools/tool-manifest-store.ts`, `packages/infrastructure/src/tools/tool-runtime-descriptor.ts`, and `packages/infrastructure/src/tools/tool-package-planner.ts`
- command authorization role matrix: `packages/orchestration/src/root/command-authorization-matrix.ts`
- actor registry policy: `packages/orchestration/src/root/actor-registry-policy.ts`
- actor token inspector: `packages/orchestration/src/root/actor-token-inspector.ts`
- external source contracts: `packages/contracts/src/external-sources/external-source.contract.ts` and `packages/contracts/src/external-sources/external-source-registry.contract.ts`
- external source adapter registry: `packages/infrastructure/src/external-sources/external-source-registry.ts`
- read-only Obsidian vault source adapter: `packages/infrastructure/src/external-sources/obsidian-vault-source.ts`
- `packages/domain`
- `packages/contracts`
- `packages/application`
- `packages/orchestration`
- `packages/infrastructure`

### Vendored coding runtime

- `runtimes/local_experts`

## Execution surfaces

### Application entrypoints

- HTTP: `apps/mimir-api/src/main.ts`
- CLI: `apps/mimir-cli/src/main.ts`
- MCP: `apps/mimir-mcp/src/main.ts`

### Shared bootstrap

- `packages/infrastructure/src/bootstrap/build-service-container.ts`

### Orchestration root

- `packages/orchestration/src/root/mimir-orchestrator.ts`

### Coding bridge

- `packages/infrastructure/src/coding/python-coding-controller-bridge.ts`
- `runtimes/local_experts/bridge.py`

### Docker entrypoints

- `docker/mimir-api.Dockerfile`
- `docker/compose.local.yml`
- `docker/mimir-mcp.Dockerfile`
- `docker/compose.mcp-session.yml`
- `docker/mimir-mcp-session-entrypoint.mjs`
- `docker/compose.tools.yml`
- `docker/tool-registry/*.json`

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

### External source adapters

- source contracts and policy shape: `packages/contracts/src/external-sources/external-source.contract.ts`
- registry contract: `packages/contracts/src/external-sources/external-source-registry.contract.ts`
- infrastructure registry: `packages/infrastructure/src/external-sources/external-source-registry.ts`
- read-only Obsidian vault adapter: `packages/infrastructure/src/external-sources/obsidian-vault-source.ts`

External source adapters are gatekeeper surfaces for user-owned files. The current Obsidian adapter is registered through the external source registry exposed from `buildServiceContainer(...).ports.externalSourceRegistry`, lists and reads policy-allowed Markdown notes, parses simple frontmatter and links, blocks `.obsidian/**`, rejects path traversal, and exposes no write method. It is intended as the code foundation for a future local Obsidian plugin without weakening Mimisbrunnr staging, review, audit, and promotion rules.

### Docker AI tool registry

- registry facade: `packages/infrastructure/src/tools/tool-registry.ts`
- manifest store: `packages/infrastructure/src/tools/tool-manifest-store.ts`
- runtime descriptor builder: `packages/infrastructure/src/tools/tool-runtime-descriptor.ts`
- package-plan builder: `packages/infrastructure/src/tools/tool-package-planner.ts`
- declarative tool manifests: `docker/tool-registry/*.json`
- manifest schema for reusable toolbox packaging: `docker/tool-registry.schema.json`
- Docker Desktop profiles: `docker/compose.tools.yml`
- toolbox policy manifests for future Docker toolbox sessions: `docker/mcp/**`
- installer/doctor reusable asset preflight and standalone Docker tool manifest summaries: `scripts/lib/default-access.mjs`
- Docker toolbox audit and runtime-plan scripts: `scripts/docker/audit-toolbox-assets.mjs`, `scripts/docker/sync-mcp-profiles.mjs`
- Windows installer backend for environment detection, repo preparation, access diagnostics, toolbox asset audit, toolbox runtime preparation, Docker MCP Toolkit audit, Docker Toolkit apply-plan compatibility reporting, dry-run write planning, tracked access apply, and persisted installer state: `scripts/installers/windows/**`

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
- `tests/e2e/hermes-bridge-runtime.test.mjs`
- `tests/e2e/authorization-policy.test.mjs`
- `tests/e2e/service-boundaries-and-regression.test.mjs`
- `tests/e2e/import-pipeline.test.mjs`
- `tests/e2e/external-source-policy.test.mjs`
- `tests/e2e/transport-adapters.test.mjs`
- `tests/e2e/mcp-adapter.test.mjs`
- `tests/e2e/local-model-providers.test.mjs`
- `tests/e2e/external-source-registry.test.mjs`
- `tests/e2e/config-boundaries.test.mjs`
- `tests/e2e/command-catalog.test.mjs`
- `tests/e2e/transport-validation-boundaries.test.mjs`
- `tests/e2e/request-field-validation-boundaries.test.mjs`
- `tests/e2e/coding-transport-validation-boundaries.test.mjs`
- `tests/e2e/tool-registry.test.mjs`
- `tests/e2e/mcp-session-startup.test.mjs`

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
- `documentation/superpowers/specs/*`
- `docs/superpowers/plans/*`
- `docs/superpowers/specs/*`

## Tracked absences

The tracked repo currently has no:

- Kubernetes manifests
- Terraform
- migration directory
- a one-shot bootstrap script; `scripts/` contains scoped helpers instead

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

### Documentation maintenance note

- Expand the top-level map and tracked absences sections if the repo adds new tracked workflow, installer, or packaging surfaces
