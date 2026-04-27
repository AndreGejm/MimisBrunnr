# Codex And Claude VoltAgent External Integration Design

> **Status note (2026-04-27):** This remains the governing ownership split for
> external clients: VoltAgent, skills, workspace behavior, and subagents stay
> client-side; Mimir stays the memory, retrieval, and governed-runtime system.
> The repo now also includes a dynamic toolbox broker and guided toolbox
> authoring, but those do not change this ownership boundary. For the live
> Mimir-side contract, prefer `documentation/reference/external-client-boundary.md`,
> `documentation/reference/interfaces.md`, and
> `documentation/operations/docker-toolbox-v1.md`. The rollout phases below are
> design history, not a live implementation tracker.

## Goal

Define the supported architecture for making VoltAgent the default orchestration
runtime inside Codex, with explicit Claude escalation profiles, while keeping
Mimir limited to durable memory, retrieval, local execution, governed writes,
and bounded paid helper roles owned by this repo.

## Status

This is a client-side integration spec. It does not add new runtime ownership
to Mimir. It describes what should live outside this repo, which Mimir surfaces
external clients are allowed to call, and the rollout constraints required for
usability and stability.

## Problem statement

The 2026-04-24 Mimir branch already had a strong internal VoltAgent integration for
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
- Codex startup/runtime ownership
- Claude escalation profile selection

If those concerns are routed through Mimir, Mimir stops being a memory and
local-runtime system and becomes a client-agent control plane. That would
increase coupling, blur security boundaries, and make both upgrade paths worse.

## Design principles

1. Mimir remains the system of record for durable memory and governed writes.
2. Codex and Claude own paid-agent quality, skills, subagents, and escalation.
3. VoltAgent becomes default in Codex through a client-side bootstrap layer,
   not by broadening Mimir.
4. Claude escalation is deterministic. The client selects the role and skill
   pack before escalation; the model does not infer them ad hoc.
5. Startup, shutdown, reconnect, and failure behavior are first-class design
   concerns, not follow-up polish.

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
- client-side routing between local skills, paid reasoning, Claude escalation,
  and Mimir calls
- startup/runtime lifecycle for the default VoltAgent client

### VoltAgent spans both sides, but with different roles

- inside Mimir: paid-runtime harness for bounded Mimir-owned helper roles only
- inside Codex/Claude: primary client-side harness for skills, subagents,
  workspace behavior, and paid-agent quality

## Non-goals

Do not add these to Mimir:

- VoltAgent `Workspace`
- `workspace_*` skill tools
- skill activation or search flows
- skill prompt injection
- Mimir-managed expert-skill catalogs for Codex or Claude
- Mimir-owned client subagent orchestration
- a Mimir-side abstraction that attempts to proxy the full VoltAgent client API
- client-side Claude profile selection
- client-side paid-agent routing policy

## Target end state

When Codex starts in an allowlisted workspace:

1. a Codex-side bootstrap layer starts or reconnects to one composed VoltAgent
   client runtime
2. that runtime mounts the configured skill roots, including Superpowers and
   approved local skills
3. that runtime opens the narrow Mimir MCP adapter for durable memory,
   retrieval, local execution, and governed writes
4. normal paid orchestration stays client-local inside VoltAgent
5. Claude escalation is available through explicit profiles that define:
   - `profileId`
   - `roleId`
   - `skillPackId`
   - provider/model/fallback chain
   - output contract
   - timeout and retry policy

This is the bar for "VoltAgent is the default in Codex."

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

The recommended architecture has five layers.

### 1. Codex bootstrap layer

Lives in Codex, preferably as a home-local plugin or equivalent bootstrap
surface.

Responsibilities:

- decide whether VoltAgent default mode is enabled for the current workspace
- start or reconnect to the composed client runtime
- expose status, doctor, and profile discovery commands
- own local runtime lifecycle and shutdown behavior

### 2. Client runtime composition layer

Lives in the external client package.

Responsibilities:

