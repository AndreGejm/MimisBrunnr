# Current Implementation

This document describes what is actually implemented in the repository today.

For anything incomplete, deferred, or intentionally outside the current stack, see [`backlog.md`](./backlog.md).

## Architectural Summary

The running architecture is a local-first monorepo with clear boundaries:

- `packages/domain`
  - note, chunk, retrieval, audit, and lifecycle primitives
- `packages/contracts`
  - typed request and response contracts used across transports
- `packages/application`
  - note validation, staging drafts, chunking, retrieval, packet assembly, promotion, and history services
- `packages/infrastructure`
  - filesystem repositories, SQLite adapters, FTS, Qdrant, health checks, provider implementations, and bootstrap
- `packages/orchestration`
  - root routing, domain controllers, model-role resolution, and provider registry
- `apps/brain-cli`
  - thin JSON CLI transport
- `apps/brain-api`
  - thin HTTP transport
- `apps/brain-mcp`
  - thin MCP stdio transport
- `runtimes/local_experts`
  - vendored Python coding runtime used by the coding domain

## What Is Implemented

### Core runtime

- service-container bootstrap that assembles the full runtime
- deterministic root orchestrator
- separate brain and coding domains
- transport-agnostic application core

### Memory and storage

- canonical Markdown note repository on disk
- staging note repository on disk
- structured frontmatter and note validation
- temporal-validity windows via `validFrom` and `validUntil`
- shared release metadata derived from workspace version plus optional Git tag and commit overrides
- auth issuer-secret support for centrally issued short-lived actor tokens
- controlled tag vocabulary enforcement
- corpus separation for `context_brain` and `general_notes`
- SQLite metadata authority
- SQLite audit history
- shared SQLite connection strategy with WAL and busy-timeout configuration across metadata, audit, and FTS adapters

### Retrieval

- Markdown-aware chunking
- chunk adjacency preservation
- SQLite FTS lexical retrieval
- Qdrant vector retrieval
- `flat` retrieval remains the default baseline
- `hierarchical` retrieval is available only through explicit strategy selection at actor/service call sites or validated transport requests
- ranking fusion with staleness-aware behavior
- temporal-validity-aware stale classification for expired or not-yet-valid notes
- runtime freshness reporting and operator-visible refresh candidates for expired and expiring current-state notes
- governed refresh-draft creation for expired, future-dated, or expiring-soon current-state notes
- bounded batch refresh-draft creation for current freshness candidates across CLI, HTTP, MCP, and orchestrator surfaces
- idempotent refresh-draft reuse so the same stale canonical note does not spawn duplicate open refresh drafts
- retrieval warnings when bounded evidence includes expired, expiring-soon, or not-yet-valid notes
- bounded context packet assembly
- hard token-budget and summary-sentence enforcement during packet assembly
- `tagFilters` enforced across lexical retrieval, vector retrieval, and fusion
- explicit degraded-mode vector health surfaced in retrieval warnings and runtime health reporting
- direct context-packet transport exposure
- retrieval traces with strategy labels and packet-diff metadata for side-by-side flat versus hierarchical evaluation
- decision-summary generation
- runtime schema validation at CLI, HTTP, and MCP ingress
- `GET /v1/system/version` plus release metadata embedded in health reports
- `GET /v1/system/auth` for operator-facing auth registry status

### Governance

- staging-only drafting flow
- deterministic promotion gate
- durable promotion outbox with replayable canonical, metadata, FTS, and vector sync processing
- duplicate detection
- supersede and current-state logic
- actor-registry-backed authn/authz across CLI, HTTP, MCP, and orchestrator command dispatch
- file-backed actor-registry loading with rotated credential windows and entry validity support
- issuer-secret-backed short-lived issued tokens for registered actors
- persisted issued-token lifecycle storage and listing through SQLite
- file-backed issued-token revocation support for immediate denylisting of minted actor tokens
- protected operator auth-control surfaces for auth status, issued-token listing, token issuance, token introspection, and token revocation
- promotion event recording
- audit-history queries
- a documented Git-centric versioning contract with runtime release metadata surfaces

### Local model and coding stack

- Docker Model Runner local integration
- Qwen-based local model stack
- model-role and provider abstraction layer
- OpenAI-compatible paid escalation reasoning path when configured
- vendored Python coding runtime integrated through the orchestrator
- bounded coding task execution with repo-root constraints

## Active Local Stack

- Node.js 22+
- TypeScript
- pnpm workspace
- SQLite
- Qdrant
- Docker Model Runner
- `qwen3:4B-F16`
- `qwen3-coder`
- `qwen3-reranker`
- `docker.io/ai/qwen3-embedding:0.6B-F16`
- Windows host default canonical brain root at `F:\Dev\AI Context Brain` when `MAB_VAULT_ROOT` is unset

## Transport Surfaces

### CLI

- `version`
- `auth-status`
- `auth-issued-tokens`
- `auth-introspect-token`
- `revoke-auth-token`
- `freshness-status`
- `issue-auth-token`
- `execute-coding-task`
- `search-context`
- `get-context-packet`
- `fetch-decision-summary`
- `draft-note`
- `create-refresh-draft`
- `create-refresh-drafts`
- `validate-note`
- `promote-note`
- `query-history`

### HTTP

- `GET /health/live`
- `GET /health/ready`
- `GET /v1/system/auth`
- `GET /v1/system/auth/issued-tokens`
- `GET /v1/system/freshness`
- `GET /v1/system/version`
- `POST /v1/system/auth/issue-token`
- `POST /v1/system/auth/introspect-token`
- `POST /v1/system/auth/revoke-token`
- `POST /v1/coding/execute`
- `POST /v1/context/search`
- `POST /v1/context/packet`
- `POST /v1/context/decision-summary`
- `POST /v1/notes/drafts`
- `POST /v1/system/freshness/refresh-draft`
- `POST /v1/system/freshness/refresh-drafts`
- `POST /v1/notes/validate`
- `POST /v1/notes/promote`
- `POST /v1/history/query`

### MCP tools

- `execute_coding_task`
- `search_context`
- `get_context_packet`
- `fetch_decision_summary`
- `draft_note`
- `create_refresh_draft`
- `create_refresh_drafts`
- `validate_note`
- `promote_note`
- `query_history`

## Partial Or Incomplete Areas

These areas have enabling structure but are not fully complete:

- shared-rollout auth hardening beyond the file-backed actor registry, rotated credentials, issued tokens, persisted issued-token lifecycle reporting, issued-token revocation, protected local operator control surfaces, and basic token lifecycle operations
- richer temporal-validity governance beyond validity windows, refresh-candidate reporting, bounded batch refresh-draft creation, idempotent refresh-draft reuse, explicit refresh-draft creation, freshness warnings, and stale ranking
- hierarchical retrieval rollout beyond the current `flat` default, explicit opt-in strategy selection, trace metadata, packet-diff checks, and the documented rollback path back to `flat`

See [`backlog.md`](./backlog.md) for the linked backlog items.

## Not Yet Implemented Or Not In Stack

The following items are not part of the current production stack:

- entity graph
- session briefing
- import/export workflows
- formal LLM consolidation program
- reflection loops
- cross-agent corroboration
- webhooks and SSE
- dashboard or graph UI
- richer client-resolution and multi-collection UX
- batch ingest and update flows

These are tracked in [`backlog.md`](./backlog.md).
