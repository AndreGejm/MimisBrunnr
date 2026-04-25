---
name: VoltAgent Bootstrap Default Runtime
description: Install the home-local plugin shell and initialize the home-global VoltAgent config with optional workspace override in one step.
---

# VoltAgent Bootstrap Default Runtime

From any workspace, run:

```powershell
node .\plugins\codex-voltagent-default\scripts\bootstrap-default-runtime.mjs --mimir-command <command> --mimir-arg <arg>
```

This combines:

1. `install-home-plugin.mjs`
2. `init-client-config.mjs`

Defaults:

- installs the home-local plugin shell and marketplace entry under the current user home
- writes `~/.codex/voltagent/client-config.json`
- enables `workspaceTrustMode: "all-workspaces"` by default
- sets `runtime.mode` to `voltagent-default`

Use `--config <workspace>\client-config.json` when you want a local override
instead of the home-global default.

Useful flags:

- `--home-root <path>`
- `--config <path>`
- `--workspace <path>`
- `--mode voltagent+claude-manual`
- `--mode voltagent+claude-auto`
- `--skill-root <path>` (repeatable)
- `--force`
