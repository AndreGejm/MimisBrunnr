# brain-mcp

Thin MCP stdio adapter over the existing application services.

## Implemented Methods

- `initialize`
- `tools/list`
- `tools/call`

## Implemented Tools

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

## Run

```bash
pnpm mcp
```

The adapter is intentionally thin:

- actor metadata is injected at the transport edge
- `initialize` reports the shared runtime release version
- tool handlers delegate directly to the orchestrator and existing services
- tool output remains bounded and JSON-shaped
