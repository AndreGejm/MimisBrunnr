# Interfaces

This document lists the externally reachable interfaces that are implemented in tracked code.

## HTTP API

Source of truth: `apps/mimir-api/src/server.ts`

### Health and system

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health/live` | liveness and degraded-state health |
| `GET` | `/health/ready` | readiness health |
| `GET` | `/v1/system/auth` | auth registry summary plus issued-token summary |
| `GET` | `/v1/system/auth/issuers` | effective central auth-issuer lifecycle state for registered issuers |
| `GET` | `/v1/system/auth/issued-tokens` | issued-token listing |
| `POST` | `/v1/system/auth/issuer-state` | update central auth-issuer lifecycle state for one issuer |
| `POST` | `/v1/system/auth/issue-token` | centrally issue actor tokens |
| `POST` | `/v1/system/auth/introspect-token` | inspect token validity and authorization |
| `POST` | `/v1/system/auth/revoke-token` | revoke issued tokens |
| `POST` | `/v1/system/auth/revoke-tokens` | bounded bulk revocation of issued tokens |
| `GET` | `/v1/system/freshness` | temporal validity report |
| `GET` | `/v1/system/version` | release metadata |

### Retrieval and context

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/context/search` | bounded retrieval |
| `POST` | `/v1/context/agent-context` | fenced local-agent context assembly |
| `POST` | `/v1/context/tree` | namespace tree listing |
| `POST` | `/v1/context/node` | namespace node read |
| `POST` | `/v1/context/packet` | direct context-packet assembly |
| `POST` | `/v1/context/decision-summary` | decision-focused packet |

### Memory and governance

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/notes/drafts` | create staging drafts |
| `POST` | `/v1/review/queue` | list reviewable staging drafts |
| `POST` | `/v1/review/note` | read one staging draft for review |
| `POST` | `/v1/review/accept` | accept and promote one staging draft |
| `POST` | `/v1/review/reject` | reject one staging draft |
| `POST` | `/v1/system/freshness/refresh-draft` | create one governed refresh draft |
| `POST` | `/v1/system/freshness/refresh-drafts` | create a bounded refresh-draft batch |
| `POST` | `/v1/notes/validate` | deterministic validation |
| `POST` | `/v1/notes/promote` | promote a staging draft |
| `POST` | `/v1/maintenance/import-resource` | record an import job |
| `POST` | `/v1/history/query` | bounded audit history query |
| `POST` | `/v1/history/session-archives` | create session archives |
| `POST` | `/v1/history/session-archives/search` | search non-authoritative session archives |

### Coding

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/coding/execute` | execute a coding-domain task through the Python bridge |
| `POST` | `/v1/coding/traces` | list compact operational traces for one local-agent request |
| `POST` | `/v1/coding/tool-output` | read a full spilled local-agent tool output by output id |
| `POST` | `/v1/tools/ai` | list read-only Docker AI tool manifests without executing tools |
| `POST` | `/v1/tools/ai/check` | validate Docker AI tool manifests without executing tools |
| `POST` | `/v1/tools/ai/package-plan` | build reusable Docker package plans without executing tools |

## CLI

Source of truth: `apps/mimir-cli/src/main.ts`

### Commands

- `version`
- `auth-issuers`
- `auth-status`
- `auth-issued-tokens`
- `auth-introspect-token`
- `check-mcp-profiles`
- `freshness-status`
- `issue-auth-token`
- `revoke-auth-tokens`
- `set-auth-issuer-state`
- `list-active-toolbox`
- `list-active-tools`
- `list-toolboxes`
- `describe-toolbox`
- `deactivate-toolbox`
- `revoke-auth-token`
- `request-toolbox-activation`
- `sync-mcp-profiles`
- `execute-coding-task`
- `list-agent-traces`
- `show-tool-output`
- `list-ai-tools`
- `check-ai-tools`
- `tools-package-plan`
- `search-context`
- `search-session-archives`
- `assemble-agent-context`
- `list-context-tree`
- `read-context-node`
- `get-context-packet`
- `fetch-decision-summary`
- `draft-note`
- `create-refresh-draft`
- `create-refresh-drafts`
- `validate-note`
- `promote-note`
- `list-review-queue`
- `read-review-note`
- `accept-note`
- `reject-note`
- `import-resource`
- `query-history`
- `create-session-archive`

