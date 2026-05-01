# Windows Installer Contracts

This document describes the implemented Windows installer backend contracts in
`scripts/installers/windows/`.

It is a current-state contract document. It should only describe behavior that
exists in tracked code today.

For repo setup, use [`installation.md`](./installation.md). For toolbox policy
and rollout meaning, use [`../operations/docker-toolbox-v1.md`](../operations/docker-toolbox-v1.md).

## Implemented files

Backend entrypoints:

- `scripts/installers/windows/cli.ps1`
- `scripts/installers/windows/installer.ps1`

Backend modules:

- `scripts/installers/windows/lib/result-envelope.ps1`
- `scripts/installers/windows/lib/state-store.ps1`
- `scripts/installers/windows/lib/environment-detection.ps1`
- `scripts/installers/windows/lib/write-plan.ps1`
- `scripts/installers/windows/lib/client-access.ps1`
- `scripts/installers/windows/lib/repo-bootstrap.ps1`
- `scripts/installers/windows/lib/toolbox-assets.ps1`
- `scripts/installers/windows/lib/toolbox-control.ps1`
- `scripts/installers/windows/lib/docker-mcp-toolkit.ps1`

Adapters:

- `scripts/installers/windows/lib/adapters/node-json-script.ps1`
- `scripts/installers/windows/lib/adapters/process-capture.ps1`
- `scripts/installers/windows/lib/adapters/package-scripts.ps1`
- `scripts/installers/windows/lib/adapters/default-access.ps1`
- `scripts/installers/windows/lib/adapters/codex-voltagent-access.ps1`

Wrapped repo helpers:

- `scripts/doctor-default-access.mjs`
- `scripts/install-default-access.mjs`
- `scripts/docker/audit-toolbox-assets.mjs`
- `scripts/docker/sync-mcp-profiles.mjs`
- `vendor/codex-claude-voltagent-client/scripts/codex-onboard.mjs`
- `vendor/codex-claude-voltagent-client/scripts/codex-doctor.mjs`
- `corepack pnpm cli -- <toolbox-command>`
- the live `docker mcp` CLI

## Client model

The backend now resolves client definitions through `client-access.ps1`.

Current implemented client:

- `codex`

Current client definition fields:

- `clientName`
- `displayName`
- `accessKind`
- `defaultConfigPath`
- `defaultServerName`
- `adapterId`

The generic client layer exists, but the live implementation is still limited to
`codex`.

## Operation summary

### `detect-environment`

Purpose:

- report machine capability state through a stable envelope

Current behavior:

- checks PowerShell host state in-process
- reports PATH and availability for Node, Git, Corepack, Python, Docker CLI,
  and Docker engine readiness

Current reason codes:

- `environment_detected`

### `audit-install-surface`

Purpose:

- normalize the current access health into the installer envelope

Current behavior:

- resolves the selected client definition
- runs `scripts/doctor-default-access.mjs`
- reports wrapper paths, built entrypoints, Codex MCP config, launcher state,
  manifest state, Docker tool asset status, Docker MCP support probes, and
  toolbox rollout-readiness diagnostics already exposed by
  `scripts/lib/default-access.mjs`

Current status mapping:

- default-access `healthy` -> installer `success`
- default-access `degraded` -> installer `user_action_required`
- default-access `unavailable` -> installer `user_action_required`

Current reason codes:

- `install_surface_healthy`
- `install_surface_degraded`
- `install_surface_unavailable`

### `plan-client-access`

Purpose:

- expose a dry-run write plan without mutating the machine

Current behavior:

- runs `scripts/install-default-access.mjs --dry-run`
- previews write targets for:
  - Codex MCP config
  - install manifest
  - compatibility launchers
  - vendored Codex/VoltAgent home-global config
  - vendored native skill link
- emits backup behavior for existing config or manifest targets

Current reason codes:

- `client_access_plan_ready`

### `apply-client-access`

Purpose:

- execute the tracked access installers through one backend contract

Current behavior:

- reruns the dry-run path first
- executes `scripts/install-default-access.mjs`
- executes vendored `codex-onboard.mjs`
- executes vendored `codex-doctor.mjs`
- reports combined default-access and vendored onboarding health
- records timestamped backups created during the apply flow

Current reason codes:

- `client_access_applied`
- `client_access_applied_with_follow_up`

### `prepare-repo-workspace`

Purpose:

- validate and prepare a clean local checkout of the tracked workspace

Current behavior:

- requires `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`
- requires `package.json.name === "@mimir/workspace"`
- runs:
  - `git rev-parse --show-toplevel`
  - `git status --porcelain`
- blocks on a dirty worktree
- on a clean worktree, runs:
  - `corepack pnpm install --frozen-lockfile`
  - `corepack pnpm build`
  - `corepack pnpm vendor:codex-voltagent:build`
- verifies the expected built entrypoints

Current reason codes:

- `repo_workspace_prepared`
- `repo_workspace_dirty`
- `repo_workspace_invalid`
- `repo_workspace_outputs_missing`

### `audit-toolbox-assets`

Purpose:

- validate the checked-in toolbox manifests and compiled runtime plan shape

Current behavior:

- runs `scripts/docker/audit-toolbox-assets.mjs --json`
- compiles the checked-in `docker/mcp` policy
- compiles the deterministic Docker runtime plan
- reports manifest and runtime-plan summary counts

Current reason codes:

- `toolbox_assets_valid`
- `toolbox_assets_invalid`

### `prepare-toolbox-runtime`

Purpose:

- persist the compiled Docker runtime plan as an installer artifact

Current behavior:

- runs `scripts/docker/sync-mcp-profiles.mjs --json`
- writes `toolbox-runtime-plan.json` under the installer state root by default
- reports plan metadata such as `manifestRevision`, `generatedAt`,
  `profileCount`, and `serverCount`

Important boundary:

- this does not mutate Docker Desktop or Docker MCP Toolkit state

Current reason codes:

- `toolbox_runtime_prepared`

### `audit-toolbox-control-surface`

Purpose:

- verify toolbox discovery through the real CLI control surface

Current behavior:

- runs:
  - `corepack pnpm cli -- list-toolboxes`
  - `corepack pnpm cli -- describe-toolbox`
- reports toolbox ids, approval-required counts, and one toolbox summary

Current reason codes:

- `toolbox_control_surface_audited`
- `toolbox_control_surface_empty`

### `audit-active-toolbox-session`

Purpose:

- inspect the current active toolbox session without mutating it

Current behavior:

- runs:
  - `corepack pnpm cli -- list-active-toolbox`
  - `corepack pnpm cli -- list-active-tools`
- reports workflow, profile, client overlay, and declared/active/suppressed tool buckets

Current reason codes:

- `toolbox_active_session_audited`

### `audit-toolbox-client-handoff`

Purpose:

- verify reconnect handoff readiness for the selected client

Current behavior:

- combines installer client-access audit data with:
  - `corepack pnpm cli -- list-active-toolbox`
- reports readiness for:
  - `MAB_TOOLBOX_ACTIVE_PROFILE`
  - `MAB_TOOLBOX_CLIENT_ID`
  - `MAB_TOOLBOX_SESSION_MODE`
  - optional `MAB_TOOLBOX_SESSION_POLICY_TOKEN`

Current reason codes:

- `toolbox_client_handoff_ready`
- `toolbox_client_handoff_follow_up`

### `audit-toolbox-rollout-readiness`

Purpose:

- aggregate the read-only rollout checks the installer can perform today

Current behavior:

- combines:
  - toolbox discovery
  - active-session audit
  - client handoff audit
  - Docker governance drift audit
  - Docker apply-plan compatibility audit
