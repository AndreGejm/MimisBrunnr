---
name: VoltAgent Doctor
description: Run deterministic doctor checks for the repo-local Codex VoltAgent default-runtime shell.
---

# VoltAgent Doctor

Use this skill when you need an actionable readiness report for the repo-local Codex VoltAgent default-runtime shell.

Run:

```powershell
node .\plugins\codex-voltagent-default\scripts\doctor.mjs --config <path-to-client-config.json> --workspace <workspace-root>
```

This prints JSON with:

- overall `ok` state
- runtime mode
- workspace root
- status snapshot
- per-check results for:
  - config version
  - workspace trust
  - Mimir stdio command presence
  - skill root configuration
  - Claude profile readiness