- compose the local VoltAgent runtime, Mimir adapter, router, cache, and
  profile registry
- present one stable client surface for Codex and Claude
- enforce runtime guards before requests reach models or Mimir

### 3. Client VoltAgent layer

Lives in Codex or Claude.

Responsibilities:

- load VoltAgent skills and expert bundles
- define workspace roots
- run subagents
- apply client-local hooks, middleware, and guardrails
- run paid-model fallback chains and retries for client-owned work
- run explicit Claude escalation profiles

### 4. Mimir adapter layer

Lives in Codex or Claude, not in Mimir.

Responsibilities:

- speak to Mimir over MCP by default
- expose a narrow client-local adapter for retrieval, local coding, and governed
  memory operations
- normalize Mimir responses into client-side shapes
- apply client-local caching where appropriate

This layer must not expose VoltAgent skills through Mimir. It is a consumer of
Mimir, not an inversion of ownership.

### 5. Mimir runtime layer

Lives in this repo.

Responsibilities:

- answer retrieval and context requests
- execute local coding and local-agent tasks
- manage governed memory writes and review flows
- run only Mimir-owned helper roles through its internal VoltAgent harness

## Runtime lifecycle contract

The default Codex integration must define startup ownership before any automatic
rollout.

### Ownership model

The runtime should be single-owner per trusted workspace.

Recommended contract:

- one composed client runtime per workspace root
- one ownership lock per workspace
- reconnect to an existing runtime when a second Codex window opens on the same
  workspace
- do not silently spawn duplicate runtimes for the same workspace

### Required lifecycle behaviors

- startup lock acquisition or reconnect
- explicit health state before the runtime is considered ready
- graceful shutdown on Codex/plugin exit
- idle shutdown after a configurable quiet period
- orphan cleanup on next startup if the previous owner crashed

### Failure behavior

- if the lock exists but the runtime is dead, reclaim it
- if the runtime is unhealthy, expose degraded mode instead of pretending the
  default path is ready
- startup failure must surface through status and doctor commands

## Supported runtime modes

The client must expose a clear mode model:

- `local-only`
- `voltagent-default`
- `voltagent+claude-manual`
- `voltagent+claude-auto`

This must be visible through diagnostics and easy to override per session.

## Canonical interaction model

### Task flow for Codex or Claude

1. Client receives a task.
2. Client classifies it into one of the supported route classes.
3. If the task needs durable memory or local execution, the client calls Mimir.
4. If the task is client-local, the client stays in VoltAgent and does not call
   Mimir.
5. If the task needs Claude escalation, the client selects a profile before the
   escalation call starts.
6. Results return to the client. Client-local skills remain client-local.

### Route classes

The client should classify tasks into:

- `mimir-memory-write`
- `mimir-local-execution`
- `mimir-retrieval`
- `client-skill`
- `client-paid-runtime`
- `claude-escalation`

### Mimir dependency classes

#### Works without Mimir

- local workspace skills
- client-local subagent behavior
- basic paid drafting/reasoning that does not depend on Mimir-owned data

#### Degraded without Mimir

- retrieval-assisted tasks
- context-packet assisted paid reasoning

#### Blocked without Mimir

- governed durable writes
- local coding execution
- local-agent trace reads
- explicit Mimir-backed tool inspection

The client must expose these distinctions clearly in user-facing diagnostics.

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

### Local coding and governed local tools

- `execute_coding_task`
- `list_agent_traces`
- `show_tool_output`
- `list_ai_tools`
- `check_ai_tools`
- `tools_package_plan`

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
- Claude role/profile selection

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

If this runtime uses custom `hooks.onPrepareMessages`, it must also explicitly
enable `workspaceSkillsPrompt` or chain
`workspace.createSkillsPromptHook(...)`. VoltAgent otherwise skips automatic
workspace-skill prompt injection when a custom message-preparation hook is
present.

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
- invoke Claude escalation

### `MimirResultCache`

Optional client-local cache for stable read surfaces like:

- `assemble_agent_context`
- `get_context_packet`
- `fetch_decision_summary`

