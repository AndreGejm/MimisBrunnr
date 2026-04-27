# External client boundary

This document defines the current supported boundary between Mimir and external
clients such as Codex or Claude.

## Ownership split

### Mimir owns

- durable memory in mimisbrunnr
- retrieval and context assembly
- governed note mutation and review
- local execution
- toolbox policy, activation, and client overlays
- bounded paid helper roles implemented in this repo

### External clients own

- skills
- subagents
- workspace skill roots
- client-local expert bundles
- client-local paid-agent orchestration quality

That split is current code and packaging structure, not just guidance.

## Current supported entrypoints

Use Mimir through one of these surfaces:

- direct MCP when the client wants the stable Mimir command catalog
- control MCP when the client needs toolbox discovery or reconnect handoff
- toolbox broker MCP when the client wants one stable constrained session that
  can expand or contract
- CLI or HTTP for operator and process-local workflows

## What belongs in Mimir

Use Mimir for these current categories of work:

### Retrieval and context

- `search_context`
- `search_session_archives`
- `assemble_agent_context`
- `list_context_tree`
- `read_context_node`
- `get_context_packet`
- `fetch_decision_summary`
- `query_history`
- `create_session_archive`

### Governed memory mutation

- `draft_note`
- `list_review_queue`
- `read_review_note`
- `accept_note`
- `reject_note`
- `create_refresh_draft`
- `create_refresh_drafts`
- `validate_note`
- `promote_note`
- `import_resource`

### Local execution

- `execute_coding_task`
- `list_agent_traces`
- `show_tool_output`
- `list_ai_tools`
- `check_ai_tools`
- `tools_package_plan`

### Toolbox control

- `list_toolboxes`
- `describe_toolbox`
- `request_toolbox_activation`
- `list_active_toolbox`
- `list_active_tools`
- `deactivate_toolbox`

## What does not belong in Mimir

Do not route these through Mimir:

- VoltAgent `Workspace`
- `workspace_*` skill tools
- skill search, activation, or prompt injection
- client-side subagent orchestration
- generic client UX policy or prompt policy
- expert-skill bundle management

Those remain the external client's responsibility.

## Current VoltAgent-specific boundary

The current repo exposes `voltagent-docs` as an optional local-stdio docs peer.

What it is:

- a development-time docs lookup server
- materialized for Codex through `.mimir/toolbox/codex.mcp.json`

What it is not:

- a general VoltAgent Workspace bridge
- a skill runtime
- a subagent host

The only Mimir-owned paid VoltAgent roles today are:

- `paid_escalation`
- `coding_advisory`

## Decision rule for new client-facing work

A new client-facing feature belongs in Mimir only if all of these stay true:

1. Mimir remains the authority for memory, retrieval, or governed local
   execution.
2. The feature does not make Mimir the owner of client skills or subagents.
3. The contract remains provider-agnostic at the Mimir boundary.
4. The feature fits either the stable command catalog or the toolbox policy
   model already present in this repo.

If those fail, the feature belongs in the external client integration instead.
