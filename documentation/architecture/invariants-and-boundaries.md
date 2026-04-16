# Invariants and boundaries

These are the current high-value invariants enforced or strongly implied by tracked code and tests.

## Transport adapters stay thin

The three tracked transport adapters should remain shells over shared services and orchestration:

- `apps/mimir-api`
- `apps/mimir-cli`
- `apps/mimir-mcp`

They currently handle:

- ingress validation
- actor-context injection
- transport-specific error mapping
- delegation into the shared runtime

They do **not** own core business rules.

## Runtime command identity is shared

Routed runtime command identity is owned by `packages/contracts/src/orchestration/command-catalog.ts`.

That catalog defines:

- snake_case runtime command names
- kebab-case CLI/transport names
- task domains
- task families
- default actor roles

The task-family router, runtime command dispatcher, and CLI command/default-role metadata consume the catalog directly. Read-side authorization policy is owned by `packages/orchestration/src/root/command-authorization-matrix.ts`, which exposes `getCommandAuthorizationRoles()` and `getAdministrativeActionAuthorizationRoles()` so tests can verify every catalog command and administrative action has an explicit role policy. Transport request validation exposes `getSupportedTransportCommandNames()` from `packages/infrastructure/src/transport/request-validation.ts`, and the command-catalog regression test compares that registry with the catalog. Transport adapters may still keep adapter-specific validation and schema wiring, but new routed commands should be added to the catalog before they are exposed through CLI, HTTP, MCP, transport validation, or orchestration code.

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

## External personal-note sources are read-only

External sources such as Obsidian vaults are user-owned files outside Mimisbrunnr authority. They may be listed and read through explicit source contracts, but they must not become canonical memory or staging drafts without going through governed Mimir flows.

The current Obsidian vault source boundary is:

- external source contracts live in `packages/contracts/src/external-sources/external-source.contract.ts`
- external source registry contracts live in `packages/contracts/src/external-sources/external-source-registry.contract.ts`
- the infrastructure registry lives in `packages/infrastructure/src/external-sources/external-source-registry.ts` and is exposed through `buildServiceContainer(...).ports.externalSourceRegistry`
- the read-only adapter lives in `packages/infrastructure/src/external-sources/obsidian-vault-source.ts`
- source access is controlled by allowed and denied read globs
- `.obsidian/**` is denied by default
- path traversal and absolute paths are rejected
- `allowWrites` must be `false`
- the adapter exposes no write method

A future Obsidian plugin should call Mimir/Mimisbrunnr through this kind of policy boundary, then submit import jobs or draft proposals for review instead of writing directly to canonical memory.

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

## Docker AI tools do not own memory authority

Docker AI tool profiles are declared in `docker/tool-registry/*.json` and validated by `packages/infrastructure/src/tools/tool-registry.ts`.

The registry enforces this boundary:

- tool workspace mounts may be read-only or read-write depending on the tool
- tool cache mounts may be used for local acceleration
- `mimisbrunnr` mounts must be `none`
- durable memory writes must go through governed Mimir commands such as `create-session-archive` or `draft-note`

The registry may be discovered through CLI `list-ai-tools`, HTTP `/v1/tools/ai`, or MCP `list_ai_tools`. It may be validated through CLI `check-ai-tools`, HTTP `/v1/tools/ai/check`, or MCP `check_ai_tools`. Those surfaces return metadata and validation results only; they do not execute tools.

Do not grant a tool direct filesystem access to mimisbrunnr as a shortcut. That bypasses staging, review, audit, and promotion boundaries.

## Auth is command-aware and transport-aware

Auth responsibilities are currently split across:

- `packages/orchestration/src/root/command-authorization-matrix.ts` for command and administrative-action role policy
- `packages/orchestration/src/root/actor-registry-policy.ts` for actor normalization, lifecycle summaries, validity windows, and static credential matching
- `packages/orchestration/src/root/actor-token-inspector.ts` for static and issued token inspection against registry and revocation state
- `packages/orchestration/src/root/actor-authorization-policy.ts` as the public facade and transport-facing error boundary

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

Do not document auth as "token present means allowed." The policy is stricter than that.

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

The Node apps read `process.env` through the thin `loadEnvironment()` facade in `packages/infrastructure/src/config/env.ts`. Parsing and defaults are split across `packages/infrastructure/src/config/*.ts`. There is no tracked dotenv loader.

Documentation and automation should not assume `.env` support unless code is added for it.

## Evidence status

### Verified facts

- These invariants are grounded in tracked services, auth policy, runtime wiring, and tests under `tests/e2e`

### Assumptions

- None

### TODO gaps

- If namespace projection expands beyond note-backed rows, update the authority-state and namespace sections
