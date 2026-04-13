# Interfaces

This document lists the externally reachable interfaces that are implemented in tracked code.

## HTTP API

Source of truth: `apps/brain-api/src/server.ts`

### Health and system

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health/live` | liveness and degraded-state health |
| `GET` | `/health/ready` | readiness health |
| `GET` | `/v1/system/auth` | auth registry summary plus issued-token summary |
| `GET` | `/v1/system/auth/issued-tokens` | issued-token listing |
| `POST` | `/v1/system/auth/issue-token` | centrally issue actor tokens |
| `POST` | `/v1/system/auth/introspect-token` | inspect token validity and authorization |
| `POST` | `/v1/system/auth/revoke-token` | revoke issued tokens |
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

## CLI

Source of truth: `apps/brain-cli/src/main.ts`

### Commands

- `version`
- `auth-status`
- `auth-issued-tokens`
- `auth-introspect-token`
- `freshness-status`
- `issue-auth-token`
- `revoke-auth-token`
- `execute-coding-task`
- `list-agent-traces`
- `show-tool-output`
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
- `auth-status`

Commands with optional payload:

- `auth-issued-tokens`
- `freshness-status`
- `create-refresh-drafts`

From the workspace root, the verified invocation form is `corepack pnpm cli -- <command>`.

## MCP

Source of truth:

- `apps/brain-mcp/src/tool-definitions.ts`
- `apps/brain-mcp/src/main.ts`

### Implemented methods

- `initialize`
- `tools/list`
- `tools/call`

### Implemented tools

- `execute_coding_task`
- `list_agent_traces`
- `show_tool_output`
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
- `fetch_decision_summary`
- `validate_note`
- `promote_note`
- `query_history`
- `create_session_archive`

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
