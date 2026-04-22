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
- `apps/mimir-cli`
  - thin JSON CLI transport
- `apps/mimir-api`
  - thin HTTP transport
- `apps/mimir-mcp`
  - thin MCP stdio transport
- `runtimes/local_experts`
  - vendored Python coding runtime used by the coding domain

## What Is Implemented

### Core runtime

- service-container bootstrap that assembles the full runtime
- deterministic root orchestrator
- separate mimisbrunnr and coding domains
- transport-agnostic application core

### Memory and storage

- canonical Markdown note repository on disk
- staging note repository on disk
- structured frontmatter and note validation
- temporal-validity windows via `validFrom` and `validUntil`
- shared release metadata derived from workspace version plus optional Git tag and commit overrides
- auth issuer-secret support for centrally issued short-lived actor tokens
- controlled tag vocabulary enforcement
- corpus separation for `mimisbrunnr` and `general_notes`
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
- persisted issued-token lifecycle storage and listing through SQLite, including issuer attribution for active records, revoker attribution for revoked records, operator-facing filtering by issuer, revoker, and lifecycle state, and queryable audit-history events for token issue plus revoke operations
- central auth-issuer lifecycle control surfaces across CLI and HTTP, including operator-visible issuer listings, per-issuer enablement and time-bounded overrides, audit events for issuer-control changes, and registry-bounded no-widening enforcement for multi-operator issuance and revocation roles
- file-backed issued-token revocation support for immediate denylisting of minted actor tokens
- protected operator auth-control surfaces for auth status, issuer listing, issued-token listing, token issuance, token introspection, issuer-control updates, and token revocation across CLI and HTTP
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
- host state defaults under `%USERPROFILE%\.mimir` on Windows or `$HOME/.mimir` elsewhere when `MAB_DATA_ROOT` and the explicit storage path variables are unset

## Transport Surfaces

### CLI

- `version`
- `auth-issuers`
- `auth-status`
- `auth-issued-tokens`
- `auth-introspect-token`
- `revoke-auth-token`
- `revoke-auth-tokens`
- `set-auth-issuer-state`
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
- `GET /v1/system/auth/issuers`
- `GET /v1/system/auth/issued-tokens`
- `GET /v1/system/freshness`
- `GET /v1/system/version`
- `POST /v1/system/auth/issuer-state`
- `POST /v1/system/auth/issue-token`
- `POST /v1/system/auth/introspect-token`
- `POST /v1/system/auth/revoke-token`
- `POST /v1/system/auth/revoke-tokens`
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

### Toolbox control plane

- compiled manifests under `docker/mcp` (categories, trust classes, intents, server descriptors, profiles, client overlays) define the runtime surface as checked-in policy
- `mimir-control-mcp` exposes toolbox lifecycle tools (`list_toolboxes`, `describe_toolbox`, `request_toolbox_activation`, `list_active_toolbox`, `list_active_tools`, `deactivate_toolbox`)
- session leases with revision-bound, audience-bound tokens; `toolbox_expired` audit events on expiry deactivation
- Docker runtime planning (`docker:mcp:sync`) and installer audit (`audit-toolbox-assets.mjs`) surface `serverIds`, `profileIds`, and per-server Docker apply metadata; catalog peers can map policy ids to live catalog ids, descriptor-only peers block live apply, and profileless `docker mcp gateway run --servers` fallback commands are emitted for catalog-mode peer subsets only
- client overlays declare `handoffStrategy` and `handoffPresetRef`; activation returns structured reconnect handoff data
- category-owned peer curation: `runtime-observe`, `core-dev+runtime-observe` (via base-profile inheritance), `runtime-admin`, and `full` include the `kubernetes-read` peer band for read-only Kubernetes observation (`k8s-read`, `k8s-logs-read`, `k8s-events-read`); `docs-research`, `core-dev+docs-research` (via base-profile inheritance), and `full` include the `dockerhub-read` peer band for read-only container registry access (`container-registry-read`) and the `deepwiki-read` peer band for generated repository documentation and Q&A (`repo-knowledge-read`); `security-audit`, `core-dev+security-audit` (via base-profile inheritance), and `full` include the `semgrep-audit` peer band for read-only security scanning and static analysis (`security-scan-read`)

## Partial Or Incomplete Areas

These areas have enabling structure but are not fully complete:

- richer temporal-validity governance beyond validity windows, refresh-candidate reporting, bounded batch refresh-draft creation, idempotent refresh-draft reuse, explicit refresh-draft creation, freshness warnings, and stale ranking
- hierarchical retrieval rollout beyond the current `flat` default, explicit opt-in strategy selection, trace metadata, packet-diff checks, and the documented rollback path back to `flat`
- broader toolbox rollout beyond the current curated peer bands (docs-research, runtime-observe, runtime-admin, security-audit, full); `dockerhub-read` (`container-registry-read`), `deepwiki-read` (`repo-knowledge-read`), and `semgrep-audit` (`security-scan-read`) are now live in their bounded profiles; additional peer servers require their own category, server, and profile manifests plus test coverage
- target-machine Docker Toolkit validation: `docker mcp profile` subcommand is not available in the current Docker MCP Toolkit build; diagnostic gateway fallback commands are available for catalog-mode peer subsets, but complete live apply is blocked while selected profiles contain descriptor-only peers that need read-filtered wrappers or vetted catalog entries
- future approval-gated Kubernetes mutation: no Kubernetes write or deployment tool is in v1; the workstream is blocked pending a separate governance decision

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
# Status note

This file is a historical implementation snapshot. For the current runtime, use `README.md`, `documentation/architecture/overview.md`, `documentation/reference/interfaces.md`, and `documentation/reference/repo-map.md`.
