---
name: VoltAgent Init Config
description: Initialize the home-global VoltAgent config with explicit Mimir transport settings and optional Claude mode.
---

# VoltAgent Init Config

From any workspace, run:

```powershell
node .\plugins\codex-voltagent-default\scripts\init-client-config.mjs --mimir-command <command> --mimir-arg <arg>
```

Defaults:

- writes `~/.codex/voltagent/client-config.json`
- enables `workspaceTrustMode: "all-workspaces"`
- sets `runtime.mode` to `voltagent-default`
- seeds `skills.rootPaths` with `%USERPROFILE%\.codex\skills`

Use `--config <workspace>\client-config.json` when you want a local override
instead of the home-global default.

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