This cache must be ephemeral or client-owned. Durable authoritative state stays
in Mimir.

### `ClaudeEscalationProfileRegistry`

Maps escalation reasons to explicit profiles.

Each profile must define:

- `profileId`
- `roleId`
- `skillPackId`
- provider/model/fallback chain
- timeout and retry limits
- output schema
- allowed escalation reasons

This registry is required. Claude escalation must never be freeform.

## Claude escalation model

### Core rule

When Codex escalates to Claude, the client must decide the role and skill pack
before Claude receives the task.

### Initial role profile examples

- `design_advisor`
- `implementation_reviewer`
- `debug_specialist`
- `release_reviewer`

### Skill pack semantics

Skill packs must be deterministic:

- allowlist only
- ordered list
- no implicit union with all installed skills
- optional base pack plus role pack only if explicitly configured

Recommended prompt assembly order:

1. system/runtime instructions
2. selected role profile
3. skill-pack prompt material
4. structured task handoff
5. Mimir context material when present

### Escalation envelope

Every Claude escalation request must include:

- `escalationReason`
- `profileId`
- `roleId`
- `skillPackId`
- `taskSummary`
- `repoContext`
- `relevantFiles`
- `mimirContextPacket` when needed
- `localAttemptResult` when applicable
- `expectedOutputSchema`

### Anti-recursion and budget guards

These are hard invariants:

- Claude escalation cannot trigger another Claude escalation
- maximum escalation depth is `1`
- maximum paid subagent depth is `1` unless explicitly overridden
- profile selection cannot be delegated to the model
- profile output cannot rewrite the selected profile or skill pack

## VoltAgent workflows

VoltAgent workflows may be used on the external client side for client-owned
planning, orchestration, and multi-step paid-agent execution.

Rules:

- workflow state and history are client-owned operational state
- VoltAgent workflow memory is not authoritative durable memory
- mimisbrunnr remains the system of record for governed durable memory
- workflow suspension, retries, and observability must not be treated as a
  replacement for Mimir review, audit, or promotion flows

Workflow usage is optional. It is a client-side orchestration feature, not a
Mimir concern.

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

### Workspace trust policy

The default integration must be trust-scoped.

Rules:

- automatic VoltAgent bootstrap only in allowlisted or trusted workspaces
- additional skill roots require explicit trust
- global trusted skills and workspace-local skills remain distinguishable
- Mimir write routes should be disabled by default in untrusted workspaces

### Durable writes

Any durable memory write must still go through Mimir's governed write surface.
Client-local VoltAgent skills may prepare content, but they do not become the
durable store of record.

## Config model

### Client-side config

The external client integration should own:

- runtime mode selection
- client-local VoltAgent provider/model configuration
- skill root configuration
- workspace-root configuration
- client-local fallback chains
- client-local subagent registration
- client-local caching policy
- Claude escalation profile registry
- trust policy for workspaces and skill roots

### Required config safety features

- `configVersion`
- compatibility check between bootstrap layer and client package
- startup rejection for unsupported config versions
- migration notes for config shape changes

### Mimir-side config

Mimir should continue to own:

- Mimir role binding config
- Mimir paid helper role providers and fallback chains
- toolbox and trust policy
- governed memory settings
- local-agent and local-model execution settings

## Failure semantics and usability contract

The client must expose actionable behavior for these failure classes:

- VoltAgent bootstrap failed
- runtime already owned by another process
- Mimir transport unavailable
- skill root invalid
- workspace not allowlisted
- Claude profile missing or invalid
- paid provider auth missing
- model timeout or fallback exhaustion

For each failure class, the client must define:

- message shown
- degraded versus blocked behavior
- retry strategy
- exact status or doctor command for diagnosis

### Required diagnostic surfaces

The integration must expose:

- `status`
- `doctor`
- `route-preview`
- `profiles`
- `enable`
- `disable`

Minimum status output:

- current mode
- runtime health
- workspace roots
- Mimir connection state
- current model and fallback chain
- available Claude profiles
- current route policy mode

