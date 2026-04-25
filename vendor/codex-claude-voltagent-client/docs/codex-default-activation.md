# Codex Default VoltAgent Activation

This document defines the stable default workflow for using VoltAgent in Codex.

## Activation model

Use native Codex skill discovery as the primary activation path:

- install this repository's `skills/` tree into `~/.codex/skills/voltagent-default`
- restart Codex
- let Codex discover the VoltAgent skills the same way it discovers Superpowers

The plugin shell remains optional and is intended for bootstrap, diagnostics, and route inspection only.

## Routing policy

Use the shared client runtime and Mimir boundary like this:

- `client-skill`
  - local VoltAgent Workspace skill work
- `client-paid-runtime`
  - local paid-model orchestration that does not require Mimir
- `mimir-retrieval`
  - durable memory retrieval and context assembly
- `mimir-local-execution`
  - local coding execution and local-agent work
- `mimir-memory-write`
  - governed durable writes
- `claude-escalation`
  - explicit Claude escalation through a named profile

## Claude escalation policy

Claude escalation is deterministic:

- the **client selects the profile**
- the **model does not select its own role**
- the model does not select its own skill pack
- the skill pack is an ordered allowlist
- escalation depth is bounded to `1`
- Claude escalation cannot recursively trigger another Claude escalation

## Failure and degradation policy

### Without Mimir

Without Mimir, local VoltAgent Workspace skills can still work, but the following routes are unavailable or degraded:

- `mimir-retrieval`
- `mimir-local-execution`
- `mimir-memory-write`

### Without Claude profile configuration

Without Claude profile configuration, `claude-escalation` is blocked. It must not silently degrade into an unprofiled paid-model call.

## Operational guidance

Use these skills first:

- `voltagent-default-workflow`
- `voltagent-doctor`
- `voltagent-status`
- `voltagent-route-preview`
- `voltagent-profiles`
- `voltagent-claude-handoff`
- `voltagent-claude-auto-handoff`

Bootstrap only when needed:

- `voltagent-bootstrap-default-runtime`

## Fresh-machine smoke

After native install and bootstrap, use the packaged smoke path to prove the
supported activation flow still works:

```powershell
pnpm codex:smoke
```

That smoke path covers:

- the boundary routing invariants
- a fresh-home, fresh-workspace onboarding flow through `pnpm codex:onboard`
- a follow-up readiness check through `pnpm codex:doctor`

Run the package commands from the client repository root. Use `--workspace` to
target the actual project workspace when it is not the same directory.

That keeps the runtime boundary explicit:

- VoltAgent owns local skills, subagents, and paid orchestration quality
- Mimir owns memory, retrieval, governed writes, and local execution
