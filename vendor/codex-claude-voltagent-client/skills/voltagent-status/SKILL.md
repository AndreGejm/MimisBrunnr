---
name: VoltAgent Status
description: Show the current Codex VoltAgent default-runtime status for an explicit client config and workspace.
---

# VoltAgent Status

Use this skill when you need a direct status snapshot for the repo-local Codex VoltAgent default-runtime shell.

Run:

```powershell
node .\plugins\codex-voltagent-default\scripts\status.mjs --config <path-to-client-config.json> --workspace <workspace-root>
```

This prints JSON describing:

- runtime mode
- trusted workspace roots
- whether the current workspace is trusted
- runtime and Mimir connection state
- configured primary and fallback models
- Claude profile and skill-pack ids
