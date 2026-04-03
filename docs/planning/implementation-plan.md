# Implementation Plan

This plan translates the staged Obsidian requirement set into a dependency-ordered execution roadmap for the repository scaffold.

## Inputs

The plan is derived from the requirement packets in `obsidian-staging/Multi-Agent-Brain/12_Requirement-Specs`, especially:

- `Requirement-Boundary-Hardening`
- `Requirement-Service-Oriented-Architecture`
- `Requirement-Typed-Service-Contracts`
- `Requirement-Transport-Isolation`
- `Requirement-MCP-Adapter-Readiness`
- `Requirement-Canonical-Vault`
- `Requirement-SQLite-Control-Store`
- `Requirement-Note-Schema-And-Tags`
- `Requirement-Corpus-Separation`
- `Requirement-Writer-Staging-Plane`
- `Requirement-Markdown-Chunking`
- `Requirement-Derived-Chunk-Metadata`
- `Requirement-Query-Intent-Classification`
- `Requirement-Ranking-And-Staleness-Policy`
- `Requirement-Retrieval-Packet-Contract`
- `Requirement-Hybrid-Retrieval-Assembly`
- `Requirement-Promotion-Policy`
- `Requirement-Deterministic-Orchestrator`
- `Requirement-Audit-And-History`
- `Requirement-Validation-And-Regression`

Reserved MCP tool contracts and the future adapter surface are documented in `docs/planning/mcp-tool-map.md`.

## Phase 0: Platform Foundation

Goal:
Establish the internal boundaries that every later implementation will rely on.

Requirements:

- Boundary hardening
- Service-oriented architecture
- Typed service contracts
- Transport isolation
- MCP adapter readiness
- Model provider abstractions
- Local-first defaults
- Docker readiness

Repository targets:

- root workspace config
- `packages/contracts`
- `packages/domain`
- `packages/application/src/ports`
- `packages/infrastructure/src/config`
- `packages/infrastructure/src/bootstrap`

Exit criteria:

- every cross-layer interaction uses a named contract or port
- no transport-specific payload is required by core logic
- environment configuration is externalized
- future MCP tool names already map onto bounded contracts in `packages/contracts/src/mcp`

## Phase 1: Canonical Memory Authority

Goal:
Make Markdown notes and SQLite the authoritative system of record.

Requirements:

- Canonical vault
- SQLite control store
- Note schema and tags
- Corpus separation
- Writer staging plane

Repository targets:

- `packages/application/src/services/note-validation-service.ts`
- `packages/application/src/services/canonical-note-service.ts`
- `packages/application/src/services/staging-draft-service.ts`
- `packages/infrastructure/src/vault/*`
- `packages/infrastructure/src/sqlite/*`

Exit criteria:

- canonical and staging repositories exist behind ports
- note schema is validated deterministically
- corpora are separated at repository and metadata levels

## Phase 2: Retrieval Substrate

Goal:
Implement chunk-aware, bounded retrieval over governed data.

Requirements:

- Markdown chunking
- Derived chunk metadata
- Query intent classification
- Ranking and staleness policy
- Retrieval packet contract
- Hybrid retrieval assembly

Repository targets:

- `packages/application/src/services/chunking-service.ts`
- `packages/application/src/services/lexical-retrieval-service.ts`
- `packages/application/src/services/vector-retrieval-service.ts`
- `packages/application/src/services/ranking-fusion-service.ts`
- `packages/application/src/services/context-packet-service.ts`
- `packages/infrastructure/src/fts/*`
- `packages/infrastructure/src/vector/*`
- `packages/infrastructure/src/providers/*`

Exit criteria:

- retrieval returns bounded context packets instead of raw chunk dumps
- stage-1 retrieval never reaches downstream models directly
- chunk metadata supports reduction before raw expansion

## Phase 3: Promotion And Governance

Goal:
Turn staging drafts into canonical notes through deterministic validation and promotion.

Requirements:

- Promotion policy
- Deterministic orchestrator
- Current-state snapshots
- Audit and history

Repository targets:

- `packages/application/src/services/promotion-orchestrator-service.ts`
- `packages/application/src/services/audit-history-service.ts`
- `packages/infrastructure/src/health/*`
- `packages/infrastructure/src/sqlite/*`

Exit criteria:

- only the orchestrator can promote canonical state
- supersede and current-state logic is enforced before promotion
- every meaningful action emits an audit entry

## Phase 4: Verification And Local Adapters

Goal:
Add thin local transports and regression coverage without violating service boundaries.

Requirements:

- Validation and regression
- local CLI and HTTP adapters
- Docker runtime wrapper

Repository targets:

- `apps/brain-cli/*`
- `apps/brain-api/*`
- `tests/e2e/*`
- `docker/*`
- `scripts/*`

Exit criteria:

- CLI and HTTP call the same application services
- regression tests cover trust boundaries, packet size, promotion, and corpus separation
- Docker can wrap the app without architecture changes

## Deferred Phase: MCP Adapter

Goal:
Add `apps/brain-mcp` as a thin tool adapter after the service layer is stable.

Requirements:

- MCP adapter readiness

Repository targets:

- `apps/brain-mcp/src/main.ts`
- `apps/brain-mcp/src/tools/*`

Exit criteria:

- each MCP tool maps directly onto an existing service contract
- no MCP-specific business logic is needed in application services
