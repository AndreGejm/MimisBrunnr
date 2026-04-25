# codex-voltagent-default

Repo-local Codex plugin shell for reviewing the VoltAgent default-runtime
integration and for syncing that shell into a home-local Codex plugin
directory.

This shell is **secondary** to native Codex skill discovery. Use the top-level
`skills/` install path first for default activation. Use the plugin shell for
bootstrap, diagnostics, and route/profile inspection.

Current scope:

- optional diagnostics and bootstrap surface
- skills for status, doctor, enable, disable, profiles, and route-preview
- `status` and `doctor` scripts
- `init-client-config` for bootstrapping the home-global client config with optional workspace override
- `bootstrap-default-runtime` for installing the home-local plugin shell and initializing the default config in one step
- `enable` and `disable` config mutators
- `profiles` and `route-preview` inspection scripts
- `claude-handoff` for explicit manual Claude role/skill handoff creation
- `claude-auto-handoff` for automatic unique profile selection by escalation reason
- `install-home-plugin` for syncing the shell into a home-local plugin and marketplace entry that point back to the current checkout
- optional `--probe-runtime` on `status` and `doctor` to compose the built client runtime for a real readiness check

Current non-goals:

- no automatic startup hook
- no claimed Codex bootstrap behavior beyond explicit script execution
- no replacement for native Codex skill discovery as the primary activation path

Run the scripts from the repository root:

```powershell
node .\plugins\codex-voltagent-default\scripts\status.mjs --workspace F:\path\to\workspace
node .\plugins\codex-voltagent-default\scripts\doctor.mjs --workspace F:\path\to\workspace
```

For a real composition probe instead of config-only diagnostics, build first and add `--probe-runtime`:

```powershell
pnpm build
node .\plugins\codex-voltagent-default\scripts\status.mjs --workspace F:\path\to\workspace --probe-runtime --state-root .\.tmp\codex-voltagent-state
```

To sync the plugin shell into a home-local plugin and marketplace entry that
point back to this checkout:

```powershell
pnpm build
node .\plugins\codex-voltagent-default\scripts\install-home-plugin.mjs
```

The installed plugin writes `client-root.json` so the home-local shell can
resolve the built client runtime in this repository. Re-run the installer if
you move the repository. You can also run the same install path through
`pnpm plugin:install-home`.

To bootstrap the default home-global client config:

```powershell
pnpm build
node .\plugins\codex-voltagent-default\scripts\init-client-config.mjs --mimir-command node --mimir-arg C:\absolute\path\to\your\mimir-mcp-server.js
```

This writes `~/.codex/voltagent/client-config.json`, enables
`workspaceTrustMode: "all-workspaces"` for `voltagent-default`, and seeds the
standard Claude profile packs when a Claude mode is selected.

Pass `--config <workspace>\client-config.json` when you want a local override
instead of the home-global default.

You can also run the same bootstrap through `pnpm plugin:init-config -- --mimir-command ...`.

To install the home-local plugin shell and initialize the default config in one
step:

```powershell
pnpm build
node .\plugins\codex-voltagent-default\scripts\bootstrap-default-runtime.mjs --mimir-command node --mimir-arg C:\absolute\path\to\your\mimir-mcp-server.js
```

You can also run the same one-step flow through
`pnpm plugin:bootstrap-default -- --mimir-command ...`.

To generate a manual Claude handoff with an explicit role and skill pack:

```powershell
pnpm build
node .\plugins\codex-voltagent-default\scripts\claude-handoff.mjs --profile debug-specialist --reason test-failure --task-summary "Investigate the failing integration test." --repo-context "Repository is in feature/codex-default-voltagent." --relevant-file tests\plugin\plugin-composition.test.ts
```

To let the plugin choose the unique allowed profile for a reason:

```powershell
pnpm build
node .\plugins\codex-voltagent-default\scripts\claude-auto-handoff.mjs --reason pre-release-review --task-summary "Review release readiness before tagging." --repo-context "Repository is in feature/codex-default-voltagent."
```

To preview whether auto mode would resolve into Claude escalation:

```powershell
node .\plugins\codex-voltagent-default\scripts\route-preview.mjs --reason test-failure
```
