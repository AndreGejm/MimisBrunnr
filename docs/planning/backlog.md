# Backlog

Statuses:

- `done`: implemented in the current scaffold
- `ready`: can be implemented now
- `blocked`: depends on earlier backlog items
- `later`: intentionally deferred until the core is stable

## Ready Now

| ID | Work Item | Source Requirement | Complexity | Status | Repo Targets |
| --- | --- | --- | --- | --- | --- |
| WF-001 | Finalize workspace root scripts and package metadata | Requirement-Service-Oriented-Architecture | high | done | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` |
| WF-002 | Expand common contracts for retrieval, drafting, validation, promotion, and history | Requirement-Typed-Service-Contracts | medium | done | `packages/contracts/src/**` |
| WF-003 | Lock in core domain primitives for corpora, note types, lifecycle, chunk records, and context packets | Requirement-Service-Oriented-Architecture | high | done | `packages/domain/src/**` |
| WF-004 | Define repository, index, provider, and audit ports | Requirement-Transport-Isolation | high | done | `packages/application/src/ports/**` |
| WF-005 | Create environment loader and service container bootstrap | Requirement-Docker-Readiness | medium | done | `packages/infrastructure/src/config/env.ts`, `packages/infrastructure/src/bootstrap/build-service-container.ts` |
| WF-006 | Write boundary tests for role/capability separation at the service layer | Requirement-Boundary-Hardening | high | done | `tests/e2e/` |
| WF-007 | Reserve future MCP tool shapes in docs and keep service outputs bounded | Requirement-MCP-Adapter-Readiness | medium | done | `docs/planning/*`, `packages/contracts/src/**` |

## Blocked Until Canonical Authority Is Implemented

| ID | Work Item | Source Requirement | Complexity | Status | Depends On | Repo Targets |
| --- | --- | --- | --- | --- | --- | --- |
| CA-001 | Implement filesystem-backed canonical note repository | Requirement-Canonical-Vault | high | done | WF-004 | `packages/infrastructure/src/vault/file-system-canonical-note-repository.ts` |
| CA-002 | Implement filesystem-backed staging note repository | Requirement-Writer-Staging-Plane | medium | done | WF-004 | `packages/infrastructure/src/vault/file-system-staging-note-repository.ts` |
| CA-003 | Design SQLite schema for notes, chunks, tags, lifecycle, and audit | Requirement-SQLite-Control-Store | high | done | WF-004, WF-005 | `packages/infrastructure/src/sqlite/sqlite-metadata-control-store.ts` |
| CA-004 | Implement deterministic note schema and controlled tag validation | Requirement-Note-Schema-And-Tags | medium | done | CA-001, CA-003 | `packages/application/src/services/note-validation-service.ts` |
| CA-005 | Enforce corpus separation for `context_brain` and `general_notes` | Requirement-Corpus-Separation | medium | done | CA-001, CA-003 | `packages/application/src/services/canonical-note-service.ts`, `packages/application/src/services/staging-draft-service.ts`, `packages/application/src/services/note-validation-service.ts` |

## Retrieval Core

| ID | Work Item | Source Requirement | Complexity | Status | Depends On | Repo Targets |
| --- | --- | --- | --- | --- | --- | --- |
| RT-001 | Implement Markdown-aware chunking with adjacency and heading preservation | Requirement-Markdown-Chunking | high | done | CA-001, CA-003 | `packages/application/src/services/chunking-service.ts` |
| RT-002 | Persist derived chunk metadata for summaries, scope, qualifiers, and staleness | Requirement-Derived-Chunk-Metadata | medium | done | RT-001, CA-004 | `packages/infrastructure/src/sqlite/sqlite-metadata-control-store.ts` |
| RT-003 | Add local query intent classification boundary | Requirement-Query-Intent-Classification | low | done | WF-004 | `packages/application/src/ports/local-reasoning-provider.ts`, `packages/application/src/services/*`, `packages/infrastructure/src/providers/heuristic-local-reasoning-provider.ts` |
| RT-004 | Implement lexical retrieval with FTS5 over chunk records | Requirement-Hybrid-Retrieval-Assembly | high | done | RT-001, CA-003 | `packages/infrastructure/src/fts/sqlite-fts-index.ts` |
| RT-005 | Implement vector retrieval as additive semantic search | Requirement-Hybrid-Retrieval-Assembly | high | done | RT-001, WF-004, WF-005 | `packages/infrastructure/src/vector/qdrant-vector-index.ts`, `packages/infrastructure/src/providers/hash-embedding-provider.ts` |
| RT-006 | Encode ranking and staleness policy into fusion service | Requirement-Ranking-And-Staleness-Policy | medium | done | RT-002, RT-003, CA-005 | `packages/application/src/services/ranking-fusion-service.ts` |
| RT-007 | Enforce bounded retrieval packet assembly | Requirement-Retrieval-Packet-Contract | medium | done | RT-002, RT-006 | `packages/application/src/services/context-packet-service.ts` |
| RT-008 | Build hybrid retrieval pipeline that keeps stage-1 results internal | Requirement-Hybrid-Retrieval-Assembly | high | done | RT-004, RT-005, RT-006, RT-007 | `packages/application/src/services/lexical-retrieval-service.ts`, `packages/application/src/services/vector-retrieval-service.ts`, `packages/application/src/services/retrieve-context-service.ts` |

## Promotion And Governance

| ID | Work Item | Source Requirement | Complexity | Status | Depends On | Repo Targets |
| --- | --- | --- | --- | --- | --- | --- |
| GV-001 | Implement writer drafting service against staging repository | Requirement-Writer-Staging-Plane | medium | done | CA-002, CA-004 | `packages/application/src/services/staging-draft-service.ts` |
| GV-002 | Implement promotion policy checks and duplicate detection | Requirement-Promotion-Policy | medium | done | GV-001, CA-004, CA-005 | `packages/application/src/services/promotion-orchestrator-service.ts` |
| GV-003 | Implement deterministic orchestrator as the only promotion authority | Requirement-Deterministic-Orchestrator | high | done | GV-002, RT-001 | `packages/application/src/services/promotion-orchestrator-service.ts` |
| GV-004 | Add current-state snapshot note generation and supersede logic | Requirement-Current-State-Snapshots | low | done | GV-002, CA-001 | `packages/application/src/services/canonical-note-service.ts`, `packages/application/src/services/promotion-orchestrator-service.ts` |
| GV-005 | Add audit log persistence and queryable history | Requirement-Audit-And-History | medium | done | GV-003, CA-003 | `packages/application/src/services/audit-history-service.ts`, `packages/infrastructure/src/sqlite/*` |

## Local Runtime And Validation

| ID | Work Item | Source Requirement | Complexity | Status | Depends On | Repo Targets |
| --- | --- | --- | --- | --- | --- | --- |
| LR-001 | Implement local-first provider adapters with optional model use | Requirement-Model-Provider-Abstractions | medium | done | WF-004, WF-005 | `packages/infrastructure/src/providers/*` |
| LR-002 | Add CLI commands as thin wrappers over services | Requirement-Transport-Isolation | high | done | GV-003, RT-008 | `apps/brain-cli/src/**` |
| LR-003 | Add HTTP routes as thin wrappers over services | Requirement-Transport-Isolation | high | done | GV-003, RT-008 | `apps/brain-api/src/**` |
| LR-004 | Add health checks and Docker runtime assets | Requirement-Docker-Readiness | medium | done | LR-002, LR-003 | `docker/*`, `packages/infrastructure/src/health/*` |
| LR-005 | Add regression suites for schema, chunking, packet size, promotion, and corpus separation | Requirement-Validation-And-Regression | medium | done | GV-005, RT-008 | `tests/e2e/*` |
| LR-006 | Add MCP transport as a thin adapter over stable services | Requirement-MCP-Adapter-Readiness | medium | done | LR-002, LR-003, LR-005 | `apps/brain-mcp/src/**` |
