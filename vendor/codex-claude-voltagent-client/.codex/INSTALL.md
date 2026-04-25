# Installing VoltAgent Default for Codex

Install VoltAgent Default in Codex through **native Codex skill discovery**.

This is the **primary activation path**. It matches the stable Superpowers pattern:

1. clone the repository
2. create a symlink or junction from `~/.codex/skills/voltagent-default` to this repository's `skills/`
3. restart Codex

The plugin shell remains available for bootstrap, diagnostics, and route inspection, but it is optional.

If you want a single onboarding command instead of running installation and
bootstrap separately, use:

```powershell
pnpm build
pnpm codex:onboard -- --workspace F:\path\to\target-workspace
```

That one-step path installs the native skills, writes the default config to
`~/.codex/voltagent/client-config.json`, auto-reads Codex's existing
`mcp_servers.mimir` config when present, and runs the system-level doctor for
the selected workspace.

For a standalone readiness check in the current workspace:

```powershell
pnpm codex:doctor -- --workspace F:\path\to\target-workspace
```

For the packaged smoke verification path after install/bootstrap:

```powershell
pnpm codex:smoke
```

## Prerequisites

- Git
- Codex installed locally

## Installation

### Windows (PowerShell)

From the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-codex.ps1
```

Script path: `scripts/install-codex.ps1`

This creates a junction at:

- `~/.codex/skills/voltagent-default`

pointing to:

- `<repo-root>/skills`

### macOS / Linux

From the repository root:

```bash
sh ./scripts/install-codex.sh
```

Script path: `scripts/install-codex.sh`

This creates a symlink at:

- `~/.codex/skills/voltagent-default`

pointing to:

- `<repo-root>/skills`

## Manual installation

### Windows (PowerShell)

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.codex\skills"
cmd /c mklink /J "$env:USERPROFILE\.codex\skills\voltagent-default" "<repo-root>\skills"
```

### macOS / Linux

```bash
mkdir -p ~/.codex/skills
ln -s "<repo-root>/skills" ~/.codex/skills/voltagent-default
```

## Verify

Restart Codex, then confirm that the VoltAgent skills are available through the normal Codex skill discovery flow.

The installed set should include:

- `voltagent-default-workflow`
- `voltagent-status`
- `voltagent-doctor`
- `voltagent-bootstrap-default-runtime`
- `voltagent-route-preview`
- `voltagent-profiles`
- `voltagent-claude-handoff`
- `voltagent-claude-auto-handoff`

## Updating

Pull the repository updates. The native skill install updates automatically through the symlink or junction.

## Uninstalling

Remove:

- `~/.codex/skills/voltagent-default`

The repo clone can then be deleted separately if desired.
