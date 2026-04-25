---
name: VoltAgent Enable
description: Enable repo-local VoltAgent default mode for an explicit trusted workspace in the client config.
---

# VoltAgent Enable

Run:

```powershell
node .\plugins\codex-voltagent-default\scripts\enable.mjs --config <path-to-client-config.json> --workspace <workspace-root>
```

This updates the config in place, sets `runtime.mode` to `voltagent-default`,
and adds the workspace root to `runtime.trustedWorkspaceRoots`.
