---
name: VoltAgent Disable
description: Disable repo-local VoltAgent default mode without deleting trusted workspace roots.
---

# VoltAgent Disable

Run:

```powershell
node .\plugins\codex-voltagent-default\scripts\disable.mjs --config <path-to-client-config.json>
```

This updates the config in place and sets `runtime.mode` to `local-only`.
