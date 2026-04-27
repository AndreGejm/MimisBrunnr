# Windows Installer Backend

This repository now includes a Windows installer backend under
`scripts/installers/windows/`. It is the canonical Windows install path for
provisioning both Mimir access and the vendored Codex/VoltAgent client access
surface. It is still headless and contract-driven rather than a full GUI
bootstrap product.

Current entrypoints:

- `scripts/installers/windows/cli.ps1`: stable headless backend contract
- `scripts/installers/windows/installer.ps1`: thin wrapper over `cli.ps1`

Current supported operations:

- `detect-environment`
- `audit-install-surface`
- `prepare-repo-workspace`
- `audit-toolbox-assets`
- `prepare-toolbox-runtime`
- `audit-toolbox-control-surface`
- `audit-active-toolbox-session`
- `audit-toolbox-client-handoff`
- `audit-toolbox-rollout-readiness`
- `audit-docker-mcp-toolkit`
- `plan-docker-mcp-toolkit-apply`
- `plan-client-access`
- `apply-client-access`
- `show-state`

Replace `<REPO_ROOT>` in the command examples below with the absolute path to
your local checkout.

These operations are intentionally narrow. They do not clone the repo, prepare
model-backed mode, or provide a full GUI bootstrap yet. They currently:

- detect local prerequisite/tooling state through a PowerShell-native
  environment report
- wrap the existing default-access helper surfaces and persist installer state
- validate an existing local repo checkout and prepare a clean workspace
  through guarded `corepack pnpm install --frozen-lockfile` and
  `corepack pnpm build`
- validate the tracked `docker/mcp` manifest set through the same compiler and
  runtime-plan path used by the toolbox scripts
- persist a compiled toolbox runtime artifact for later Docker apply work
- audit the real toolbox discovery surface through `corepack pnpm cli -- list-toolboxes`
  and `describe-toolbox`
- audit the current active toolbox session through `list-active-toolbox` and
  `list-active-tools`
- audit reconnect handoff readiness for the selected installer client without
  issuing activation or approval requests
- aggregate toolbox rollout-readiness blockers across control-surface,
  active-session, handoff, governance-drift, and Docker apply-plan audits
- audit the installed Docker MCP Toolkit state through the live `docker mcp`
  surface
- compare the prepared toolbox runtime commands against the live Docker MCP
  Toolkit capability surface without mutating Docker
- expose a dry-run write plan for both the default Mimir access layer and the
  vendored Codex/VoltAgent access layer
- execute the tracked client-access helper path and normalize the combined
  post-apply result for:
  - default Mimir access
  - native Codex skill installation from the vendored subtree
  - home-global VoltAgent config bootstrap under `~/.codex/voltagent/client-config.json`
  - vendored post-install doctor

That gives later GUI and toolbox work a stable contract instead of forcing it to
parse ad-hoc logs or assume Codex-specific config paths internally.

## Commands

### Detect current environment capabilities

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation detect-environment `
  -Json
```

What this does:

- reports Windows PowerShell host availability
- reports PATH-resolved availability for Node, Git, Corepack, Python launcher,
  and Docker CLI
- reports Docker engine pipe readiness separately from Docker CLI discovery
- writes installer state files

### Audit current installer-facing access state

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation audit-install-surface `
  -RepoRoot <REPO_ROOT> `
  -Json
```

What this does:

- runs `scripts/doctor-default-access.mjs --json`
- resolves the current client definition before calling the adapter
- inspects launcher wrapper health
- inspects client configuration presence for the selected client
- inspects install manifest presence
- includes Docker tool manifest and `compose.tools.yml` status through the
  existing `default-access` helper
- writes installer state files

### Plan client-access writes without mutating the machine

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation plan-client-access `
  -RepoRoot <REPO_ROOT> `
  -Json
```

What this does:

- runs `scripts/install-default-access.mjs --dry-run`
- reports the exact apply command shape without executing it
- previews the client config write target for default Mimir access
- previews the installation manifest write target
- previews the vendored Codex/VoltAgent home-global config write target
- previews the vendored native skill link target under `~/.codex/skills`
- previews every compatibility launcher target under the selected bin directory
- marks which targets already exist
- marks which targets would receive timestamped backup copies on apply
- writes installer state files