## Observability model

### Client side

Own:

- startup and reconnect logs
- skill selection logs
- subagent lifecycle logs
- paid-model retry/fallback logs for client-local work
- Claude profile selection logs
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

> **Historical sequencing note:** The phases below capture the intended rollout
> order on 2026-04-24. Confirm current shipped state in the canonical docs
> above before treating any phase as pending work.

### Phase 0: Verify Codex bootstrap surface

Confirm the real Codex plugin/bootstrap contract before implementation.

Required outputs:

- supported plugin or hook surface
- startup trigger mechanism
- runtime process ownership constraints
- fallback decision if plugin bootstrap is insufficient

### Phase 0.5: Runtime lifecycle contract

Lock the runtime ownership, reconnect, and shutdown contract before enabling
default startup behavior.

### Phase 1: Plugin shell plus diagnostics

Implement the Codex-side bootstrap shell with:

- enable/disable controls
- status/doctor surfaces
- no automatic Claude escalation yet

### Phase 2: Compose the external client runtime

Wire the existing external client package into the bootstrap shell:

- VoltAgent runtime
- Mimir adapter
- route classifier
- ephemeral cache

### Phase 3: Make VoltAgent default in Codex

Enable VoltAgent as the default Codex orchestration path in trusted workspaces.

Constraints:

- no automatic Claude escalation yet
- manual or disabled Claude profile use only
- explicit degraded behavior if Mimir is unavailable

### Phase 4: Add Claude profile registry and manual selection

Introduce:

- role profile registry
- skill pack registry
- manual profile invocation
- structured escalation envelope

### Phase 5: Add automatic Claude escalation policy

Introduce deterministic policy-based escalation into Claude using the approved
profiles and anti-recursion guards.

### Phase 6: Hardening and rollout gates

Add:

- multi-window tests
- repeated-failure circuit breakers
- timeout budget enforcement
- config migration checks
- startup and reconnect smoke coverage

## Acceptance criteria

This external integration is correct only if all of the following are true:

1. Codex can start with VoltAgent orchestration by default in an allowlisted
   workspace without manual runtime construction.
2. VoltAgent startup ownership and reconnect behavior are deterministic and
   prevent duplicate runtimes per workspace.
3. Durable memory reads and writes still flow through Mimir.
4. Local coding and local-agent execution still flow through Mimir.
5. Client-local skills and subagents do not route through Mimir.
6. Claude escalation always includes explicit:
   - `profileId`
   - `roleId`
   - `skillPackId`
7. Skill packs are deterministic allowlists, not implicit unions of installed
   skills.
8. Claude escalation cannot recursively escalate again.
9. Client workflow state is never treated as authoritative durable memory.
10. Failure states are visible through status or doctor surfaces with actionable
    recovery guidance.
11. No Mimir command or toolbox profile is introduced for `workspace_*` skill
    surfaces.
12. VoltAgent `Workspace` and `workspace_*` features are introduced only in the
    external client package, never in Mimir.
13. Mimir contracts remain provider-agnostic.
14. Mimir-side VoltAgent upgrades remain isolated to bounded helper roles.

## Rejection rule for future proposals

Reject a proposed VoltAgent addition to Mimir if any of the following are true:

- it makes Mimir own client skills
- it makes Mimir own client subagents
- it requires Mimir to proxy VoltAgent `Workspace`
- it turns Mimir into the broker for client-local paid-agent quality logic
- it weakens the distinction between durable memory authority and client-local
  session behavior
- it allows Claude profile selection to drift into Mimir-side config

## References

- [external-client-boundary.md](/F:/Dev/scripts/Mimir/mimir/documentation/reference/external-client-boundary.md)
- [voltagent-runtime.md](/F:/Dev/scripts/Mimir/mimir/documentation/operations/voltagent-runtime.md)
- [command-catalog.ts](/F:/Dev/scripts/Mimir/mimir/packages/contracts/src/orchestration/command-catalog.ts)
