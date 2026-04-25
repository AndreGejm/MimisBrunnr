---
name: VoltAgent Claude Handoff
description: Generate a deterministic manual Claude escalation envelope with explicit role and skill-pack selection.
---

# VoltAgent Claude Handoff

Run:

```powershell
pnpm build
node .\plugins\codex-voltagent-default\scripts\claude-handoff.mjs --config <path-to-client-config.json> --profile <profile-id> --reason <escalation-reason> --task-summary "<task-summary>" --repo-context "<repo-context>" --relevant-file <path>
```

This emits a structured envelope containing:

- `profileId`
- `roleId`
- `skillPackId`
- ordered skills for the selected pack
- primary and fallback models
- expected output schema
- recursion guard fields
