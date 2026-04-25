---
name: VoltAgent Bootstrap Default Runtime
description: Install the home-local plugin shell and initialize a trusted client-config.json for the current workspace in one step.
---

# VoltAgent Bootstrap Default Runtime

From the workspace you want to trust by default, run:

```powershell
node .\plugins\codex-voltagent-default\scripts\bootstrap-default-runtime.mjs --mimir-command <command> --mimir-arg <arg>
```

This combines:

1. `install-home-plugin.mjs`
2. `init-client-config.mjs`

Defaults:

- installs the home-local plugin shell and marketplace entry under the current user home
- writes `.\client-config.json`
- trusts the current working directory as the default workspace
- sets `runtime.mode` to `voltagent-default`

Useful flags:

- `--home-root <path>`
- `--config <path>`
- `--workspace <path>`
- `--mode voltagent+claude-manual`
- `--mode voltagent+claude-auto`
- `--skill-root <path>` (repeatable)
- `--force`