### Payload sources

Commands read JSON from exactly one of:

- `--stdin`
- `--input <path>`
- `--json <payload>`

Commands with no required payload:

- `version`
- `auth-status` with the caveat that enforced auth mode still requires operator or system actor context in the payload

Commands with optional payload:

- `auth-issuers`
- `auth-issued-tokens`
- `check-mcp-profiles`
- `freshness-status`
- `list-ai-tools`
- `list-active-toolbox`
- `list-active-tools`
- `list-toolboxes`
- `check-ai-tools`
- `sync-mcp-profiles`
- `tools-package-plan`
- `list-review-queue`
- `create-refresh-drafts`

From the workspace root, the verified invocation form is `corepack pnpm cli -- <command>`.

For CLI auth-control commands in enforced mode, pass an `actor` object with operator or system credentials in the JSON payload. That applies to `auth-issuers`, `auth-status`, `auth-issued-tokens`, `auth-introspect-token`, `issue-auth-token`, `revoke-auth-token`, `revoke-auth-tokens`, and `set-auth-issuer-state`.

`auth-issued-tokens` and `GET /v1/system/auth/issued-tokens` return operator-attribution fields for token lifecycle operations. Active or future records can include `issuedByActorId`, `issuedByActorRole`, `issuedBySource`, and `issuedByTransport`. Revoked records can also include `revokedByActorId`, `revokedByActorRole`, `revokedBySource`, and `revokedByTransport` alongside `revokedAt` and `revokedReason`.

Token issuance and revocation also emit queryable audit-history events. `issue-auth-token` / `POST /v1/system/auth/issue-token` write `issue_auth_token` entries, and `revoke-auth-token` / `POST /v1/system/auth/revoke-token` write `revoke_auth_token` entries. Those audit entries store the token id, target actor metadata, lifecycle-policy booleans, and revocation reason where applicable; they do not store the raw issued token.

`query-history` / `POST /v1/history/query` can filter audit history before the bounded `limit` is applied. Supported request fields are:

- `actorId`
- `actionType`
- `source`
- `noteId`
- `since`
- `until`
- `limit`

Toolbox control commands are implemented through the shared control surface. The current commands are:

- `check-mcp-profiles`
- `sync-mcp-profiles`
- `list-toolboxes`
- `describe-toolbox`
- `request-toolbox-activation`
- `list-active-toolbox`
- `list-active-tools`
- `deactivate-toolbox`

`list-active-tools` now returns three explicit buckets in addition to the compatibility `tools` alias:

- `declaredTools`: tools declared by the active compiled profile before overlay suppression
- `activeTools`: tools currently exposed to the session after overlay suppression
- `suppressedTools`: declared tools hidden by overlay rules, including `suppressionReasons`

For sessions using `runtime-observe`, `core-dev+runtime-observe`, `runtime-admin`, or `full`, the active tool surface may include Kubernetes read-only descriptors from the `kubernetes-read` peer server. The current Kubernetes tool ids are:

- `kubernetes.context.inspect`
- `kubernetes.namespaces.list`
- `kubernetes.workloads.list`
- `kubernetes.pods.list`
- `kubernetes.events.list`
- `kubernetes.logs.query`

All six are `mutationLevel: read`. There is no Kubernetes mutation tool in v1.

Issued-token listing filters are implemented end to end across CLI and HTTP. The supported request fields are:

- `actorId`
- `issuedByActorId`
- `revokedByActorId`
- `lifecycleStatus` with `active`, `future`, `expired`, or `revoked`
- `asOf`
- `includeRevoked`
- `limit`

The issued-token summary returned alongside a filtered listing applies the same filters except for `limit`.

Issuer lifecycle control is implemented end to end across CLI and HTTP:

- `auth-issuers` and `GET /v1/system/auth/issuers` return `asOf`, a lifecycle `summary`, and per-issuer records.
- Each issuer record includes registry lifecycle state, effective lifecycle state, registry capability booleans, effective issue and revoke booleans, enablement, optional `validFrom` and `validUntil`, and last update attribution fields.
- `set-auth-issuer-state` and `POST /v1/system/auth/issuer-state` accept `actorId`, `enabled`, `allowIssueAuthToken`, `allowRevokeAuthToken`, and optional `validFrom`, `validUntil`, and `reason`.
- Central issuer controls can narrow, disable, or time-bound a registered issuer, but they cannot widen an actor beyond the registry’s allowed admin actions.

## MCP

Source of truth:

- `apps/mimir-mcp/src/tool-definitions.ts`
- `apps/mimir-mcp/src/main.ts`
- `apps/mimir-control-mcp/src/tool-definitions.ts`
- `apps/mimir-control-mcp/src/main.ts`

### Implemented methods

- `initialize`
- `tools/list`
- `tools/call`

### Implemented tools

- `execute_coding_task`
- `list_agent_traces`
- `show_tool_output`
- `list_ai_tools`
- `check_ai_tools`
- `tools_package_plan`
- `search_context`
- `search_session_archives`
- `assemble_agent_context`
- `list_context_tree`
- `read_context_node`
- `get_context_packet`
- `create_refresh_draft`
- `create_refresh_drafts`
- `import_resource`
- `draft_note`
- `list_review_queue`
- `read_review_note`
- `accept_note`
- `reject_note`
- `fetch_decision_summary`
- `validate_note`
- `promote_note`
- `query_history`
- `create_session_archive`

### Toolbox control MCP tools

- `list_toolboxes`
- `describe_toolbox`
- `request_toolbox_activation`
- `list_active_toolbox`
- `list_active_tools`
- `deactivate_toolbox`

## Internal integration surfaces

### Filesystem

- canonical note repository
- staging note repository

### SQLite

- metadata control store
- audit log
- issued token store
- revocation store
- import job store
- session archive store
- context namespace store
- context representation store
- lexical FTS index
- local agent trace store
- tool output spillover store plus `state/tool-output` payload files

### External services

- Qdrant over HTTP
- Docker/Ollama-compatible model endpoint(s) over HTTP
- optional paid OpenAI-compatible endpoint over HTTP

### Docker AI tool registry

- read-only manifest discovery and validation from `docker/tool-registry/*.json` through `FileSystemToolRegistry`
- `list-ai-tools`, `/v1/tools/ai`, and MCP `list_ai_tools` accept optional `ids`, `includeEnvironment`, and `includeRuntime` request fields
- `includeRuntime: true` adds reusable Docker runtime descriptors for compose files, profile/service names, container image/entrypoint/working directory, workspace/cache mount contracts, Mimisbrunnr mount policy, and expected environment keys
- `check-ai-tools`, `/v1/tools/ai/check`, and MCP `check_ai_tools` validate manifests without starting containers
- `tools-package-plan`, `/v1/tools/ai/package-plan`, and MCP `tools_package_plan` return installer-facing compose run plans, build recipe status, mount contracts, and packaging caveats without starting containers
- `mimir doctor --json` reports installer-facing `dockerTools` status, invalid manifest count, per-file manifest errors, and compact valid-tool package summaries
- no generic tool execution gateway is exposed by the current interfaces

### Local subprocess boundary
- Python subprocess launched by `PythonCodingControllerBridge`

## Known interface consistency risks

- `packages/contracts/src/retrieval/glob-context.contract.ts` and `packages/contracts/src/retrieval/grep-context.contract.ts` exist, but the tracked transport adapters do not expose matching runtime commands or routes

## What is not present

- no tracked webhook receiver
- no tracked queue consumer or producer
- no tracked socket server
- no tracked REST deployment API beyond the local HTTP adapter

## Evidence status

### Verified facts

- Every interface listed here is grounded in tracked adapter code or tracked contracts

### Assumptions

- None

### TODO gaps

- If the retrieval-only contract placeholders become live transport surfaces, update this file and the adapter docs together
