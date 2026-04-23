# Codex And Claude VoltAgent External Integration Design

## Goal

Keep Mimir focused on memory, retrieval, local models, and bounded paid helper
roles while moving VoltAgent skills and subagent quality features to the
Codex/Claude side where they belong.

## Ownership split

### Mimir owns

- mimisbrunnr memory and retrieval
- local-model execution
- local-agent execution
- bounded paid helper roles already implemented in this repo:
  - `paid_escalation`
  - `coding_advisory`
- audit, traces, and fallback semantics for those bounded roles

### Codex and Claude own

- agent skills
- subagents
- workspace skill roots
- expert-skill bundles
- paid-agent orchestration quality that is not one of Mimir's bounded helper
  roles

### VoltAgent spans both sides, but with different responsibilities

- inside Mimir: VoltAgent is a paid-runtime harness only
- inside Codex/Claude: VoltAgent may own skills, subagents, and richer
  paid-agent behavior

## Explicit non-goals for Mimir

Do not add these to Mimir:

- VoltAgent `Workspace`
- `workspace_*` skill tools
- skill activation or search flows
- skill prompt injection
- Mimir-managed skill catalogs for Codex or Claude
- Mimir-owned VoltAgent subagent orchestration

Those are the wrong boundary because they turn Mimir into a client-agent control
plane instead of a memory and local-runtime system.

## Supported Mimir-side VoltAgent use

The Mimir repo may continue to grow these bounded capabilities:

- structured outputs
- retries and ordered fallback models
- role-specific hooks, middleware, and guardrails
- typed paid-path telemetry
- provider upgrades behind thin adapters

That keeps paid helper quality improving without letting VoltAgent internals leak
into Mimir contracts.

## Supported Codex/Claude-side VoltAgent use

Codex or Claude should integrate VoltAgent directly when they need:

- expert skills
- workspace skills
- skill bundles from upstream VoltAgent repos
- subagent flows
- richer paid-agent orchestration

In that model, Codex or Claude calls Mimir only for:

- memory lookup and retrieval
- local-agent work
- durable note capture
- bounded helper APIs owned by Mimir

## Dev-only docs convenience

The checked-in `core-dev+voltagent-docs` toolbox profile is the canonical id,
and `core-dev+voltagent-dev` remains as a legacy alias during the current
compatibility window. This toolbox remains valid only as a development-only
docs convenience:

- it exposes `voltagent-docs`
- it helps inspect upstream docs while editing this repo
- it does not define the main runtime architecture

If this profile causes confusion, it can be demoted further or removed without
affecting the main Mimir-to-VoltAgent boundary.

## Integration flow

1. Codex or Claude selects and runs VoltAgent skills directly.
2. If durable context or local execution is needed, the client calls Mimir.
3. Mimir answers from memory, retrieval, or local agents.
4. When Mimir needs one of its own bounded paid helper roles, it may use the
   internal VoltAgent harness.
5. Results flow back to the client without moving client skill ownership into
   Mimir.

## Upgrade policy

- keep using upstream `@voltagent/core`
- keep Mimir adapters thin
- add client-side VoltAgent features outside this repo unless they are clearly
  part of a bounded Mimir-owned role
- reject new Mimir features that route Codex/Claude skills through Mimir

## Acceptance rule for future changes

A proposed VoltAgent feature belongs in Mimir only if all of these are true:

1. it serves a bounded Mimir-owned role
2. it does not require Mimir to own skills or subagents for Codex/Claude
3. it keeps Mimir contracts provider-agnostic
4. it preserves Mimir as the authority for memory and local execution

If any of those fail, the feature should be implemented on the Codex/Claude
side instead.
