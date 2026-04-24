# Codex And Claude VoltAgent External Integration Design

## Goal

Define the supported architecture for using VoltAgent directly inside Codex and
Claude for paid-model quality, skills, and subagents while keeping Mimir
limited to memory, retrieval, local-model execution, local-agent execution, and
bounded paid helper roles owned by this repo.

## Status

This is a client-side integration spec. It does not add new runtime ownership
to Mimir. It describes what should live outside this repo and the exact Mimir
surfaces external clients are allowed to call.

## Problem statement

The current Mimir branch has a strong internal VoltAgent integration for
bounded helper roles:

- `paid_escalation`
- `coding_advisory`

That is the correct boundary for Mimir-owned helper behavior. It is the wrong
boundary for:

- VoltAgent skills
- VoltAgent `Workspace`
- workspace skill roots
- expert-skill bundles
- client-local subagent orchestration
- general paid-agent quality behavior inside Codex or Claude

If those concerns are routed through Mimir, Mimir stops being a memory and
local-runtime system and becomes a client-agent control plane. That would
increase coupling, blur security boundaries, and make both upgrade paths worse.

## Ownership split

### Mimir owns

- mimisbrunnr durable memory
- retrieval and context assembly
- governed memory review and promotion flows
- local-model execution
- local-agent execution
- audit and trace records for Mimir-owned commands
- bounded paid helper roles already implemented in this repo

### Codex and Claude own

- VoltAgent skills
- VoltAgent `Workspace`
- workspace skill roots
- expert-skill bundles
- subagents
- paid-agent orchestration quality
- client-local caching and prompt composition
- client-side routing between local skills, paid reasoning, and Mimir calls

### VoltAgent spans both sides, but with different roles

- inside Mimir: paid-runtime harness for bounded Mimir-owned helper roles only
- inside Codex/Claude: primary client-side harness for skills, subagents, and
  paid-agent quality

## Non-goals

Do not add these to Mimir:

- VoltAgent `Workspace`
- `workspace_*` skill tools
- skill activation or search flows
- skill prompt injection
- Mimir-managed expert-skill catalogs for Codex or Claude
- Mimir-owned client subagent orchestration
- a Mimir-side abstraction that attempts to proxy the full VoltAgent client API

## Approaches considered

### 1. Route all VoltAgent behavior through Mimir

Rejected.

This would centralize client skills, workspace behavior, and subagents inside
the memory platform. It creates the wrong ownership model and would force Mimir
to track client concerns that should remain client-local.

### 2. Keep Mimir as memory and local-runtime authority; integrate VoltAgent directly in Codex/Claude

Recommended.

This preserves the clean boundary:

- Codex/Claude own skills, subagents, and paid-agent quality
- Mimir owns durable memory, local models, and governed local execution

It also keeps VoltAgent upgrades straightforward because the richer VoltAgent
surface lives in the client integration, not inside Mimir contracts.

### 3. Split VoltAgent runtime responsibilities evenly between client and Mimir

Rejected.

This sounds flexible but produces ambiguous ownership and duplicated policy. The
cost shows up later as cross-system drift, not immediately during scaffolding.

## Recommended architecture

The recommended architecture has four layers.

### 1. Client orchestration layer

Lives in Codex or Claude.

Responsibilities:

- boot the VoltAgent runtime
- load client-local skills and subagents
- route work between direct skill execution, paid reasoning, and Mimir calls
- maintain client-session state that is not durable governed memory

### 2. Client VoltAgent layer

Lives in Codex or Claude.

Responsibilities:

- load VoltAgent skills and expert bundles
- define workspace roots
- run subagents
- apply client-local hooks, middleware, and guardrails
- run paid-model fallback chains and retries for client-owned work

### 3. Mimir adapter layer

Lives in Codex or Claude, not in Mimir.

Responsibilities:

- speak to Mimir over MCP by default
- expose a narrow client-local adapter for retrieval, local coding, and governed
  memory operations
- normalize Mimir responses into client-side shapes
- apply client-local caching where appropriate

This layer must not expose VoltAgent skills through Mimir. It is a consumer of
Mimir, not an inversion of ownership.

### 4. Mimir runtime layer

Lives in this repo.

Responsibilities:

- answer retrieval and context requests
- execute local coding and local-agent tasks
- manage governed memory writes and review flows
- run only Mimir-owned helper roles through its internal VoltAgent harness

## Canonical interaction model

### Task flow for Codex or Claude

1. Client receives a task.
2. Client decides whether the task is:
   - skill-local
   - subagent-local
   - paid-model-local
   - Mimir-backed
3. If the task needs durable memory or local execution, the client calls Mimir.
4. If the task is client-local, the client stays in VoltAgent and does not call
   Mimir.
5. If the task needs a Mimir-owned bounded helper role, the client calls the
   relevant Mimir command and lets Mimir run its own internal helper path.
6. Results return to the client. Client-local skills remain client-local.

## When to call Mimir

Use Mimir only for these command families.

### Retrieval and context assembly

- `search_context`
- `search_session_archives`
- `assemble_agent_context`
- `list_context_tree`
- `read_context_node`
- `get_context_packet`
- `fetch_decision_summary`
- `query_history`
- `create_session_archive`

Use these when the client needs durable memory recall, bounded context packets,
or immutable session provenance.

### Local coding and governed local tools

- `execute_coding_task`
- `list_agent_traces`
- `show_tool_output`
- `list_ai_tools`
- `check_ai_tools`
- `tools_package_plan`

Use these when the client wants Mimir to perform local-model or local-agent
work inside Mimir's governed execution path.

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

Use these only when the user explicitly wants governed durable memory mutation.
Do not use them for ephemeral skill behavior.

## When not to call Mimir

Do not call Mimir for:

- skill selection
- skill activation or search
- workspace-root management
- subagent orchestration
- client-local planning loops
- paid-agent quality improvements that do not require Mimir-owned data or
  local execution
- general model fallback routing for Codex or Claude

Those remain client-local.

## Preferred transport

Use the Mimir MCP surface as the default integration transport.

Reasons:

- command catalog parity is already maintained across transports
- actor-role defaults are explicit
- toolbox policy boundaries stay visible
- external clients can keep a single long-lived connection

CLI or HTTP should be treated as operational fallbacks, not the default client
integration transport.

## External client component model

The external integration should be implemented as a client-side package or
plugin, not as a Mimir feature.

Recommended components:

### `ClientVoltAgentRuntime`

Owns VoltAgent startup, skill registration, workspace configuration, model
providers, hooks, and subagent registration.

### `MimirCommandAdapter`

Owns MCP requests to Mimir and exposes a narrow typed client API, for example:

- `retrieveContext(...)`
- `getContextPacket(...)`
- `executeLocalCodingTask(...)`
- `listLocalAgentTraces(...)`
- `draftMemoryNote(...)`

This adapter must not expose generic VoltAgent workspace methods.

### `ClientTaskRouter`

Decides whether a request should:

- stay inside client-local VoltAgent skills
- invoke a client-local subagent
- call Mimir for retrieval
- call Mimir for local coding
- call Mimir for governed memory workflows

### `MimirResultCache`

Optional client-local cache for stable read surfaces like:

- `assemble_agent_context`
- `get_context_packet`
- `fetch_decision_summary`

This cache must be ephemeral or client-owned. Durable authoritative state stays
in Mimir.

## Security and trust boundary

### Secrets

Client-paid model secrets for client-local VoltAgent usage belong to the client
runtime, not Mimir.

Mimir-paid model secrets belong only to Mimir-owned helper roles.

Do not create a shared secret store that makes Mimir the broker for all client
paid-model credentials.

### Skills and subagents

VoltAgent skills and subagents running in Codex or Claude are client-side code.
Mimir should not attempt to validate, proxy, host, or execute them.

### Durable writes

Any durable memory write must still go through Mimir's governed write surface.
Client-local VoltAgent skills may prepare content, but they do not become the
durable store of record.

## Config model

### Client-side config

The external client integration should own:

- client-local VoltAgent provider/model configuration
- skill root configuration
- workspace-root configuration
- client-local fallback chains
- client-local subagent registration
- client-local caching policy

### Mimir-side config

Mimir should continue to own:

- Mimir role binding config
- Mimir paid helper role providers and fallback chains
- toolbox and trust policy
- governed memory settings
- local-agent and local-model execution settings

## Failure semantics

### Client-local VoltAgent failure

If a client-local skill or subagent fails:

- handle it in the client runtime
- do not rewrite the failure as a Mimir failure
- call Mimir only if the fallback path actually needs memory or local execution

### Mimir failure

If a Mimir retrieval or local execution call fails:

- treat that as a Mimir-side failure
- preserve the error boundary instead of burying it in client-local skill logic

### Mixed flow failure

If a client-local workflow calls Mimir and then continues:

- record the boundary crossing explicitly in client telemetry
- keep the source of failure attributable

## Observability model

### Client side

Own:

- skill selection logs
- subagent lifecycle logs
- paid-model retry/fallback logs for client-local work
- cache hit/miss metrics for Mimir reads

### Mimir side

Own:

- command audit trails
- paid helper role telemetry for Mimir-owned roles
- local-agent traces
- governed memory workflow audit history

Do not merge these into one pseudo-authoritative stream. Cross-link them if
needed, but keep ownership explicit.

## Rollout plan

### Phase 1: Client adapter only

Build the external `MimirCommandAdapter` and document the allowed command
surface. Keep all skill and subagent work client-local.

### Phase 2: Client-local VoltAgent runtime

Add client-local VoltAgent provider config, hooks, middleware, guardrails, and
subagent registration. Keep Mimir out of that runtime.

### Phase 3: Skill and workspace integration

Add VoltAgent skills, workspace roots, and expert bundles on the client side.
Use Mimir only for memory and local execution calls from those skills.

### Phase 4: Client-side optimization

Add caching, request shaping, and smarter routing between:

- direct client-local skill execution
- client-local paid-model execution
- Mimir retrieval
- Mimir local execution

## Acceptance criteria

This external integration is correct only if all of the following are true:

1. Codex or Claude can use VoltAgent skills and subagents without routing them
   through Mimir.
2. Durable memory reads and writes still flow through Mimir.
3. Local coding and local-agent execution still flow through Mimir.
4. Client-paid model quality improvements remain client-local unless the call is
   a bounded Mimir-owned helper role.
5. No Mimir command or toolbox profile is introduced for `workspace_*` skill
   surfaces.
6. Mimir contracts remain provider-agnostic.
7. Mimir-side VoltAgent upgrades remain isolated to bounded helper roles.

## Rejection rule for future proposals

Reject a proposed VoltAgent addition to Mimir if any of the following are true:

- it makes Mimir own client skills
- it makes Mimir own client subagents
- it requires Mimir to proxy VoltAgent `Workspace`
- it turns Mimir into the broker for client-local paid-agent quality logic
- it weakens the distinction between durable memory authority and client-local
  session behavior

## References

- [external-client-boundary.md](/F:/Dev/scripts/Mimir/mimir/documentation/reference/external-client-boundary.md)
- [voltagent-runtime.md](/F:/Dev/scripts/Mimir/mimir/documentation/operations/voltagent-runtime.md)
- [command-catalog.ts](/F:/Dev/scripts/Mimir/mimir/packages/contracts/src/orchestration/command-catalog.ts)
