# Contributor Beta Readiness

> **Status note (2026-04-27):** This document still describes the broader
> contributor-beta stance correctly, but the current MCP story now includes
> `mimir-control` and the dynamic `mimir-toolbox-mcp` broker in addition to the
> thin core MCP adapter. Use
> [`../operations/docker-toolbox-v1.md`](../operations/docker-toolbox-v1.md) and
> [`../reference/interfaces.md`](../reference/interfaces.md),
> [`../planning/current-implementation.md`](../planning/current-implementation.md),
> and [`../planning/backlog.md`](../planning/backlog.md) for the live surface
> inventory and toolbox rollout details. Treat the matrix below as beta framing,
> not the authoritative command/tool list.

This document defines the recommended beta bar when mimir is being shared with
programmer contributors rather than end users.

The goal is not to force one narrow connection path. The goal is to support
many connection paths while keeping one strict governed core.

## Beta stance

Treat this beta as:

- a contributor beta for a platform
- open at the transport and integration edges
- strict at the memory, review, auth, and promotion boundary

This means the beta should optimize for:

- many ways to connect
- clear extension seams
- aggressive contract testing
- recoverability when contributors experiment
- explicit boundaries around governed writes

It should not be framed as a polished end-user product release yet.

## Core principle

Use this operating model:

- many ways in
- one governed write boundary
- explicit extension tiers
- transport and contract tests as the main safety net

The strict center remains:

- `packages/contracts/src/orchestration/command-catalog.ts`
- `packages/orchestration/src/root/actor-authorization-policy.ts`
- `packages/orchestration/src/root/command-authorization-matrix.ts`
- `packages/infrastructure/src/transport/request-validation.ts`
- `packages/application/src/services/*` for validation, promotion, import, and history

Contributors may extend around that center. They should not bypass it.

## Open Surfaces At This Beta Checkpoint

The current repository already exposes multiple connection paths:

- CLI through `apps/mimir-cli`
- HTTP through `apps/mimir-api`
- stdio MCP through `apps/mimir-mcp`
- toolbox control MCP through `apps/mimir-control-mcp`
- dynamic toolbox broker MCP through `apps/mimir-toolbox-mcp`
- Docker MCP session through `docker/mimir-mcp.Dockerfile` and `docker/compose.mcp-session.yml`
- launcher installation and doctor helpers through `scripts/*`
- Docker AI tool discovery and validation through `docker/tool-registry/*.json`
- external source adapters through `packages/contracts/src/external-sources/*` and `packages/infrastructure/src/external-sources/*`

That is enough to support a contributor beta, provided the supported boundaries
are documented and tested.

## Transport capability matrix

This matrix is the minimum contributor-facing truth to publish before beta.

| Surface | CLI | HTTP | MCP | Notes |
| --- | --- | --- | --- | --- |
| Search/context read | yes | yes | yes | `search-context`, `assemble-agent-context`, tree/node/packet/decision-summary |
| Session archive create/search | yes | yes | yes | creation and search now exist in CLI, HTTP, and MCP; use `documentation/reference/interfaces.md` for exact route/tool names |
| Draft creation | yes | yes | yes | governed durable write proposal |
| Refresh draft creation | yes | yes | yes | single and batch flows |
| Validate/promote | yes | yes | yes | governed write path remains centralized |
| Review queue/read/accept/reject | yes | yes | yes | thin review frontends now share one governed review path across transports |
| Tool registry discovery/validation/package-plan | yes | yes | yes | read-only Docker AI tool surfaces |
| Coding execute | yes | yes | yes | same governed runtime, different task family |
| Coding traces/tool output | yes | yes | yes | operational inspection surfaces |
| Import jobs | yes | yes | yes | import recording, not direct canonical write |

Do not describe transport parity as broader than it is. Review operations now
have CLI, HTTP, and MCP parity, but they still remain thin frontends over the
same governed staging and promotion flow.

If this summary drifts, `documentation/reference/interfaces.md` wins.

## Extension tiers

Use three extension tiers so contributors know what is stable and what is still
moving.

### Tier 1: supported connection surfaces

- CLI commands
- HTTP routes
- MCP tools
- launcher installation and `mimir doctor --json`
- Docker MCP session profile

These should be treated as supported beta entrypoints.

### Tier 2: supported extension seams

- Docker AI tool manifests under `docker/tool-registry/*.json`
- provider configuration and provider factory registry
- external source adapters and registry wiring
- actor registry and token issuance configuration

These are intended extension seams, but contributors should stay within the
contract shapes and policy boundaries already enforced in code.

### Tier 3: experimental contributor space

- alternative agents
- alternate client wrappers
- project-specific prompts and workflows
- higher-level integrations built on top of CLI/HTTP/MCP

These are allowed, but they should be clearly marked experimental and should not
redefine the governed core.

## Beta gates

Before inviting contributor beta users, verify these gates.