### Prepare a clean repo workspace

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation prepare-repo-workspace `
  -RepoRoot <REPO_ROOT> `
  -Json
```

What this does:

- requires:
  - `package.json`
  - `pnpm-workspace.yaml`
  - `pnpm-lock.yaml`
- requires `package.json.name === "@mimir/workspace"`
- resolves `git rev-parse --show-toplevel`
- reads `git status --porcelain`
- blocks if the worktree is dirty
- on a clean repo, runs:
  - `corepack pnpm install --frozen-lockfile`
  - `corepack pnpm build`
  - `corepack pnpm vendor:codex-voltagent:build`
- verifies:
  - `apps/mimir-api/dist/main.js`
  - `apps/mimir-cli/dist/main.js`
  - `apps/mimir-mcp/dist/main.js`
  - `apps/mimir-control-mcp/dist/main.js`
  - `vendor/codex-claude-voltagent-client/dist/index.js`
- writes installer state files

What this does not do:

- it does not clone or update the repo yet
- it does not auto-stash or auto-clean a dirty repo
- it does not prepare arbitrary Node repositories; it is scoped to the tracked mimir layout

### Audit toolbox control discovery without activating a toolbox

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation audit-toolbox-control-surface `
  -RepoRoot <REPO_ROOT> `
  -Json
```

What this does:

- runs the real toolbox discovery commands through `corepack pnpm cli`
  - `list-toolboxes`
  - `describe-toolbox`
- reports the available toolbox ids, approval-required count, and one described
  toolbox summary
- proves the control surface is available without issuing activation or approval
  requests
- writes installer state files

### Audit the current active toolbox session

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation audit-active-toolbox-session `
  -RepoRoot <REPO_ROOT> `
  -Json
```

What this does:

- runs the real active-session commands through `corepack pnpm cli`
  - `list-active-toolbox`
  - `list-active-tools`
- reports the current workflow, active profile, client overlay metadata, and
  declared versus active versus suppressed tool counts
- shows whether the current client is still in bootstrap mode or already in an
  activated toolbox session
- writes installer state files

### Audit toolbox client handoff readiness

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation audit-toolbox-client-handoff `
  -RepoRoot <REPO_ROOT> `
  -ClientName codex `
  -Json
```

What this does:

- reuses the installer client-access health audit for the selected client
- reads the current active toolbox client metadata through `list-active-toolbox`
- reports reconnect handoff readiness for:
  - `MAB_TOOLBOX_ACTIVE_PROFILE`
  - `MAB_TOOLBOX_CLIENT_ID`
  - `MAB_TOOLBOX_SESSION_MODE`
  - optional `MAB_TOOLBOX_SESSION_POLICY_TOKEN`
- confirms whether the installer-selected client matches the runtime-selected
  client and whether the required handoff strategy metadata is present
- writes installer state files

What this does not do:

- it does not issue `request-toolbox-activation`
- it does not grant approval for `requiresApproval` toolboxes
- it does not mutate the active toolbox session

### Audit toolbox rollout readiness

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation audit-toolbox-rollout-readiness `
  -RepoRoot <REPO_ROOT> `
  -ClientName codex `
  -Json
```

What this does:

- combines the existing read-only installer audits for:
  - toolbox discovery readiness
  - active toolbox session shape
  - client reconnect handoff readiness
  - Docker MCP governance drift
  - Docker MCP apply-plan compatibility
- reports whether the selected client is still in bootstrap mode or already
  auditing an activated toolbox session
- surfaces blocked rollout areas such as governance drift, missing reconnect
  metadata, or missing Docker profile support
- writes installer state files

What this does not do:

- it does not activate a toolbox
- it does not approve an admin toolbox
- it does not mutate Docker Toolkit state

### Audit Docker toolbox assets without mutating Docker Desktop

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation audit-toolbox-assets `
  -RepoRoot <REPO_ROOT> `
  -Json
```

What this does:

- runs `scripts/docker/audit-toolbox-assets.mjs --json`
- compiles the tracked `docker/mcp` manifest set through the real toolbox
  policy compiler
- compiles the deterministic Docker runtime plan from that policy
- reports manifest counts for categories, trust classes, servers, profiles,
  intents, clients, and tools
- reports whether the required bootstrap profile and `mimir-control` server are
  present
