# External client boundary

This document defines the supported boundary for external agent clients such as
Codex or Claude when they use Mimir together with VoltAgent.

## Ownership

### Mimir owns

- durable memory in mimisbrunnr
- retrieval and context assembly
- local-model execution
- local-agent execution
- governed memory writes and review flows
- bounded paid helper roles implemented inside this repo

### External clients own

- skills
- subagents
- workspace skill roots
- expert-skill bundles
- client-local paid-agent orchestration quality

External clients may use VoltAgent directly for those concerns. They should not
route them through Mimir.

## What to call Mimir for

The runtime command catalog currently exposes these relevant surfaces.

### Retrieval and context

Use Mimir for bounded retrieval and context packet assembly:

- `search_context`
- `search_session_archives`
- `assemble_agent_context`
- `list_context_tree`
- `read_context_node`
- `get_context_packet`
- `fetch_decision_summary`
- `query_history`
- `create_session_archive`

These are the right fit when a client needs durable memory recall, canonical
context packets, or bounded non-authoritative session recall.

### Local coding and tool execution

Use Mimir for local coding-domain execution and governed local tool surfaces:

- `execute_coding_task`
- `list_agent_traces`
- `show_tool_output`
- `list_ai_tools`
- `check_ai_tools`
- `tools_package_plan`

These are the right fit when a client wants Mimir to run local models, local
agents, or governed Docker AI tool packaging logic.

### Governed memory updates

Use Mimir for durable note and review workflows only when the client explicitly
wants governed memory mutation:

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

These flows are for durable memory management, not for ephemeral agent-skill
behavior.

## What not to route through Mimir

Do not use Mimir for:

- VoltAgent `Workspace`
- `workspace_*` skill tools
- skill activation, search, or prompt injection
- VoltAgent expert-skill bundles
- client-side subagent orchestration
- general paid-agent quality logic that is not one of Mimir's bounded helper
  roles

If a Codex or Claude integration needs those, implement them directly on the
client side.

## Bounded paid helper roles that may stay inside Mimir

The current allowed Mimir-owned paid roles are:

- `paid_escalation`
- `coding_advisory`

These roles are internal helper paths. They do not make Mimir the owner of
client skills or subagents.

## Preferred transport

For interactive client integrations, prefer the MCP surface backed by the same
runtime command catalog. The MCP tool definitions mirror the commands above and
keep the actor-role defaults explicit.

Use CLI or HTTP only when the integration is operational or process-local and
MCP is not the right transport.

## Acceptance rule for future additions

A new VoltAgent-related feature belongs in Mimir only if all of these are true:

1. it serves a bounded Mimir-owned role
2. it does not require Mimir to own client skills or subagents
3. it keeps Mimir contracts provider-agnostic
4. it preserves Mimir as the authority for memory and local execution

If any of those fail, the feature belongs in the external client integration
instead.