- reports blocked rollout areas without activating toolboxes or mutating Docker
- returns a structured remediation summary with:
  - `remediationPlan.keepLiveServers`
  - `remediationPlan.disableLiveServers`
  - `remediationPlan.blockedPolicyServers`

Current reason codes:

- `toolbox_rollout_ready`
- `toolbox_rollout_follow_up`

Important boundary:

- access installation can be healthy while rollout readiness still returns
  `user_action_required`
- current follow-up states commonly come from Docker governance drift and Docker
  apply blockers, not from missing Codex access

### `audit-docker-mcp-toolkit`

Purpose:

- inspect live Docker MCP Toolkit state

Current behavior:

- runs:
  - `docker mcp version`
  - `docker mcp profile server ls --format json`
  - falls back to `docker mcp server ls --json` when needed
  - `docker mcp client ls --json`
  - `docker mcp config read`
  - `docker mcp feature ls`
- reports enabled-server, configured-client, and connected-client summaries

Current reason codes:

- `docker_mcp_toolkit_audited`

### `plan-docker-mcp-toolkit-apply`

Purpose:

- produce a reviewed Docker apply plan without executing it

Current behavior:

- compiles the checked-in runtime plan through `scripts/docker/sync-mcp-profiles.mjs --json`
- inspects the same live Docker MCP Toolkit state used by
  `audit-docker-mcp-toolkit`
- probes `docker mcp profile --help`
- returns normalized apply commands plus `blockedServers[]` and compatibility flags
- never executes the Docker commands

Current reason codes:

- `docker_mcp_toolkit_apply_plan_ready`
- `docker_mcp_toolkit_apply_plan_blocked`

Important boundary:

- installer apply planning keeps Docker mutation disabled until the profile is
  both governance-clean and apply-safe
- the plan remains blocked while selected profiles contain descriptor-only peers
  with no safe wrapper, catalog entry, or vetting decision

### `show-state`

Purpose:

- return the last persisted report and session summary without rerunning helpers

Current reason codes:

- `state_loaded`
- `state_missing`

## Result envelope

Every operation returns the same top-level shape:

```json
{
  "schemaVersion": 1,
  "operationId": "audit-install-surface",
  "mode": "audit_only",
  "recordedAt": "2026-04-27T10:37:07.8148376Z",
  "repoRoot": "F:\\Dev\\scripts\\Mimir\\mimir",
  "stateRoot": "C:\\Users\\<user>\\AppData\\Local\\Mimir\\installer",
  "status": "success",
  "reasonCode": "install_surface_healthy",
  "message": "Installer-facing access surfaces are configured.",
  "details": {},
  "artifactsWritten": [],
  "backupsCreated": [],
  "commandsRun": [],
  "nextActions": []
}
```

Current top-level `status` values emitted by this backend:

- `success`
- `user_action_required`

The larger installer planning docs may describe broader status vocabularies, but
they are not part of the current implemented contract.

## Write-plan target shape

`plan-client-access` emits `details.writePlan.writeTargets[]` entries with this
shape:

```json
{
  "id": "client-config",
  "kind": "file",
  "path": "C:\\Users\\<user>\\.codex\\config.toml",
  "exists": true,
  "mutationKind": "upsert_file",
  "backupStrategy": "timestamped_copy",
  "backupPathPattern": "C:\\Users\\<user>\\.codex\\config.toml.<timestamp>.bak"
}
```

Current mutation kinds:

- `upsert_file`
- `replace_file`
- `write_file`
- `create_link`

Current backup strategies:

- `timestamped_copy`
- `none`

## Persisted state

Current state files:

- `install-session.json`
- `last-report.json`
- `history/<timestamp>-<operation>.json`

Default location:

- `%LOCALAPPDATA%\Mimir\installer`

## Current non-goals

These are still outside the implemented backend:

- GUI workflow
- clone or update orchestration
- automatic dirty-worktree repair
- Docker apply execution through the installer
- toolbox activation or approval issuance through the installer
- additional client implementations beyond `codex`
