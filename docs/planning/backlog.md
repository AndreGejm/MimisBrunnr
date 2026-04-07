# Backlog

Statuses:

- `done`: implemented in the current repository
- `ready`: can be implemented now
- `blocked`: depends on earlier backlog items
- `later`: intentionally deferred until the core is stable
- `partial`: enabled in part, but not complete
- `not-in-stack`: intentionally outside the current production stack

## How To Read This File

This is the general backlog for the repository.

Use it to distinguish:

- what is already implemented
- what still needs completion
- what is intentionally deferred
- what is not part of the current stack even if the architecture can support it

For the current implemented state, see [`current-implementation.md`](./current-implementation.md).

For rollout readiness and the MCP adoption path, see [`go-live-gates.md`](./go-live-gates.md).

## Rollout-Critical Priority

If the goal is to make Multi Agent Brain the default MCP tool across all workspaces, the next backlog order is:

1. close the remaining shared-rollout hardening under `BK-001`
2. close the remaining freshness-governance work under `BK-007`
3. keep hierarchical retrieval behind packet-diff-reviewed rollout gates under `BK-008`

The pilot and all-workspace go-live gates for this sequence are documented in [`go-live-gates.md`](./go-live-gates.md).

## Architectural Review Carry-Forward

The highest-priority items from the earlier architectural review are now implemented.

The next implementation order now begins with the stricter read-path governance groundwork from [`read-path-alignment-rfc.md`](./read-path-alignment-rfc.md):

1. define authority-state invariants and namespace semantics under `RV-006`
2. close the remaining shared-rollout hardening under `BK-001`
3. close the remaining freshness-governance work under `BK-007`
3. keep hierarchical retrieval behind packet-diff-reviewed rollout gates under `BK-008`

## Review-Driven Ready Work

| ID | Work Item | Maps To | Status |
| --- | --- | --- | --- |
| RV-001 | Introduce an atomic promotion saga or outbox for filesystem, SQLite, FTS, and vector index writes | `F1` | done |
| RV-002 | Hard-enforce token budgets and summary-sentence limits during packet assembly | `F3` | done |
| RV-003 | Implement `tagFilters` end-to-end through lexical retrieval, vector retrieval, and fusion | `F4` | done |
| RV-004 | Add runtime schema validation at CLI, HTTP, and MCP ingress | `F8` | done |
| RV-005 | Harden SQLite access strategy and make vector degraded mode explicit in telemetry and health reporting | `F6`, `F7` | done |
| RV-006 | Define authority-state invariants and namespace semantics before namespace, import, session, or hierarchical retrieval work | `read-path-alignment-rfc.md` | ready |

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

## Coding Runtime Integration

| ID | Work Item | Source Requirement | Complexity | Status | Depends On | Repo Targets |
| --- | --- | --- | --- | --- | --- | --- |
| CR-001 | Vendor the local-experts coding runtime into this repository | Requirement-Service-Oriented-Architecture | medium | done | LR-006 | `runtimes/local_experts/**` |
| CR-002 | Replace the placeholder coding bridge with an adapter over the vendored runtime | Requirement-Transport-Isolation | high | done | CR-001 | `packages/orchestration/src/coding/*`, `packages/infrastructure/src/coding/*`, `runtimes/local_experts/**` |
| CR-003 | Add first-class coding-runtime regression coverage through the root orchestrator | Requirement-Validation-And-Regression | medium | done | CR-002 | `tests/e2e/*`, `runtimes/local_experts/tests/*` |

## Partial Or Remaining Core Work

| ID | Work Item | Why It Is Still Here | Status |
| --- | --- | --- | --- |
| BK-001 | Implement agent-scoped authentication and authorization | Actor-registry auth is now enforced across CLI, HTTP, MCP, and orchestrator command execution, with file-backed registry loading, rotated credentials, validity windows, issuer-secret-backed issued tokens, persisted issued-token lifecycle storage and operator listing, issued-token revocation, protected operator auth-status surfaces, HTTP token issuance/introspection/revocation routes, and CLI token issuance/introspection/revocation, but shared-rollout hardening still lacks a fuller central issuance lifecycle and multi-operator control plane | partial |
| BK-002 | Wire a real paid escalation provider behind the reserved `paid_escalation` role | A real OpenAI-compatible paid reasoning provider is now bound to the reserved role and can enrich escalation output when configured | done |
| BK-003 | Expose context-packet assembly directly through transports | First-class packet assembly is now exposed through CLI, HTTP, and MCP | done |
| BK-004 | Align `docker/compose.local.yml` with the live Docker Model Runner plus Qwen stack | Compose now mirrors the local Docker Model Runner plus Qwen role bindings | done |
| BK-005 | Refresh repository documentation to match the current implementation | Core repo READMEs and planning docs are synchronized with the current implementation | done |
| BK-006 | Define a formal Git-centric versioning contract | The runtime now exposes shared release metadata through CLI, HTTP, MCP initialization, and health surfaces, and the release workflow is documented in [`versioning-contract.md`](./versioning-contract.md) | done |
| BK-007 | Expand temporal-validity handling beyond current-state and staleness heuristics | Validity windows (`validFrom` / `validUntil`), validation, metadata persistence, stale ranking, expired and expiring-note retrieval warnings, runtime freshness reporting, operator-visible refresh-candidate reporting, governed refresh-draft creation across CLI, HTTP, MCP, and orchestrator surfaces, bounded batch refresh-draft creation from current freshness candidates, and idempotent reuse of open refresh drafts for the same stale canonical note are implemented, but broader lifecycle governance and stronger automated refresh policies are still incomplete | partial |
| BK-008 | Keep hierarchical retrieval behind rollout gates until default enablement is explicitly approved | Hierarchical retrieval is now available via explicit actor or transport strategy selection and exposes trace plus packet-diff metadata, but default enablement still requires side-by-side packet diff review and a documented rollback switch back to `flat` | partial |

## Optional Enhancement Backlog

| ID | Work Item | Why It Is Backlog | Status |
| --- | --- | --- | --- |
| BK-101 | Add entity graph storage and traversal | Compatible with the architecture, but not required for the current core stack | ready |
| BK-102 | Add session briefing artifacts | Useful on top of retrieval and audit history, but not foundational | later |
| BK-103 | Add import and export workflows | Useful for scale and interoperability, but not necessary for the local-first baseline | later |
| BK-104 | Formalize LLM consolidation as a stack-governance feature | The stack is operationally consolidated, but not documented or enforced as policy | later |
| BK-105 | Add reflection loops | Useful after the deterministic core is fully stable | later |
| BK-106 | Add cross-agent corroboration | Advanced coordination feature, not part of the current write path | later |
| BK-107 | Add client-resolution and richer multi-collection UX | Scaling and usability enhancement rather than a missing primitive | later |
| BK-108 | Add batch ingest and update workflows | Operational scaling feature, not part of the current baseline | later |

## Not In The Current Stack

| ID | Work Item | Why It Is Not In Stack | Status |
| --- | --- | --- | --- |
| BK-201 | Add webhooks and SSE | The system is currently request-response oriented | not-in-stack |
| BK-202 | Add dashboard and graph UI | The stack is service-first and currently has no UI layer | not-in-stack |
