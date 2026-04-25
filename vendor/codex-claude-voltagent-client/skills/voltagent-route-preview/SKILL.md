---
name: VoltAgent Route Preview
description: Preview route classification for explicit task flags in the repo-local plugin shell.
---

# VoltAgent Route Preview

Run:

```powershell
node .\plugins\codex-voltagent-default\scripts\route-preview.mjs --needs-durable-memory --needs-workspace-skill
```

Supported flags:

- `--needs-durable-memory`
- `--needs-local-execution`
- `--needs-workspace-skill`
- `--needs-governed-write`

To preview Claude auto selection in `voltagent+claude-auto` mode:

```powershell
node .\plugins\codex-voltagent-default\scripts\route-preview.mjs --config <path-to-client-config.json> --reason <escalation-reason>
```

When a unique profile matches, the output includes:

- base `route`
- `effectiveRoute: "claude-escalation"`
- `claudeAutoSelection`
