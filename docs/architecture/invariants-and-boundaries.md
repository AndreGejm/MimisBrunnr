# Invariants and boundaries

These are the current high-value invariants enforced or strongly implied by tracked code and tests.

## Transport adapters stay thin

The three tracked transport adapters should remain shells over shared services and orchestration:

- `apps/brain-api`
- `apps/brain-cli`
- `apps/brain-mcp`

They currently handle:

- ingress validation
- actor-context injection
- transport-specific error mapping
- delegation into the shared runtime

They do **not** own core business rules.

## Authority states stay separate

The code distinguishes between:

- canonical notes
- staging drafts
- imported jobs
- session archives
- derived representations

Important consequences:

- imports are recorded as imported jobs and do not directly create canonical outputs
- session archives are immutable non-authoritative artifacts
- namespace browsing currently projects note-backed canonical/staging rows, not imported jobs or session archives

## Current-state notes are governed

Current-state behavior includes:

- a promoted current-state note can supersede earlier current-state notes
- current-state promotion can generate a deterministic snapshot note
- expired or expiring current-state notes are surfaced by freshness reporting
- refresh flows create staging drafts instead of mutating canonical notes in place

## Promotion is replayable

Promotion writes are not a single direct filesystem mutation. The current flow:

- enqueues a promotion outbox record
- processes the outbox entry
- updates canonical state, metadata, chunks, indices, and audit history

The replay path is intentional and covered by regression tests.

## Retrieval must remain bounded

The retrieval layer is designed to:

- classify intent
- search within explicit budgets
- produce bounded packets with provenance
- surface freshness and degradation warnings

Do not replace bounded packet assembly with unbounded note dumping without revisiting both tests and docs.

## Auth is command-aware and transport-aware

Auth decisions currently consider:

- actor identity
- role
- source
- transport
- allowed commands
- allowed administrative actions
- validity windows
- static credentials
- centrally issued tokens
- revocation state

Do not document auth as “token present means allowed.” The policy is stricter than that.

## Vector search is allowed to degrade

`QdrantVectorIndex` defaults to soft-fail behavior and records degraded health state instead of always failing closed.

Operational meaning:

- lexical retrieval can continue while vector mode is degraded
- health reports surface that degraded state
- readiness still treats unavailable Qdrant as a failure

## SQLite schema is code-owned

This repository currently has no tracked migration directory or migration runner.

Schema changes are implemented in adapter code under:

- `packages/infrastructure/src/sqlite/**`
- `packages/infrastructure/src/fts/sqlite-fts-index.ts`

That makes adapter edits operationally significant even when they look local.

## Environment loading is explicit

The Node apps read `process.env` directly through `loadEnvironment()`. There is no tracked dotenv loader.

Documentation and automation should not assume `.env` support unless code is added for it.

## Evidence status

### Verified facts

- These invariants are grounded in tracked services, auth policy, runtime wiring, and tests under `tests/e2e`

### Assumptions

- None

### TODO gaps

- If namespace projection expands beyond note-backed rows, update the authority-state and namespace sections
