# Windows Installer Contracts

This document describes the implemented Windows installer backend contracts in
`scripts/installers/windows/`.

It only covers tracked code that exists today. It does not restate the larger
guided bootstrap design unless the behavior is implemented in the repository.

## Current scope

Implemented files:

- `scripts/installers/windows/cli.ps1`
- `scripts/installers/windows/installer.ps1`
- `scripts/installers/windows/lib/result-envelope.ps1`
- `scripts/installers/windows/lib/state-store.ps1`
- `scripts/installers/windows/lib/environment-detection.ps1`
- `scripts/installers/windows/lib/write-plan.ps1`
- `scripts/installers/windows/lib/client-access.ps1`
- `scripts/installers/windows/lib/repo-bootstrap.ps1`
- `scripts/installers/windows/lib/toolbox-assets.ps1`
- `scripts/installers/windows/lib/toolbox-control.ps1`
- `scripts/installers/windows/lib/docker-mcp-toolkit.ps1`
- `scripts/installers/windows/lib/adapters/node-json-script.ps1`
- `scripts/installers/windows/lib/adapters/process-capture.ps1`
- `scripts/installers/windows/lib/adapters/package-scripts.ps1`
- `scripts/installers/windows/lib/adapters/default-access.ps1`

The backend currently wraps these existing repo helpers:

- `scripts/doctor-default-access.mjs`
- `scripts/docker/audit-toolbox-assets.mjs`
- `scripts/docker/sync-mcp-profiles.mjs`
- `vendor/codex-claude-voltagent-client/scripts/codex-onboard.mjs`
- `vendor/codex-claude-voltagent-client/scripts/codex-doctor.mjs`
- `corepack pnpm cli -- <toolbox-command>`
- the live `docker mcp` toolkit CLI

The backend also includes one implemented client definition:

- `codex`

## Operation contract

### `detect-environment`

Purpose:

- report machine and runtime capability state through a stable installer
  contract
- persist the report into installer state files

Current behavior:

- reports `powershell`
- reports `node`
- reports `git`
- reports `corepack`
- reports `python`
- reports `docker_cli`
- reports `docker_engine`

Current reason codes:

- `environment_detected`

### `audit-install-surface`

Purpose:

- normalize the current default-access health report into the installer result
  envelope
- persist the result into installer state files

Current behavior:

- resolves the selected installer client definition
- invokes the adapter registered for that client
- maps the existing report states into installer statuses
- includes Docker tool metadata already exposed by
  `scripts/lib/default-access.mjs`

Current client-access normalization:

```json
{
  "clientName": "codex",
  "displayName": "Codex",
  "accessKind": "mcp_stdio",
  "serverName": "mimir",
  "configPath": "C:\\Users\\<user>\\.codex\\config.toml",
  "configured": false
}
```

Current status mapping:

- default-access `healthy` -> installer `success`
- default-access `degraded` -> installer `user_action_required`
- default-access `unavailable` -> installer `user_action_required`

Current reason codes:

- `install_surface_healthy`
- `install_surface_degraded`
- `install_surface_unavailable`

### `prepare-repo-workspace`

Purpose:

- validate that a local checkout is the tracked mimir workspace
- refuse installer-managed prepare work on dirty git state
- run the baseline repo preparation commands on a clean checkout
- verify required built entrypoints exist after build
- persist the result into installer state files

Current behavior:

- requires:
  - `package.json`
  - `pnpm-workspace.yaml`
  - `pnpm-lock.yaml`
- requires `package.json.name === "@mimir/workspace"`
- invokes:
  - `git rev-parse --show-toplevel`
  - `git status --porcelain`
- blocks with `user_action_required` if the repo root is invalid or the
  worktree is dirty
- on a clean repo, invokes:
  - `corepack pnpm install --frozen-lockfile`
  - `corepack pnpm build`
  - `corepack pnpm vendor:codex-voltagent:build`
- verifies:
  - `apps/mimir-api/dist/main.js`
  - `apps/mimir-cli/dist/main.js`
  - `apps/mimir-mcp/dist/main.js`
  - `apps/mimir-control-mcp/dist/main.js`
  - `vendor/codex-claude-voltagent-client/dist/index.js`

Current reason codes:

- `repo_workspace_prepared`
- `repo_workspace_dirty`
- `repo_workspace_invalid`
- `repo_workspace_outputs_missing`

### `plan-client-access`

Purpose:

- expose a machine-readable dry-run write plan for the selected installer client
- preview write targets, mutation kinds, and backup behavior without applying
  changes
- persist the plan into installer state files

Current behavior:

- resolves the selected installer client definition
- invokes `scripts/install-default-access.mjs --dry-run` through the current
  adapter
