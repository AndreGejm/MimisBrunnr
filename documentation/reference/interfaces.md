# Interfaces

This is the current external interface map for tracked code.

## HTTP API

Source of truth: `apps/mimir-api/src/server.ts`

### Health

| Method | Path |
| --- | --- |
| `GET` | `/health/live` |
| `GET` | `/health/ready` |

### System and auth

| Method | Path |
| --- | --- |
| `GET` | `/v1/system/auth` |
| `GET` | `/v1/system/auth/issuers` |
| `GET` | `/v1/system/auth/issued-tokens` |
| `POST` | `/v1/system/auth/issuer-state` |
| `POST` | `/v1/system/auth/issue-token` |
| `POST` | `/v1/system/auth/introspect-token` |
| `POST` | `/v1/system/auth/revoke-token` |
| `POST` | `/v1/system/auth/revoke-tokens` |
| `GET` | `/v1/system/freshness` |
| `GET` | `/v1/system/version` |

### Coding and tool packaging

| Method | Path |
| --- | --- |
| `POST` | `/v1/coding/execute` |
| `POST` | `/v1/coding/traces` |
| `POST` | `/v1/coding/tool-output` |
| `POST` | `/v1/tools/ai` |
| `POST` | `/v1/tools/ai/check` |
| `POST` | `/v1/tools/ai/package-plan` |

### Retrieval and context

| Method | Path |
| --- | --- |
| `POST` | `/v1/context/search` |
| `POST` | `/v1/context/agent-context` |
| `POST` | `/v1/context/tree` |
| `POST` | `/v1/context/node` |
| `POST` | `/v1/context/packet` |
| `POST` | `/v1/context/decision-summary` |

### Drafts, review, promotion, and history

| Method | Path |
| --- | --- |
| `POST` | `/v1/notes/drafts` |
| `POST` | `/v1/review/queue` |
| `POST` | `/v1/review/note` |
| `POST` | `/v1/review/accept` |
| `POST` | `/v1/review/reject` |
| `POST` | `/v1/system/freshness/refresh-draft` |
| `POST` | `/v1/system/freshness/refresh-drafts` |
| `POST` | `/v1/notes/validate` |
| `POST` | `/v1/notes/promote` |
| `POST` | `/v1/maintenance/import-resource` |
| `POST` | `/v1/history/query` |
| `POST` | `/v1/history/session-archives` |
| `POST` | `/v1/history/session-archives/search` |

## CLI

Source of truth: `apps/mimir-cli/src/main.ts`

### System and auth commands

- `version`
- `auth-issuers`
- `auth-status`
- `auth-issued-tokens`
- `auth-introspect-token`
- `issue-auth-token`
- `revoke-auth-token`
- `revoke-auth-tokens`
- `set-auth-issuer-state`
- `freshness-status`

### Toolbox authoring and sync commands

- `check-mcp-profiles`
- `list-toolbox-servers`
- `scaffold-toolbox`
- `scaffold-toolbox-band`
- `preview-toolbox`
- `sync-mcp-profiles`
- `sync-toolbox-runtime`
- `sync-toolbox-client`

### Toolbox session commands

- `list-toolboxes`
- `describe-toolbox`
- `request-toolbox-activation`
- `list-active-toolbox`
- `list-active-tools`
- `deactivate-toolbox`

### Coding and retrieval commands

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
- `query-history`
- `create-session-archive`

### Draft, review, and promotion commands

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

### Current CLI payload rules

Commands read JSON from one of:

- `--stdin`
- `--input <path>`
- `--json <payload>`

Current important command behavior:

- `sync-mcp-profiles --apply` is the Docker apply path
- `sync-toolbox-runtime --apply` writes the client artifact only
- `sync-toolbox-client --apply` writes the client artifact only
- `scaffold-toolbox --wizard` is supported only for `scaffold-toolbox`

### Rollout doctor surface

Source of truth:

- `scripts/lib/default-access.mjs`
- `scripts/doctor-default-access.mjs`

Current `toolboxRolloutReadiness` output includes:

- summary state
- governed, unsafe, and unmanaged live Docker MCP server lists
- blocked policy servers from the compiled Docker apply plan
- `remediationPlan.keepLiveServers`
- `remediationPlan.disableLiveServers`
- `remediationPlan.blockedPolicyServers`
- human-facing doctor lines for `toolboxKeep`, `toolboxDisable`, and
  `toolboxReplace`

## MCP

### Direct Mimir MCP adapter

Source of truth:

- `apps/mimir-mcp/src/main.ts`
- `apps/mimir-mcp/src/tool-definitions.ts`

Current transport behavior:

- stdio
- newline-delimited JSON messages
- `tools.listChanged = false`

Current implemented JSON-RPC methods:

- `initialize`
- `tools/list`
- `tools/call`

Current tool names:

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

The direct MCP adapter does not expose the HTTP auth-control routes and does not
expose the toolbox control tools.

### Toolbox control MCP adapter

Source of truth:

- `apps/mimir-control-mcp/src/main.ts`
- `apps/mimir-control-mcp/src/tool-definitions.ts`

Current transport behavior:

- stdio
- `Content-Length` framed JSON-RPC
- `tools.listChanged = false`

Current tools:

- `list_toolboxes`
- `describe_toolbox`
- `request_toolbox_activation`
- `list_active_toolbox`
- `list_active_tools`
- `deactivate_toolbox`

### Toolbox broker MCP adapter

Source of truth:

- `apps/mimir-toolbox-mcp/src/main.ts`
- `apps/mimir-toolbox-mcp/src/tool-definitions.ts`
- `apps/mimir-toolbox-mcp/src/session-state.ts`

Current transport behavior:

- stdio
- `Content-Length` framed JSON-RPC
- `tools.listChanged = true`
- `notifications/tools/list_changed`

The broker always keeps the same six toolbox control tools and changes the rest
of the visible tool surface based on the active compiled profile, client
overlay, and backend availability.

### Current toolbox session contract

Current session entry modes in toolbox policy:

- `legacy-direct`
- `toolbox-bootstrap`
- `toolbox-activated`

Current runtime binding kinds in toolbox policy:

- `docker-catalog`
- `descriptor-only`
- `local-stdio`

Current reconnect handoff env keys:

- `MAB_TOOLBOX_ACTIVE_PROFILE`
- `MAB_TOOLBOX_CLIENT_ID`
- `MAB_TOOLBOX_SESSION_MODE`
- `MAB_TOOLBOX_SESSION_POLICY_TOKEN`

Lease issuance depends on `MAB_TOOLBOX_LEASE_ISSUER_SECRET`.
