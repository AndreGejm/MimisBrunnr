# Go-live gates

This document describes the current rollout gate for using Mimir broadly as a
workspace-facing tool surface.

## Current rollout position

As of `2026-04-27`, the repo is strong enough for controlled local use and
targeted pilots.

It is not yet ready for broad default rollout of the full toolbox experience
across clients and machines.

## What is already good enough

These baseline gates are already satisfied in the current repo:

- memory, retrieval, review, promotion, and history are implemented
- auth and issued-token lifecycle controls are implemented
- direct MCP is implemented and tested
- toolbox control MCP is implemented and tested
- toolbox broker MCP is implemented and can change tool visibility in one
  session
- the external-client boundary is explicit and backed by current packaging and
  runtime structure

## What still blocks broad rollout

### 1. Docker-backed toolbox rollout is not green

Current machine-level blockers:

- `docker_mcp_governance_drift`
- `docker_mcp_apply_blocked`

Current causes:

- the installed Docker toolkit does not expose `docker mcp profile`
- Docker gateway help does not expose `--profile`
- some selected peers are still `descriptor-only`
- live Docker-enabled servers can still exceed the repo-governed contract

### 2. Broker rollout still needs broader validation

The broker is live, but broad rollout still needs:

- more target-client validation beyond the current local path
- more target-machine validation for reconnect and contraction behavior
- broader backend parity than the current owned, `local-stdio`, and opt-in
  `docker-catalog` coverage

### 3. Read-path rollout is still intentionally conservative

These remain partial:

- stronger temporal-validity governance beyond the current refresh-draft flow
- stronger authority-state and namespace follow-through
- default enablement of hierarchical retrieval

## Gate by rollout mode

### Controlled local use

Allowed now when:

- the local runtime is healthy
- the user understands that toolbox rollout readiness is not fully green
- the chosen path is either direct MCP or a constrained toolbox setup

### Narrow pilot

Allowed now when:

- the pilot is opt-in
- it is limited to a small number of machines and workspaces
- flat retrieval remains the default
- hierarchical retrieval is reviewed with packet diffs
- toolbox usage stays within the current documented client and backend limits

### Broad default rollout

Do not treat Mimir as the default broad toolbox surface everywhere until all of
these are true:

1. Docker toolbox rollout readiness is green, or the default path has been
   explicitly narrowed so those Docker blockers no longer matter.
2. Broker behavior has been validated across the actual target clients.
3. The remaining `BK-007`, `BK-008`, and `RV-006` follow-through work is
   materially complete.
4. The external-client boundary still holds: Mimir owns memory, retrieval,
   governed writes, and bounded local execution, while client skills and
   subagents stay outside Mimir.

## Practical decision rule

Use this rule:

- use direct `mimir-mcp` when a broad stable Mimir command catalog is acceptable
- use the toolbox broker when a constrained session is wanted and the current
  backend limits are acceptable
- use the toolbox control surface for discovery, approval, or reconnect flows
- do not claim broad default readiness while the Docker governance and apply
  blockers are still live

## Residual risk to watch

The main remaining rollout risks are:

- drift between repo-governed toolbox policy and live Docker-enabled servers
- assuming descriptor-only peers are live-routable when they are not
- expanding the external-client boundary until Mimir starts owning skill or
  subagent concerns that belong elsewhere
