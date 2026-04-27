# Current Implementation

This document is the current-state snapshot for the tracked repo.

## Snapshot

As of `2026-04-27`, the repo contains:

- one shared runtime container assembled in
  `packages/infrastructure/src/bootstrap/build-service-container.ts`
- five first-party Node adapters:
  - `mimir-api`
  - `mimir-cli`
  - `mimir-mcp`
  - `mimir-control-mcp`
  - `mimir-toolbox-mcp`
- one vendored Python coding runtime under `runtimes/local_experts`
- one checked-in toolbox policy tree under `docker/mcp`
- one installer-managed external client subtree under
  `vendor/codex-claude-voltagent-client`

## Implemented runtime capabilities

### Core memory and storage

Implemented today:

- canonical Markdown notes on disk
- staging drafts on disk
- SQLite-backed metadata, audit, issued-token, revocation, import, session
  archive, namespace, representation, local-agent-trace, and tool-output stores
- SQLite FTS lexical retrieval
- Qdrant vector retrieval
- current-state freshness windows via `validFrom` and `validUntil`
- refresh-candidate reporting and governed refresh-draft creation
- bounded review and promotion flow with deterministic validation and audit

### Retrieval and context assembly

Implemented today:

- `flat` retrieval as the baseline path
- `hierarchical` retrieval behind explicit strategy selection
- context packet assembly with hard budgets
- fenced agent-context assembly
- namespace listing and node reads
- decision-summary packets
- retrieval traces and packet-diff support for rollout review

### Auth and governance

Implemented today:

- actor-registry-backed authn and authz across CLI, HTTP, and MCP
- issued-token creation, introspection, revocation, and lifecycle storage
- issuer-level enablement and time-bounded overrides
- bounded audit-history queries
- toolbox session leases with expiry and verification

### Coding and tool execution

Implemented today:

- vendored Python coding runtime invoked through the orchestration layer
- bounded coding task execution
- local-agent trace storage
- spilled tool-output lookup
- read-only Docker AI tool registry discovery, validation, and package planning

## Implemented toolbox runtime

The toolbox runtime is no longer just a reconnect plan. It has three live
layers:

1. checked-in policy under `docker/mcp`
2. compatibility discovery and reconnect through `mimir-control`
3. dynamic same-session brokering through `mimir-toolbox-mcp`

### Current authored policy inventory

- bands:
  `bootstrap`, `core-dev`, `delivery-admin`, `docs-research`, `full`,
  `heavy-rag`, `runtime-admin`, `runtime-observe`, `security-audit`,
  `voltagent-docs`
- workflows:
  `core-dev+docs-research`, `core-dev+runtime-observe`,
  `core-dev+security-audit`, `core-dev+voltagent-dev`,
  `core-dev+voltagent-docs`
- checked-in base profiles:
  `bootstrap`, `core-dev`, `delivery-admin`, `docs-research`, `full`,
  `heavy-rag`, `runtime-admin`, `runtime-observe`, `security-audit`
- compiled workflow-backed profile ids:
  `core-dev+docs-research`, `core-dev+runtime-observe`,
  `core-dev+security-audit`, `core-dev+voltagent-dev`,
  `core-dev+voltagent-docs`
- client overlays:
  `codex`, `claude`, `antigravity`

### Current runtime binding classes

- owned in-process servers:
  `mimir-control`, `mimir-core`
- docker-catalog peers:
  `brave-search`, `deepwiki-read`, `docker-docs`, `microsoft-learn`,
  `semgrep-audit`
- descriptor-only peers:
  `docker-admin`, `docker-read`, `dockerhub-read`, `github-read`,
  `github-write`, `grafana-observe`, `kubernetes-read`
- local-stdio client-materialized peer:
  `voltagent-docs`

### Current broker behavior

Implemented today:

- bootstrap session starts with stable control tools plus read-only core memory
  tools
- same-session activation and deactivation
- low-risk auto-expansion from `bootstrap`
- `notifications/tools/list_changed`
- idle-timeout contraction
- lease-expiry contraction
- in-process owned tools
- local-stdio peer routing
- opt-in Docker gateway routing for docker-catalog peers

Not implemented yet:

- descriptor-only peer routing inside the broker
- full target-client rollout validation across non-local environments

## Implemented external-client boundary

The repo now treats external clients as peers, not as ownership sinks.

Implemented boundary rules:

- Mimir owns durable memory, retrieval, governed writes, local execution, and
  bounded paid helper roles
- external clients keep ownership of skills, subagents, workspace skill roots,
  and client-local paid-agent quality
- `voltagent-docs` is only a docs peer; it is not the path for routing general
  VoltAgent skill behavior through Mimir
- Codex materialization currently emits only `voltagent-docs` into
  `.mimir/toolbox/codex.mcp.json` when the selected profile includes that peer

## Current rollout blockers

The main remaining blockers are operational, not foundational.

### Docker toolbox rollout

Current blockers:

- the current Docker MCP toolkit build does not expose `docker mcp profile`
- Docker gateway help does not expose `--profile`
- descriptor-only peers still lack safe catalog entries or wrappers
- live Docker-enabled servers can drift from the repo-governed policy

Current doctor-level blocker names on this machine:

- `docker_mcp_governance_drift`
- `docker_mcp_apply_blocked`

### Read-path rollout

Still partial:

- broader temporal-validity governance beyond the current refresh-draft and
  warning flow
- stronger authority-state and namespace enforcement follow-through
- default rollout of hierarchical retrieval; it remains opt-in

### Broker rollout

Still partial:

- broader peer/backend parity inside the dynamic broker
- broader target-client validation beyond the current local Codex-oriented path

## Intentionally out of the current stack

These are still outside the shipped baseline:

- webhook or SSE transport
- queue worker or scheduler process
- dashboard UI
- entity graph
- generic client-skill orchestration through Mimir
- Kubernetes mutation tooling

See `documentation/planning/backlog.md` for the remaining active backlog and
`documentation/planning/go-live-gates.md` for rollout gating.