- writes installer state files

### Prepare a compiled toolbox runtime artifact

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation prepare-toolbox-runtime `
  -RepoRoot <REPO_ROOT> `
  -Json
```

What this does:

- runs `scripts/docker/sync-mcp-profiles.mjs --json`
- compiles the tracked `docker/mcp` manifest set into the deterministic Docker
  runtime plan
- writes the compiled plan to `%LOCALAPPDATA%\Mimir\installer\toolbox-runtime-plan.json`
  by default
- reports the manifest revision, generated timestamp, profile count, and server
  count in the installer envelope
- writes installer state files

What this does not do:

- it does not mutate Docker Desktop profiles
- it does not create or import MCP gateway profiles yet
- it is a prepare-only boundary for later Docker apply work

### Plan Docker MCP Toolkit apply work without mutating Docker

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation plan-docker-mcp-toolkit-apply `
  -RepoRoot <REPO_ROOT> `
  -Json
```

What this does:

- runs `scripts/docker/sync-mcp-profiles.mjs --json`
- reads the current Docker MCP Toolkit state through the same live commands used
  by `audit-docker-mcp-toolkit`
- probes whether the installed Toolkit exposes profile-specific help for
  `docker mcp profile`
- reports the prepared `apply.commands[]` from the runtime compiler
- reports descriptor-only `blockedServers[]` from the compiled plan and keeps
  the plan blocked when selected profiles contain servers with no safe catalog
  apply target
- returns a reviewed-execution plan only; it never shells out into those apply
  commands
- writes installer state files

What this currently reports on Docker MCP Toolkit `v0.40.x`:

- the runtime compiler emits `docker mcp profile create ...` style commands
- profile subcommand support alone is not enough for compatibility; selected
  descriptor-only peer servers such as `dockerhub-read` and `grafana-observe`
  keep the plan at `user_action_required`
- the current live Toolkit surface may still return exit code `0` for
  `docker mcp profile --help` while printing only the generic top-level help;
  the installer treats that as incompatible, not as working profile support
- the installer therefore returns `user_action_required` with
  `docker_mcp_toolkit_apply_plan_blocked` instead of pretending Docker apply is
  ready

Why this exists:

- it gives the future GUI and bootstrap flow an honest contract boundary
- it proves whether the compiled runtime plan and the installed Toolkit speak
  the same command language
- it avoids adding unsafe Docker mutation before the Toolkit contract is
  settled

### Audit Docker MCP Toolkit state

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation audit-docker-mcp-toolkit `
  -RepoRoot <REPO_ROOT> `
  -Json
```

What this does:

- runs the live Docker Toolkit commands:
  - `docker mcp version`
  - `docker mcp server ls --json`
  - `docker mcp client ls --json`
  - `docker mcp config read`
  - `docker mcp feature ls`
- reports enabled server count
- reports configured and connected client counts
- includes the current toolkit config snapshot and feature snapshot as raw text
- writes installer state files

What this does not do:

- it does not enable or disable Docker MCP servers
- it does not connect or disconnect clients
- it does not apply the prepared toolbox runtime plan into Docker Toolkit state

### Apply client-access through the tracked repo helper

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation apply-client-access `
  -RepoRoot <REPO_ROOT> `
  -Json
```

What this does:

- runs the same dry-run plan path first so the backend can keep a stable write
  target model
- executes `scripts/install-default-access.mjs`
- executes vendored Codex/VoltAgent onboarding with the home-global config as the default target
- executes vendored Codex/VoltAgent doctor for the selected workspace
- records the actual commands used
- reports the combined post-apply result for:
  - default Mimir access health
  - vendored Codex/VoltAgent onboarding status
  - vendored Codex/VoltAgent doctor status
- records any new timestamped backup files created for config or manifest writes
- writes installer state files

What stays optional:

- Docker Desktop
- Docker MCP Toolkit apply
- toolbox runtime apply
- vendored plugin-shell installation

### Read persisted installer state

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/cli.ps1 `
  -Operation show-state `
  -Json
```

What this does:

- reads the last persisted installer report
- reads the installer session summary
- does not rerun Node helpers

### Wrapper entrypoint

`installer.ps1` is currently only a wrapper:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/installers/windows/installer.ps1 `
  -Operation audit-install-surface `
  -Json
```