### 1. Contract freeze for the beta window

For the beta window, avoid breaking changes to:

- command catalog names
- HTTP route names
- MCP tool names
- tool-manifest schema shape
- external-source contract shape
- actor/token auth behavior without an explicit migration note

If a breaking change is unavoidable, document it in release notes and migration
notes before shipping the beta update.

### 2. Connection-path verification

At minimum, verify:

```bash
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm docker:mcp:build
corepack pnpm cli -- version
corepack pnpm cli -- list-ai-tools
corepack pnpm cli -- list-review-queue
```

Also verify:

- HTTP health endpoints respond
- MCP starts and lists tools
- HTTP review routes respond on `/v1/review/queue`, `/v1/review/note`,
  `/v1/review/accept`, and `/v1/review/reject`
- MCP lists and executes `list_review_queue`, `read_review_note`,
  `accept_note`, and `reject_note`
- `mimir doctor --json` reports a usable state

### 3. Strict governed write boundary

Before beta, confirm there is no supported path that allows contributors to:

- write canonical notes directly
- bypass draft validation
- bypass actor authorization
- bypass promotion and audit through direct file mutation

Important current boundaries:

- external personal-note sources are read-only
- Docker AI tools do not get direct mimisbrunnr mounts
- durable memory writes still go through governed commands such as `draft-note`,
  `validate-note`, `promote-note`, and `create-session-archive`

### 4. Extension examples exist

Before beta, provide at least one known-good example for:

- CLI invocation
- HTTP invocation
- MCP client wiring
- Docker AI tool manifest
- actor/token configuration
- external source adapter registration

Contributors should not need to reverse-engineer the repo from tests alone.

### 5. Backup and restore

Before beta, test:

- backup of `MAB_DATA_ROOT` or the derived canonical/staging/state roots
- restore into a fresh location
- startup and read/query behavior after restore

An open contributor beta without a tested restore path invites avoidable data loss.

### 6. Observability and support

Before beta, ensure contributors can answer:

- what transport failed
- whether auth rejected the request
- whether validation rejected the payload
- whether Qdrant is degraded
- whether tool manifests are invalid
- whether the model/runtime dependency is unavailable

`mimir doctor --json`, health routes, CLI error output, and testable transport
validation should be the baseline support surfaces.

## What should remain rigid during beta

These should stay strict even while the project is otherwise open:

- canonical memory authority
- review and promotion semantics
- actor authorization policy
- transport validation behavior
- audit/history guarantees
- read-only external-source boundaries

Contributors should be able to build around the core without weakening it.

## What can stay flexible during beta

These can remain open to contributor experimentation:

- client wrappers
- alternate launchers
- MCP client configuration
- Docker tool profiles
- provider choices
- prompt shapes and local workflows
- external integrations built on top of the supported surfaces

## Recommended documentation pack for beta users

At minimum, point contributors to:

- `README.md`
- `documentation/setup/installation.md`
- `documentation/setup/configuration.md`
- `documentation/operations/running.md`
- `documentation/reference/interfaces.md`
- `documentation/reference/repo-map.md`
- `documentation/architecture/invariants-and-boundaries.md`
- `documentation/release/RELEASE_NOTES.md`
- `documentation/release/v1.0.1-release-checklist.md`
- this file

## Beta issue taxonomy

Ask contributors to file issues under one of these buckets:

- install/bootstrap
- transport parity
- auth/governance
- retrieval quality
- Docker tool registry
- external source adapters
- coding runtime
- docs/examples
- backup/restore

This keeps beta feedback usable instead of collapsing into one generic bug list.

## Release recommendation

The repository is ready for a contributor beta when:

- the clean-clone release checks pass
- many connection paths are documented honestly
- the governed write boundary is still strict
- extension seams are named explicitly
- backup/restore has been tested
- contributors have example configurations to copy

Do not wait for a single-path end-user installer if the real goal is an open,
multi-transport contributor beta.

## Evidence status

### Verified facts

- transport surfaces come from `documentation/reference/interfaces.md`,
  `apps/mimir-cli/src/main.ts`, `apps/mimir-api/src/server.ts`, and
  `apps/mimir-mcp/src/tool-definitions.ts`
- governed boundaries come from
  `documentation/architecture/invariants-and-boundaries.md`,
  `packages/contracts/src/orchestration/command-catalog.ts`, and the current
  transport validation/auth policy wiring
- extension seams are grounded in `docker/tool-registry/*.json`,
  `packages/infrastructure/src/tools/*`, and
  `packages/infrastructure/src/external-sources/*`

### Assumptions

- contributor beta users are technical and comfortable with multiple entrypoints
- the beta should prioritize openness and extensibility over a single curated UX

### TODO gaps

- if review operations gain HTTP or MCP parity, update the transport matrix
- if public plugin/adapter templates are added, link them from the extension examples section
