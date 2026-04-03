# brain-mcp

Thin MCP stdio adapter over the existing application services.

## Implemented Methods

- `initialize`
- `tools/list`
- `tools/call`

## Implemented Tools

- `search_context`
- `draft_note`
- `validate_note`
- `promote_note`
- `query_history`

## Run

```bash
pnpm mcp
```

The adapter is intentionally thin:

- actor metadata is injected at the transport edge
- tool handlers delegate directly to existing services
- tool output remains bounded and JSON-shaped