It exists so later GUI work can replace the presentation layer without changing
the backend contract.

## Arguments

Shared arguments accepted by `cli.ps1`:

- `-Operation`
- `detect-environment`
- `audit-install-surface`
- `prepare-repo-workspace`
- `audit-toolbox-assets`
- `prepare-toolbox-runtime`
- `audit-docker-mcp-toolkit`
- `plan-docker-mcp-toolkit-apply`
- `plan-client-access`
- `apply-client-access`
- `show-state`
- `audit-toolbox-control-surface`
- `audit-active-toolbox-session`
- `audit-toolbox-client-handoff`
- `audit-toolbox-rollout-readiness`
- `-RepoRoot`
  - defaults to the tracked repository root resolved from the script location
- `-StateRoot`
  - defaults to `%LOCALAPPDATA%\Mimir\installer`
- `-ClientName`
  - defaults to `codex`
  - current backend supports `codex` only, but the contract is no longer
    hard-wired to a Codex-only internal module
- `-ConfigPath`
  - defaults to the config path declared by the selected client definition
- `-WorkspacePath`
  - defaults to `<RepoRoot>`
  - used for the vendored post-install doctor and runtime probe
- `-HomeRoot`
  - defaults to the current user home
  - used for native Codex skill installation under `~/.codex/skills`
- `-BinDir`
  - defaults to `%APPDATA%\npm`
- `-ManifestPath`
  - defaults to `%USERPROFILE%\.mimir\installation.json`
- `-ToolboxManifestDir`
  - defaults to `<RepoRoot>\docker\mcp`
- `-ToolboxRuntimePlanPath`
  - defaults to `<StateRoot>\toolbox-runtime-plan.json`
- `-ServerName`
  - defaults to `mimir`
- `-Json`
  - emits the full result envelope as JSON

## Persisted state

By default the backend writes:

- `%LOCALAPPDATA%\Mimir\installer\last-report.json`
- `%LOCALAPPDATA%\Mimir\installer\install-session.json`
- `%LOCALAPPDATA%\Mimir\installer\history\<timestamp>-<operation>.json`

Use `-StateRoot` to redirect this during tests or local experiments.

## Result shape

Each operation returns the same top-level envelope fields:

- `schemaVersion`
- `operationId`
- `mode`
- `recordedAt`
- `repoRoot`
- `stateRoot`
- `status`
- `reasonCode`
- `message`
- `details`
- `artifactsWritten`
- `backupsCreated`
- `commandsRun`
- `nextActions`

The exact contract and status semantics are documented in
[`windows-installer-contracts.md`](./windows-installer-contracts.md).

## Current limitations

- no GUI workflow yet
- no clone or update flow
- no clone/update repo bootstrap yet; only existing local repo preparation is implemented
- no Docker preparation flow beyond inspection or manifest validation
- no Docker Toolkit or Docker Desktop mutation through the installer backend
- no model-backed preparation flow
- only one client definition is implemented today: `codex`
- `audit-install-surface` still uses the existing default-access/Codex adapter
  behind the new generic client layer
- `prepare-repo-workspace` currently requires a clean git worktree and has no
  repair-mode override yet
- `apply-client-access` currently delegates to the tracked default-access Node
  helper plus vendored Node onboarding/doctor scripts rather than performing
  file mutation directly in PowerShell
- `audit-toolbox-assets` validates toolbox manifests and runtime-plan shape, but
  it does not apply Docker Desktop profile changes yet
- `prepare-toolbox-runtime` persists the compiled runtime plan, but the apply
  step still needs a separate deterministic Docker mutation contract
- `audit-toolbox-control-surface`, `audit-active-toolbox-session`,
  `audit-toolbox-client-handoff`, and `audit-toolbox-rollout-readiness` are
  read-only checks over the real toolbox CLI and Docker planning surfaces; they
  do not activate toolboxes or issue approvals
- `audit-docker-mcp-toolkit` reads the current Docker Toolkit state, but it does
  not mutate enabled servers, client connections, or config
- `plan-docker-mcp-toolkit-apply` is intentionally plan-only and is currently
  expected to block against Docker Toolkit builds that do not expose
  `docker mcp profile`

This backend exists so those later surfaces can land on stable contracts and
persisted state instead of starting from script-specific behavior.
