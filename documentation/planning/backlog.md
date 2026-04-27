# Backlog

This backlog is current-state only. Completed foundation work is summarized
briefly; the detailed tables from older phases are intentionally pruned here.

## Current baseline

Already implemented in the repo:

- the memory, retrieval, review, promotion, and history core
- auth registry, issued-token lifecycle, and issuer controls
- the direct MCP adapter
- the toolbox control surface
- the dynamic toolbox broker
- manifest-driven toolbox policy with bands, workflows, clients, and compiled
  profiles
- read-only Docker AI tool discovery and packaging helpers
- the external-client boundary that keeps skills and subagents outside Mimir

## Rollout-critical backlog

These are the active items that still matter for broad rollout.

| ID | Item | Current state | Status |
| --- | --- | --- | --- |
| `TB-004` | Close Docker toolbox governance drift and apply blockers | `sync-mcp-profiles` and doctor already report the failures, but the current Docker toolkit still lacks `docker mcp profile` and selected peers remain `descriptor-only` | partial |
| `TB-007` | Validate toolbox rollout across real target client environments | local validation exists, but broader target-machine coverage is still missing for the reconnect and broker paths | partial |
| `TB-009` | Broaden broker peer/backend parity | owned tools, local-stdio peers, and opt-in `docker-catalog` routing exist; `descriptor-only` peers are still not routable in-session | partial |
| `BK-007` | Finish stronger temporal-validity governance | validity windows, refresh candidates, and refresh drafts exist; stronger lifecycle policy and automation are still incomplete | partial |
| `BK-008` | Keep hierarchical retrieval behind explicit rollout review until default enablement is approved | hierarchical retrieval exists, but flat remains the default and packet-diff review is still required before any default change | partial |
| `RV-006` | Finish authority-state and namespace follow-through | core authority-state and namespace projections exist, but broader enforcement and rollout guardrails are still incomplete | partial |

## Current toolbox-specific notes

The toolbox backlog now sits on top of live code, not a paper design.

Current live layers:

1. checked-in policy under `docker/mcp`
2. compatibility discovery and reconnect through `mimir-control`
3. same-session brokering through `mimir-toolbox-mcp`

What is already done:

- bands and workflows are first-class authoring units
- workflow files compile into composite profile ids
- client overlays are enforced as no-widening filters
- the broker starts in `bootstrap`, emits `notifications/tools/list_changed`,
  and contracts on idle timeout or lease expiry
- Codex client materialization works for `local-stdio` peers marked
  `configTarget: codex-mcp-json`

What still blocks default rollout:

- Docker governance drift against repo policy
- descriptor-only peer apply blockers
- broader broker validation outside the current local path

## Current boundary-specific notes

The external-client boundary is no longer backlog. It is implemented policy.

Still active follow-through items:

- keep new client-facing work out of Mimir when it really belongs to client
  skills or subagents
- keep `voltagent-docs` scoped as a docs peer instead of letting it turn into a
  general Workspace bridge
- keep direct MCP and toolbox-mediated MCP as separate interface families in
  docs and validation

## Intentionally not in the current stack

These are still out of scope for the shipped baseline:

- webhook or SSE transport
- dashboard UI
- queue worker or scheduler process
- entity graph
- Kubernetes mutation tooling
- generic client-skill orchestration through Mimir
