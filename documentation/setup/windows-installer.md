# Windows Installer Backend

This repository includes a Windows-only installer backend under
`scripts/installers/windows/`. It is a supported access and audit surface for
Windows operators who already have a local checkout of this repo.

Use the normal repo setup from [`installation.md`](./installation.md) first.
This backend layers on top of that repo; it is not a clone/update/bootstrap
product.

## What it is for

The current backend can:

- detect local prerequisite state
- audit existing Mimir and Codex access configuration
- preview or apply launcher and client-config writes
- prepare a clean repo checkout by running the tracked workspace install/build steps
- audit toolbox control, session, handoff, and rollout-readiness state
- inspect Docker MCP Toolkit state
- compile a toolbox runtime plan for later Docker work

The current backend does not:

- clone or update the repo
- repair or auto-clean a dirty worktree
- start a GUI flow
- apply Docker MCP profiles
- activate toolboxes through the installer
- guarantee that Docker/toolbox rollout is ready on the local machine

## Entrypoints

- `scripts/installers/windows/cli.ps1`: the backend contract
- `scripts/installers/windows/installer.ps1`: a thin wrapper that forwards arguments to `cli.ps1`

Current client support is still `codex` only, even though the backend now
resolves client definitions through a generic layer.

## Operation groups

### Access and state

- `detect-environment`
- `audit-install-surface`
- `plan-client-access`
- `apply-client-access`
- `show-state`

These operations report or manage:

- launcher wrappers and alias files
- the Codex MCP config entry for `mimir`
- the fixed install manifest at `%USERPROFILE%\.mimir\installation.json`
- the vendored Codex/VoltAgent home-global config and native skill link used by
  the tracked onboarding flow

`apply-client-access` uses the tracked repo helpers. It does not invent a
separate `mimir-mcp` launcher; MCP client config points at the wrapper under
`scripts/launch-mimir-mcp.mjs`.

### Repo preparation

- `prepare-repo-workspace`

This operation is intentionally strict. It validates that the checkout is the
tracked `@mimir/workspace` repo, blocks on a dirty worktree, and only then runs:

- `corepack pnpm install --frozen-lockfile`
- `corepack pnpm build`
- `corepack pnpm vendor:codex-voltagent:build`

### Toolbox and rollout audits

- `audit-toolbox-assets`
- `audit-toolbox-control-surface`
- `audit-active-toolbox-session`
- `audit-toolbox-client-handoff`
- `audit-toolbox-rollout-readiness`

These are read-only checks over the real toolbox CLI and compiled policy. They
do not activate toolboxes or approve elevated profiles. Use
[`../operations/docker-toolbox-v1.md`](../operations/docker-toolbox-v1.md) for
the meaning of toolbox bands, workflows, profiles, and rollout blockers.

### Docker planning and inspection

- `prepare-toolbox-runtime`
- `audit-docker-mcp-toolkit`
- `plan-docker-mcp-toolkit-apply`

The important boundary here is that compile and audit work exists today, but
Docker apply is still separate and may be blocked. In the current repo state:

- `prepare-toolbox-runtime` writes a compiled runtime-plan artifact only
- `audit-docker-mcp-toolkit` inspects the live Docker MCP Toolkit state only
- `plan-docker-mcp-toolkit-apply` returns a reviewed plan only and never
  executes the Docker commands

That plan can still be blocked even when `docker mcp ...` commands themselves
run successfully. Current blockers include:

- Docker MCP Toolkit builds that do not expose a real `docker mcp profile` surface
- selected profiles that still contain descriptor-only peers with no safe raw
  catalog apply target

## Representative commands

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation audit-install-surface `
  -Json

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation prepare-repo-workspace `
  -Json

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation audit-toolbox-rollout-readiness `
  -Json

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation plan-client-access `
  -Json
```

`installer.ps1` accepts the same arguments and currently just forwards them to
`cli.ps1`.

## Persisted state

By default the backend writes state under:

- `%LOCALAPPDATA%\Mimir\installer\last-report.json`
- `%LOCALAPPDATA%\Mimir\installer\install-session.json`
- `%LOCALAPPDATA%\Mimir\installer\history\`

Use `-StateRoot` if you need a different state location for tests or local
experiments.

## Canonical docs

- [`windows-installer-contracts.md`](./windows-installer-contracts.md)
- [`installation.md`](./installation.md)
- [`../operations/docker-toolbox-v1.md`](../operations/docker-toolbox-v1.md)
- [`../reference/interfaces.md`](../reference/interfaces.md)
