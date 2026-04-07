# brain-mcp

stdio MCP adapter over the shared runtime container.

## Entrypoints

- `apps/brain-mcp/src/main.ts`
- `apps/brain-mcp/src/tool-definitions.ts`

## Implemented methods

- `initialize`
- `tools/list`
- `tools/call`

## Implemented tools

- `execute_coding_task`
- `search_context`
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

## Behavior

- uses Content-Length framed JSON-RPC over stdio
- validates tool arguments through shared transport validation
- injects MCP-scoped actor defaults
- delegates into the shared orchestrator or shared services

## Run

```bash
pnpm mcp
```

## Canonical docs

- `docs/reference/interfaces.md`
- `docs/agents/ai-navigation-guide.md`

## Evidence status

### Verified facts

- This README is based on `apps/brain-mcp/src/main.ts` and `apps/brain-mcp/src/tool-definitions.ts`

### Assumptions

- None

### TODO gaps

- If tool definitions and contract exports are reconciled, update this README to match
