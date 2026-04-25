---
name: VoltAgent Claude Auto Handoff
description: Generate a deterministic Claude escalation envelope by selecting the unique allowed profile for an escalation reason.
---

# VoltAgent Claude Auto Handoff

Run:

```powershell
pnpm build
node .\plugins\codex-voltagent-default\scripts\claude-auto-handoff.mjs --config <path-to-client-config.json> --reason <escalation-reason> --task-summary "<task-summary>" --repo-context "<repo-context>"
```

Behavior:

- selects the unique profile that allows the given reason
- errors if no profile matches
- errors if multiple profiles match
- emits the same structured envelope as the manual handoff path
