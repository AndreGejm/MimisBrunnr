---
name: VoltAgent Init Config
description: Initialize a client-config.json for the current workspace with explicit Mimir transport settings and optional Claude mode.
---

# VoltAgent Init Config

From the workspace you want to trust by default, run:

```powershell
node .\plugins\codex-voltagent-default\scripts\init-client-config.mjs --mimir-command <command> --mimir-arg <arg>
```

Defaults:

- writes `.\client-config.json`
- trusts the current working directory as `runtime.trustedWorkspaceRoots[0]`
- sets `runtime.mode` to `voltagent-default`
- seeds `skills.rootPaths` with `%USERPROFILE%\.codex\skills`

Useful flags:

- `--mode local-only`
- `--mode voltagent-default`
- `--mode voltagent+claude-manual`
- `--mode voltagent+claude-auto`
- `--config <path>`
- `--workspace <path>`
- `--skill-root <path>` (repeatable)
- `--primary-model <model>`
- `--fallback-model <model>` (repeatable)
- `--force`