- emits the exact apply command shape for the tracked install helper
- previews write targets for:
  - default-access client config
  - installation manifest
  - compatibility launchers
  - vendored Codex/VoltAgent workspace config
  - vendored native Codex skill link
- marks backup behavior as:
  - `timestamped_copy` for existing config and manifest files
  - `timestamped_copy` for existing vendored workspace config files
  - `none` for launcher files, because the tracked launcher installer rewrites
    them in place without creating backups

Current reason codes:

- `client_access_plan_ready`

### `audit-toolbox-assets`

Purpose:

- validate the tracked `docker/mcp` manifest set through the same compiler path
  used by the toolbox runtime
- normalize the toolbox manifest/runtime-plan summary into the installer result
  envelope
- persist the result into installer state files

Current behavior:

- invokes `scripts/docker/audit-toolbox-assets.mjs --json`
- compiles the manifest set through `compileToolboxPolicyFromDirectory(...)`
- compiles the deterministic Docker runtime plan through
  `compileDockerMcpRuntimePlan(...)`
- emits manifest counts for categories, trust classes, servers, profiles,
  intents, clients, and tools
- emits runtime-plan counts for profiles and servers
- emits booleans for bootstrap-profile and control-server presence

Current reason codes:

- `toolbox_assets_valid`
- `toolbox_assets_invalid`

### `prepare-toolbox-runtime`

Purpose:

- compile the checked-in toolbox manifests into the deterministic Docker runtime
  plan used by the repo toolbox scripts
- persist that plan as an installer-managed artifact for later Docker apply work
- record the prepared artifact in installer state

Current behavior:

- invokes `scripts/docker/sync-mcp-profiles.mjs --json`
- writes the returned runtime plan to `toolbox-runtime-plan.json` under the
  installer state root by default
- emits summary metadata:
  - `manifestDir`
  - `outputPath`
  - `manifestRevision`
  - `generatedAt`
  - `profileCount`
  - `serverCount`
  - `dryRun`
  - `dockerApplyImplemented`

Current reason codes:

- `toolbox_runtime_prepared`

### `audit-toolbox-control-surface`

Purpose:

- verify that the real toolbox discovery surfaces are available through the
  repo CLI
- summarize the available toolbox catalog for installer use without issuing
  activation
- persist the result into installer state files

Current behavior:

- invokes:
  - `corepack pnpm cli -- list-toolboxes --json {}`
  - `corepack pnpm cli -- describe-toolbox --json ...`
- reports:
  - selected installer client id
  - toolbox count
  - approval-required toolbox count
  - toolbox ids
  - one described toolbox summary including workflow, profile, example-task, and
    active-tool counts

Current reason codes:

- `toolbox_control_surface_audited`
- `toolbox_control_surface_empty`

### `audit-active-toolbox-session`

Purpose:

- verify the current active toolbox session surface through the repo CLI
- report workflow, profile, client overlay, and filtered tool buckets without
  mutating session state
- persist the result into installer state files

Current behavior:

- invokes:
  - `corepack pnpm cli -- list-active-toolbox --json {}`
  - `corepack pnpm cli -- list-active-tools --json {}`
- reports:
  - active workflow summary
  - active profile summary
  - active client summary
  - counts and payloads for `declaredTools`, `activeTools`, and
    `suppressedTools`

Current reason codes:

- `toolbox_active_session_audited`

### `audit-toolbox-client-handoff`

Purpose:

- verify reconnect handoff readiness for the selected installer client without
  activating a toolbox
- combine installer client-access health with runtime client handoff metadata
- persist the result into installer state files

Current behavior:

- invokes the existing installer client-access audit
- invokes:
  - `corepack pnpm cli -- list-active-toolbox --json {}`
- reports:
  - installer client-access summary
  - runtime client handoff metadata
  - reconnect contract fields for:
    - `MAB_TOOLBOX_ACTIVE_PROFILE`
    - `MAB_TOOLBOX_CLIENT_ID`
    - `MAB_TOOLBOX_SESSION_MODE`
    - optional `MAB_TOOLBOX_SESSION_POLICY_TOKEN`
  - readiness booleans for access configuration, runtime-client match,
    handoff-strategy detection, and preset availability

Current reason codes:

- `toolbox_client_handoff_ready`
- `toolbox_client_handoff_follow_up`

### `audit-docker-mcp-toolkit`

Purpose:

- inspect the currently installed Docker MCP Toolkit state through the live
  `docker mcp` CLI
- normalize enabled-server, configured-client, and connected-client state into
  the installer result envelope
- persist the result into installer state files

Current behavior:

- invokes:
  - `docker mcp version`
  - `docker mcp server ls --json`
  - `docker mcp client ls --json`
  - `docker mcp config read`
  - `docker mcp feature ls`
- emits:
  - `version`
  - `enabledServerCount`
  - `configuredClientCount`
  - `connectedClientCount`
  - normalized `servers[]`
  - normalized `clients[]`
  - raw `configText`
  - raw `featureText`

Current reason codes:

- `docker_mcp_toolkit_audited`

### `plan-docker-mcp-toolkit-apply`

Purpose:

- compile the tracked toolbox manifests into the same dry-run Docker apply plan
  used by `scripts/docker/sync-mcp-profiles.mjs`
- compare that plan with the live Docker MCP Toolkit capability surface
- record whether reviewed Docker apply work is even possible with the installed
  Toolkit contract
- persist the resulting plan report into installer state files

Current behavior:

- invokes `scripts/docker/sync-mcp-profiles.mjs --json`
- reads the same live Docker Toolkit commands used by
  `audit-docker-mcp-toolkit`
- probes `docker mcp profile --help` with exit-code-aware capture and requires
  profile-specific help output instead of generic top-level help text
- emits:
  - `manifestDir`
  - `manifestRevision`
  - `generatedAt`
  - `profileCount`
  - `serverCount`
  - `applyStatus`
  - `applyAttempted`
  - `applyCommandCount`
  - normalized `commands[]` from the compiler dry-run payload, including
    per-command `blockedServers[]` when the compiler reports blockers
  - `dockerProfileSubcommandAvailable`
  - `compatibleWithCurrentToolkit`
  - `blockedReasons[]`
  - top-level `blockedServers[]` and `descriptorOnlyBlockedServers[]` for
    descriptor-only blockers that keep the plan incompatible
  - embedded `toolkit` summary
- never executes the planned Docker commands
- always marks `mutationAllowed` as `false`
- always marks `reviewRequired` as `true`

Current reason codes:

- `docker_mcp_toolkit_apply_plan_ready`
- `docker_mcp_toolkit_apply_plan_blocked`

Current real-world compatibility note:

- the tracked runtime compiler currently emits `docker mcp profile create ...`
  commands
- installed Toolkit profile support alone does not make the plan compatible
  while selected profiles still contain descriptor-only peer servers such as
  `dockerhub-read` or `grafana-observe`
- the live Docker MCP Toolkit surface verified in this repo does not currently
  expose profile-specific help output for that subcommand, even though the CLI
  returns exit code `0` for `docker mcp profile --help`
- the honest expected status on those builds is therefore
  `user_action_required` plus `docker_mcp_toolkit_apply_plan_blocked`

### `apply-client-access`

Purpose:

- execute the tracked client-access installer through the backend contract
- report post-apply access health in the same envelope shape used elsewhere
- record actual backup files created during apply
- persist the apply result into installer state files

Current behavior:

- resolves the selected installer client definition
- runs the same dry-run planning path first so write targets stay explicit
- executes `scripts/install-default-access.mjs`
- executes vendored `codex-onboard.mjs`
- executes vendored `codex-doctor.mjs`
- emits the combined post-apply report, including:
  - default-access health
  - vendored onboarding report
  - vendored doctor report
- emits `details.applyResult.writeTargets[]` with post-apply existence checks
- records new timestamped backup files for existing config and manifest paths
- records new timestamped backup files for existing vendored workspace-config
  paths

Current reason codes:

- `client_access_applied`
- `client_access_applied_with_follow_up`

### `show-state`

Purpose:

- return the last persisted installer report and session summary without
  rerunning repo helpers

Current reason codes:

- `state_loaded`
- `state_missing`

## Result envelope

Every current operation returns this JSON shape:

```json
{
  "schemaVersion": 1,
  "operationId": "audit-install-surface",
  "mode": "audit_only",
  "recordedAt": "2026-04-18T12:34:56.0000000Z",
  "repoRoot": "F:\\Dev\\scripts\\Mimir\\mimir",
  "stateRoot": "C:\\Users\\<user>\\AppData\\Local\\Mimir\\installer",
  "status": "user_action_required",
  "reasonCode": "install_surface_unavailable",
  "message": "Installer-facing access surfaces are not configured yet.",
  "details": {},
  "artifactsWritten": [],
  "backupsCreated": [],
  "commandsRun": [],
  "nextActions": []
}
```

### Status values currently emitted

- `success`
- `user_action_required`

The larger installer design spec proposes additional statuses, but those are not
implemented yet and should not be documented as live behavior elsewhere.

## Write-plan target shape

`plan-client-access` currently emits `details.writePlan.writeTargets[]` entries
with this shape:

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
- `create_link`

Current backup strategies:

- `timestamped_copy`
- `none`

