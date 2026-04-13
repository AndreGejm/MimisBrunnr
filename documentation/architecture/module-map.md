# Module map

This is the current package/module map based on tracked manifests and imports.

## Core modules

| Module | Purpose | Key files | Inbound dependencies | Outbound dependencies | Runtime criticality |
| --- | --- | --- | --- | --- | --- |
| `packages/domain` | Shared domain vocabulary and invariants | `packages/domain/src/index.ts` | all higher layers | none | foundational |
| `packages/contracts` | Request/response contracts and MCP tool schemas | `packages/contracts/src/index.ts` | application, orchestration, infrastructure, apps | `packages/domain` | foundational |
| `packages/application` | Business services and port interfaces | `packages/application/src/index.ts` | orchestration, infrastructure | `packages/contracts`, `packages/domain` | high |
| `packages/orchestration` | Command routing, auth, controllers, model-role resolution | `packages/orchestration/src/index.ts` | infrastructure | `packages/application`, `packages/contracts`, `packages/domain` | high |
| `packages/infrastructure` | Runtime bootstrapping, adapters, providers, health, env loading | `packages/infrastructure/src/index.ts` | apps | `packages/application`, `packages/contracts`, `packages/domain`, `packages/orchestration` | high |
| `apps/brain-api` | HTTP adapter | `apps/brain-api/src/server.ts` | users, operators, tests | `@multi-agent-brain/contracts`, `@multi-agent-brain/infrastructure` | high |
| `apps/brain-cli` | CLI adapter | `apps/brain-cli/src/main.ts` | developers, operators, tests | `@multi-agent-brain/contracts`, `@multi-agent-brain/infrastructure` | high |
| `apps/brain-mcp` | stdio MCP adapter | `apps/brain-mcp/src/main.ts`, `apps/brain-mcp/src/tool-definitions.ts` | MCP clients, tests | `@multi-agent-brain/contracts`, `@multi-agent-brain/infrastructure` | high |
| `runtimes/local_experts` | Vendored Python coding worker | `runtimes/local_experts/bridge.py` | `PythonCodingControllerBridge` | Python-local modules and allowed tool functions | high for coding path only |

## Shared runtime container

`packages/infrastructure/src/bootstrap/build-service-container.ts` is the main assembly point and is the best single file for understanding how the system is actually wired.

It connects:

- filesystem note repositories
- SQLite stores
- FTS index
- vector index
- provider implementations
- auth policy
- application services
- domain controllers
- root orchestrator

## Candidate subsystem clusters

### Retrieval cluster

- `packages/application/src/services/retrieve-context-service.ts`
- `packages/application/src/services/hierarchical-retrieval-service.ts`
- `packages/application/src/services/context-packet-service.ts`
- `packages/application/src/services/decision-summary-service.ts`
- `packages/infrastructure/src/fts/sqlite-fts-index.ts`
- `packages/infrastructure/src/vector/qdrant-vector-index.ts`

Documentation sufficiency before this overhaul: not sufficient. Old docs did not map all current retrieval entrypoints or warn clearly about degraded vector behavior.

### Memory and promotion cluster

- `packages/application/src/services/staging-draft-service.ts`
- `packages/application/src/services/note-validation-service.ts`
- `packages/application/src/services/promotion-orchestrator-service.ts`
- `packages/application/src/services/temporal-refresh-service.ts`
- `packages/infrastructure/src/vault/*.ts`
- `packages/infrastructure/src/sqlite/sqlite-metadata-control-store.ts`

Documentation sufficiency before this overhaul: partial and stale. The previous docs did not explain promotion outbox replay, snapshot creation, or refresh-draft reuse accurately enough.

### Auth and governance cluster

- `packages/orchestration/src/root/actor-authorization-policy.ts`
- `packages/orchestration/src/root/issued-actor-token.ts`
- `packages/infrastructure/src/transport/auth-control-validation.ts`
- `packages/infrastructure/src/sqlite/sqlite-issued-token-store.ts`
- `packages/infrastructure/src/sqlite/sqlite-revocation-store.ts`

Documentation sufficiency before this overhaul: partial. Some auth-control surfaces were documented, but not consistently across transports.

### Namespace and derived context cluster

- `packages/application/src/services/context-namespace-service.ts`
- `packages/application/src/services/context-representation-service.ts`
- `packages/infrastructure/src/sqlite/sqlite-context-namespace-store.ts`
- `packages/infrastructure/src/sqlite/sqlite-context-representation-store.ts`

Documentation sufficiency before this overhaul: not sufficient. These surfaces were under-documented and missing from multiple adapter READMEs.

### Import and session-archive cluster

- `packages/application/src/services/import-orchestration-service.ts`
- `packages/application/src/services/session-archive-service.ts`
- `packages/infrastructure/src/sqlite/sqlite-import-job-store.ts`
- `packages/infrastructure/src/sqlite/sqlite-session-archive-store.ts`

Documentation sufficiency before this overhaul: not sufficient. The prior docs either omitted these surfaces or described them as future work.

### Coding cluster

- `packages/orchestration/src/coding/coding-domain-controller.ts`
- `packages/infrastructure/src/coding/python-coding-controller-bridge.ts`
- `runtimes/local_experts/**`

Documentation sufficiency before this overhaul: partial. The vendored runtime was described, but the actual bridge path and runtime prerequisites were not documented clearly enough.

## Evidence status

### Verified facts

- Package names and dependencies come from tracked `package.json` files
- Runtime assembly claims come from `packages/infrastructure/src/bootstrap/build-service-container.ts`

### Assumptions

- None

### TODO gaps

- If the workspace adds new top-level packages or apps, update this table and `documentation/reference/repo-map.md`
