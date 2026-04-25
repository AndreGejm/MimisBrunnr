---
name: VoltAgent Default Workflow
description: Use VoltAgent as the default Codex workflow for local Workspace skills, paid orchestration, and deterministic Claude escalation, while keeping Mimir as the backend for durable memory and local execution.
---

# VoltAgent Default Workflow

Use this as the default Codex workflow when VoltAgent is installed through native Codex skill discovery.

## Stable routing contract

- Use the local VoltAgent runtime for:
  - `client-skill`
  - `client-paid-runtime`
- Use Mimir for:
  - `mimir-retrieval`
  - `mimir-local-execution`
  - `mimir-memory-write`
- Use Claude only through named profiles:
  - `claude-escalation`

## Required operating rules

- Use Mimir for durable memory retrieval, governed writes, traces, and local coding execution.
- Do not route `workspace_*` behavior through Mimir.
- Use Claude only through deterministic client-selected profiles.
- Do not let the model choose its own `roleId` or `skillPackId`.
- Do not recursively escalate from Claude into another Claude escalation.

## Recommended workflow

1. Run `voltagent-doctor` if the current workspace has not been bootstrapped.
2. Run `voltagent-bootstrap-default-runtime` if `client-config.json` is missing.
3. Use `voltagent-status` to confirm trusted workspace roots, model chain, and Claude readiness.
4. Use `voltagent-route-preview` when you need to verify whether work should stay local, go to Mimir, or escalate to Claude.
5. Use `voltagent-profiles`, `voltagent-claude-handoff`, or `voltagent-claude-auto-handoff` when Claude escalation is warranted.

## Failure policy

- Without Mimir, local Workspace skills can still work, but `mimir-retrieval`, `mimir-local-execution`, and `mimir-memory-write` routes are blocked or degraded.
- Without Claude profile configuration, `claude-escalation` is blocked rather than silently falling back to fuzzy paid-model behavior.