## State files

State storage is implemented in `state-store.ps1`.

Current files:

- `install-session.json`
- `last-report.json`
- `history/<timestamp>-<operation>.json`

When an older or partial `install-session.json` exists, the backend normalizes it
into the current session shape before appending the next operation.

Current session state shape:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-04-18T12:34:56.0000000Z",
  "repoRoot": "F:\\Dev\\scripts\\Mimir\\mimir",
  "stateRoot": "C:\\Users\\<user>\\AppData\\Local\\Mimir\\installer",
  "lastOperationId": "audit-install-surface",
  "lastStatus": "user_action_required",
  "lastReasonCode": "install_surface_unavailable",
  "operations": [
    {
      "operationId": "audit-install-surface",
      "recordedAt": "2026-04-18T12:34:56.0000000Z",
      "status": "user_action_required",
      "reasonCode": "install_surface_unavailable",
      "message": "Installer-facing access surfaces are not configured yet."
    }
  ]
}
```

## Command recording

`detect-environment` records no subprocesses. Detection is performed in-process.

`audit-install-surface` records exactly one command today:

- the `node` invocation used to run `scripts/doctor-default-access.mjs`

`plan-client-access` records exactly one command today:

- the `node` invocation used to run `scripts/install-default-access.mjs --dry-run`

`prepare-repo-workspace` records either two or five commands today:

- always:
  - `git rev-parse --show-toplevel`
  - `git status --porcelain`
- only on a clean repo:
  - `corepack pnpm install --frozen-lockfile`
  - `corepack pnpm build`
  - `corepack pnpm vendor:codex-voltagent:build`

`audit-toolbox-assets` records exactly one command today:

- the `node` invocation used to run `scripts/docker/audit-toolbox-assets.mjs --json`

`prepare-toolbox-runtime` records exactly one command today:

- the `node` invocation used to run `scripts/docker/sync-mcp-profiles.mjs --json`

`audit-docker-mcp-toolkit` records five commands today:

- `docker mcp version`
- `docker mcp server ls --json`
- `docker mcp client ls --json`
- `docker mcp config read`
- `docker mcp feature ls`

`plan-docker-mcp-toolkit-apply` records seven commands today:

- the `node` invocation used to run `scripts/docker/sync-mcp-profiles.mjs --json`
- `docker mcp version`
- `docker mcp server ls --json`
- `docker mcp client ls --json`
- `docker mcp config read`
- `docker mcp feature ls`
- `docker mcp profile --help`

`apply-client-access` records four commands today:

- the `node` invocation used to run `scripts/install-default-access.mjs --dry-run`
- the `node` invocation used to run `scripts/install-default-access.mjs`
- the `node` invocation used to run
  `vendor/codex-claude-voltagent-client/scripts/codex-onboard.mjs`
- the `node` invocation used to run
  `vendor/codex-claude-voltagent-client/scripts/codex-doctor.mjs`

`audit-toolbox-control-surface` records two commands today:

- `corepack pnpm cli -- list-toolboxes --json {}`
- `corepack pnpm cli -- describe-toolbox --json ...`

`audit-active-toolbox-session` records two commands today:

- `corepack pnpm cli -- list-active-toolbox --json {}`
- `corepack pnpm cli -- list-active-tools --json {}`

`audit-toolbox-client-handoff` records two commands today:

- the `node` invocation used to run `scripts/doctor-default-access.mjs`
- `corepack pnpm cli -- list-active-toolbox --json {}`

`show-state` records no subprocesses.

## Client abstraction

The backend now resolves client definitions through a PowerShell module instead
of embedding Codex assumptions directly in `cli.ps1`.

Current fields per client definition:

- `clientName`
- `displayName`
- `accessKind`
- `defaultConfigPath`
- `defaultServerName`
- `adapterId`

Only `codex` is implemented today, but later clients can be added behind the
same contract without rewriting the backend operation flow.

## Why this matters for toolbox work

The toolbox plan will need:

- stable backend operations
- persisted installer state
- machine-readable reports
- a backend that can later add compile/sync operations without changing the
  presentation layer

This slice provides that groundwork without pre-committing to toolbox manifests,
leases, overlays, or Docker profile compilation before those runtime semantics
exist.

## Current non-goals

These are explicitly not implemented yet:

- GUI workflow
- clone/update orchestration
- clone/update repo preparation
- Docker apply/sync
- model-backed preparation
- additional client definitions beyond `codex`
- client-specific overlay generation
- Docker Desktop profile apply/sync through the installer backend
- Docker MCP Toolkit server/client/config/profile mutation through the installer backend
- toolbox activation or approval issuance through the installer backend
- installer-mediated rollback execution for the write plan
