# Planning documents

The files in this directory are planning, rollout, RFC, and historical implementation notes.

Use them for background context, not as the primary source of truth for current runtime behavior.

For current behavior, prefer:

- `README.md`
- `docs/setup/*.md`
- `docs/architecture/*.md`
- `docs/operations/*.md`
- `docs/reference/*.md`
- `docs/agents/ai-navigation-guide.md`

## Why this warning exists

Several files in this directory describe future work or older rollout assumptions that no longer match the tracked code exactly. Examples found during the documentation discovery pass:

- `docs/planning/mcp-tool-map.md` still describes the MCP adapter as future work, but `apps/brain-mcp` is implemented
- `docs/planning/current-implementation.md` omits currently implemented namespace, import, and session-archive surfaces
- `docs/planning/implementation-plan.md` describes rollout phases that are no longer the best guide to the current runtime

## Evidence status

### Verified facts

- The warnings above are based on tracked code and tracked planning files in this repository

### Assumptions

- None

### TODO gaps

- If a planning document remains useful as an enduring reference, either move it into the canonical docs tree or rewrite it so it no longer reads like current-state documentation
