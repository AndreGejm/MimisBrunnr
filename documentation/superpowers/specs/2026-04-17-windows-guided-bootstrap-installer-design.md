# Windows Guided Bootstrap Installer Design

## Goal

Design a Windows-first, manifest-driven installer inside the `mimir` repository that gives new and existing users one guided place to:

- validate prerequisites
- prepare or repair a local `mimir` workspace
- configure launchers, Codex MCP access, and install metadata
- prepare Docker-managed tools such as RTK and aider
- optionally prepare model-backed mode through Qdrant and Docker Model Runner / Ollama-compatible checks

The installer must be safe to rerun, must expose deterministic machine-readable backend results, and must not become a second setup system that drifts away from the repository's real runtime surfaces.

## Scope

### In scope

- Windows-only installer architecture
- PowerShell GUI entrypoint with no extra runtime beyond stock Windows PowerShell
- shared headless backend using the same backend contracts as the GUI
- manifest-driven tool definitions for Docker-managed tools
- guided prerequisite detection and explicit user-action guidance
- existing local workspace support and clone/update support
- configuration backup, merge, verification, and install-state persistence
- baseline install path that succeeds without model-backed dependencies
- separate model-backed preparation path

### Out of scope

- cross-platform installation
- silent unattended installation of every third-party prerequisite
- replacing normal developer workflows such as direct `pnpm` usage
- treating `package.json` scripts as installer APIs
- making model-backed mode mandatory for baseline success
- generic installer support for unrelated repositories in v1

## Problem Statement

The repository already contains useful setup and diagnostic surfaces, but they are not yet assembled into a stable installer-grade system for Windows users.

Current repo surfaces include:

- launcher and MCP setup helpers in `scripts/`
- Docker tool metadata under `docker/tool-registry/`
- Docker compose/build entrypoints in `package.json`
- setup and operations documentation under `documentation/`

These surfaces are useful, but they are not by themselves a complete Windows installer contract. A GUI built directly over arbitrary scripts would inherit ambiguity, free-form output, and unclear side-effect boundaries. The installer therefore needs a stricter architecture:

- PowerShell backend modules become the orchestration authority on Windows
- existing scripts are only reused through explicit adapter wrappers
- manifests remain declarative input only
- GUI and headless modes share the same backend operations and structured result envelopes

## Design Constraints

### Constraint 1: Windows-first, low-prerequisite execution

The installer must run on stock Windows PowerShell without requiring Node, Python, .NET desktop packaging, or any extra GUI framework just to launch the installer itself.

This is a low-prerequisite design, not truly no-prerequisite. Windows PowerShell version, execution policy, path mutation, script blocking, proxy/TLS conditions, and permission limits still matter and must be detected explicitly.

### Constraint 2: No duplicate setup authority

The installer must not create a second, divergent setup system.

It should orchestrate stable repo interfaces and backend operations, not duplicate runtime logic in a GUI-specific codepath.

### Constraint 3: Headless parity is mandatory

Every GUI action must map to the same backend operation used by a headless entrypoint.

If an action cannot be expressed as a backend operation with a structured result envelope, it is not installer-ready.

### Constraint 4: Model-backed mode is optional

The installer must establish a valid baseline install without Qdrant or model-backed infrastructure.

Model-backed preparation is a separate, explicit path with its own dependency checks and failure reporting.

### Constraint 5: Idempotency and rollback matter more than happy-path speed

Installer logic must be safe to rerun and must surface partial-failure state explicitly. Config writes must be backed up and verified. No step may assume a clean or first-run environment.

## Architecture Overview

The installer architecture is a constrained version of a script-first bootstrap with a thin GUI wrapper.

### Authority model

- PowerShell backend modules are the installer orchestration authority on Windows.
- The GUI is a presentation layer only.
- The headless CLI is a presentation layer only.
- Existing Node scripts are implementation details behind PowerShell adapter wrappers.
- Tool manifests are declarative desired-state input only.
- Repo `package.json` scripts remain developer entrypoints, not installer contracts.

### Repository layout

Recommended new layout:

```text
scripts/
  installers/
    windows/
      installer.ps1
      cli.ps1
      lib/
        environment-detection.ps1
        repo-bootstrap.ps1
        manifest-loader.ps1
        tool-preparation.ps1
        config-management.ps1
        data-root-management.ps1
        model-mode.ps1
        reporting.ps1
        state-store.ps1
        adapters/
          default-access.ps1
          codex-mcp.ps1
          launchers.ps1
          package-scripts.ps1
      manifests/
        tools.json
documentation/
  setup/
    windows-installer.md
    windows-installer-contracts.md
```

### Presentation layers

#### `installer.ps1`

GUI entrypoint only.

Responsibilities:

- render installer screens and status
- dispatch backend operations
- display structured backend results
- collect user choices and confirmations

Non-responsibilities:

- direct environment mutation
- direct config parsing or merging
- interpreting free-form script logs

#### `cli.ps1`

Headless entrypoint only.

Responsibilities:

- accept noninteractive or semi-interactive arguments
- execute the same backend operations as the GUI
- emit the same result envelopes and reports

This ensures automation, repair flows, and future scheduled setup audits are possible without GUI-only logic.

## Backend Modules

Each backend module owns one bounded concern.

### `environment-detection.ps1`

Responsibilities:

- detect Git
- detect Node and version floor
- detect Corepack and `pnpm` usability
- detect Python and interpreter alias behavior
- detect Docker Desktop installation
- detect Docker engine running state
- optionally detect Qdrant reachability
- optionally detect Docker Model Runner / Ollama-compatible endpoint reachability

Required outputs:

- detected version
- resolved executable path
- support status
- reason code when missing or incompatible

### `repo-bootstrap.ps1`

Responsibilities:

- validate existing local repo path
- detect wrong repo, dirty repo, unexpected branch/worktree state
- clone/update from GitHub when selected
- validate package manager assumptions
- install dependencies
- build required targets only
- verify built outputs exist

### `lib/adapters/*.ps1`

Responsibilities:

- wrap audited repo scripts
- normalize their output into installer result envelopes
- enforce argument validation and error classification
- record side effects and write targets

These adapter modules are where repo scripts become installer-safe interfaces.

### `manifest-loader.ps1`

Responsibilities:

- load static tool definitions
- validate schema and semantic constraints
- reject duplicate IDs and invalid capability combinations

### `tool-preparation.ps1`

Responsibilities:

- validate Docker tool manifests
- prepare Docker-managed tools such as RTK and aider
- run health checks when possible
- record build/pull/validation outcomes

### `config-management.ps1`

Responsibilities:

- preview config write targets
- create backups before mutation
- merge or write supported config files
- verify persisted results
- classify conflicts and write failures

### `data-root-management.ps1`

Responsibilities:

- select default or custom data root
- validate path safety and writability
- create required directory structure
- support session-only vs persisted `MAB_DATA_ROOT`

### `model-mode.ps1`

Responsibilities:

- check Qdrant
- check Docker Model Runner / Ollama-compatible endpoint
- validate required models
- prepare Docker MCP session assets when requested

This module is isolated from the baseline success path.

### `reporting.ps1`

Responsibilities:

- aggregate operation results
- render machine-readable reports
- render human-readable summaries
- generate copy-paste verification commands

### `state-store.ps1`

Responsibilities:

- persist current session checkpoint
- persist last known observed-state report
- persist timestamped history snapshots
- support repair and resume flows

Default storage location:

- `%LOCALAPPDATA%\\Mimir\\installer\\`

Override support:

- test and development runs may redirect state to a custom path explicitly, but runtime defaults must stay outside the tracked repository

## Reuse Audit for Existing Repo Surfaces

Existing setup scripts were audited for installer suitability.

### `scripts/doctor-default-access.mjs`

Classification: `safe_adapter`

Reasons:

- exposes JSON output
- bounded purpose
- suited to detection/reporting

Installer use:

- access-health checks
- post-write verification
- final report evidence

### `scripts/install-default-access.mjs`

Classification: `adapter_with_wrapper`

Reasons:

- useful behavior and dry-run JSON path exist
- writes multiple config targets
- side effects must be normalized by PowerShell before GUI use

Installer use:

- only behind an adapter wrapper
- never as a GUI-native contract

### `scripts/install-default-codex-mcp.mjs`

Classification: `adapter_with_wrapper`

Reasons:

- useful and bounded
- dry-run path exists
- still needs normalized result handling and backup accounting

### `scripts/install-mimir-launchers.mjs`

Classification: `adapter_with_wrapper`

Reasons:

- useful write surface
- dry-run path is structured
- non-dry-run success path is human text, not installer-grade structured output

### Root `package.json` scripts

Classification: `not_installer_safe` as direct installer interfaces

Examples:

- `build`
- `docker:up`
- `docker:mcp:build`

These remain valid subprocess targets inside backend modules, but the installer must classify and normalize their outcomes itself rather than treating them as public setup APIs.

## Manifest Model

The installer is manifest-driven, but manifests are declarative only.

### Static tool manifest

Location:

- `scripts/installers/windows/manifests/tools.json`

Purpose:

- define desired tool metadata
- define how tools are detected
- define user guidance for missing dependencies
- define integration requirements

Each tool definition should include:

- `id`
- `displayName`
- `required`
- `defaultMode` such as `docker_managed`
- `detection`
- `prerequisites`
- `installGuidance`
- `postInstallVerification`
- `repoIntegration`

Example categories:

- Docker Desktop
- Git
- Node
- Python
- RTK
- aider
- Qdrant
- Docker Model Runner / Ollama-compatible endpoint

### Separate runtime state files

Static manifests must not contain:

- current install status
- timestamps
- prior failures
- operation history

Those belong in state files under:

- `%LOCALAPPDATA%\\Mimir\\installer\\`

Recommended runtime state files:

- `%LOCALAPPDATA%\\Mimir\\installer\\install-session.json`
- `%LOCALAPPDATA%\\Mimir\\installer\\last-report.json`
- `%LOCALAPPDATA%\\Mimir\\installer\\history\\`

The repository may include sample state fixtures for tests, but real observed state, audit history, and resume checkpoints must not be written into tracked repo paths by default.

## State Model

The installer needs explicit state, not inferred logs.

### State layers

1. Desired state
- static manifests
- version floors
- required vs optional capabilities

2. Observed machine state
- detected installations
- versions
- repo validity
- build outputs
- config presence

3. Operation state
- outcome of a single backend action

4. Session state
- current mode
- completed steps
- pending user actions
- resume checkpoint

### Capability states

Recommended per-capability states:

- `NotDetected`
- `Detected`
- `NeedsVersionUpgrade`
- `NeedsUserAction`
- `Ready`
- `ConfigBackedUp`
- `ConfigWritten`
- `BuildPrepared`
- `BuildFailed`
- `DockerPrepared`
- `ModelModeReady`
- `PartiallyConfigured`
- `Validated`

These are attached per concern. Example:

- Docker Desktop: `Detected`
- Node: `Ready`
- repo build: `BuildPrepared`
- Codex MCP: `ConfigWritten`
- model endpoint: `NeedsUserAction`

## Result Envelope Contract

Every backend action must emit the same structured envelope shape.

```json
{
  "operationId": "detect-node",
  "status": "success",
  "reasonCode": "detected_supported_version",
  "message": "Node 24.14.0 detected on PATH.",
  "details": {
    "version": "24.14.0",
    "path": "C:\\Dev\\Tools\\Nodejs\\node.exe"
  },
  "artifactsWritten": [],
  "backupsCreated": [],
  "commandsRun": [
    {
      "command": "node --version",
      "exitCode": 0
    }
  ],
  "nextActions": []
}
```

### Required fields

- `operationId`
- `status`
- `reasonCode`
- `message`
- `details`
- `artifactsWritten`
- `backupsCreated`
- `commandsRun`
- `nextActions`

### Allowed status values

- `success`
- `success_with_warnings`
- `already_configured`
- `user_action_required`
- `retryable_failure`
- `fatal_failure`
- `skipped`
- `not_applicable`

### Why this contract is mandatory

- GUI can render exact state without log parsing
- headless mode can serialize exact results
- tests can assert reason codes and artifacts
- partial failure and resume become deterministic

## Installer Modes

Supported operation modes:

- `gui_interactive`
- `cli_interactive`
- `cli_noninteractive`
- `repair_existing_install`
- `audit_only`

These are not just UX flags. They control what actions are allowed and how missing prerequisites are reported.

## Installer Flow

### 1. Entry mode selection

Mode determines:

- interaction style
- whether writes are allowed
- whether repair semantics are enabled

### 2. Workspace selection

User chooses:

- existing local repo path
- or clone/update from GitHub

Failure branches:

- path is not a git repo
- path points to a different repo
- repo is dirty
- repo is on an unexpected branch
- clone target already exists

Expected backend behavior:

- report exact repo status
- do not mutate dirty or ambiguous repo state silently
- require confirmation for update/repair paths

### 3. Data-root selection

Default:

- `%USERPROFILE%\Mimisbrunnr`

Override:

- custom user-selected path

Failure branches:

- path not writable
- path resolves to a file
- path is unsafe or unsupported for the selected mode

### 4. Prerequisite scan

Baseline checks:

- Git
- Node with version floor
- Corepack and `pnpm` usability
- Python
- Docker Desktop installed
- Docker engine running

Optional model-mode checks:

- Qdrant reachable
- model endpoint reachable
- required model IDs present

### 5. Repo validation and preparation

Actions:

- validate repo structure
- validate package manager assumptions
- install dependencies
- build required targets
- verify built entrypoints exist

Failure branches:

- network failure
- install failure
- build failure
- missing generated outputs

### 6. Local access setup

Actions:

- preview write targets
- backup configs
- install launchers
- configure Codex MCP
- write install manifest
- optionally persist `MAB_DATA_ROOT`

Failure branches:

- config merge conflict
- write denied
- verification failure after write

### 7. Docker tool preparation

Actions:

- validate tool manifests
- prepare RTK and aider Docker assets
- run health checks where possible

Failure branches:

- Docker not running
- invalid tool manifest
- build failure
- unsupported host or env requirements

### 8. Optional model-backed preparation

Actions:

- validate Qdrant
- validate model endpoint
- validate model inventory
- prepare MCP session image

Failure branches:

- missing dependency
- endpoint unreachable
- incomplete model set

This phase must never invalidate a successful baseline install.

### 9. Final verification and reporting

Actions:

- rerun doctor/status operations
- generate structured and human-readable reports
- show exact next actions and verification commands

## Idempotency Rules

- every write step must check current state first
- launcher installation must not duplicate entries
- config writes must back up first and verify after write
- repo preparation must not reclone over a valid existing repo
- Docker preparation must not rebuild blindly unless repair or rebuild was requested
- persisted `MAB_DATA_ROOT` changes must be explicit and reversible

## Rollback and Partial Failure Policy

### Automatic rollback

Allowed for:

- config writes within a single operation when verification fails

### No automatic rollback

Not attempted for:

- dependency installs
- Docker image builds
- external prerequisite installers

Those cases must be reported as partial state with:

- exact artifacts written
- exact commands run
- backups created
- manual cleanup or retry actions

## Security and Trust Boundaries

- never store secrets in the repo
- never hardcode tokens into manifests or installer logic
- never silently overwrite user configs
- always show write targets before mutation
- never assume admin rights
- never escalate privileges implicitly
- never treat manifest content as executable logic
- never decide success by parsing human-oriented logs alone

## Acceptance Criteria

### Architecture

- PowerShell backend modules are the only Windows installer orchestration authority.
- GUI and headless flows call the same backend operations.
- existing repo scripts are reused only through adapter modules.
- optional model-backed setup is isolated from baseline install success.

### Backend contracts

- every backend action returns the same result envelope
- every backend action exposes stable reason codes
- every backend action is runnable noninteractively
- every backend action records commands, artifacts, backups, and next steps

### Operational behavior

- re-running the installer is safe
- config writes back up and verify
- partial failures leave resumable state
- installer distinguishes success, already configured, user action required, retryable failure, fatal failure, and unsupported environment

### User outcomes

- new Windows users can reach a valid baseline `mimir` install from one place
- existing local workspace users can use the same installer without recloning
- RTK and aider are Docker-managed by default
- final report contains copy-paste verification commands

### Documentation

- README routes Windows-first users to the installer
- installer guide exists
- installer contracts/state-model guide exists
- docs clearly separate baseline setup from model-backed preparation

## Test Plan

### Backend unit tests

Test PowerShell modules for:

- detection logic
- config merge/write logic
- manifest validation
- state persistence
- result-envelope normalization

### Adapter contract tests

For each reused repo script:

- dry-run contract shape
- noninteractive invocation behavior
- side-effect boundary verification
- failure classification

### Headless integration tests

Exercise:

- audit-only mode
- existing local repo mode
- clone/update mode
- repair mode

Assert:

- reason codes
- idempotency
- artifact tracking

### GUI integration tests

Exercise:

- screen transitions
- user-action-required flows
- success/failure summaries
- backup preview and write-target preview

### Scenario tests

- fresh machine with missing prerequisites
- local workspace already configured
- dirty repo
- Docker installed but not running
- model-backed path selected with missing Qdrant
- rerun after partial config success

## Phased Implementation Plan

### Phase 1: Contracts and state

- define PowerShell module boundaries
- define result envelope format
- define state files
- define static manifest schema
- document adapter audit rules

### Phase 2: Headless backend

- implement backend modules
- implement `cli.ps1`
- verify idempotency and result contracts

### Phase 3: GUI shell

- implement PowerShell GUI over backend commands only

### Phase 4: Docker tool preparation

- add RTK and aider Docker preparation using manifest-driven definitions

### Phase 5: Optional model-backed mode

- add Qdrant and model endpoint preparation
- add Docker MCP session preparation checks

### Phase 6: Documentation and readiness

- update README
- add installer guide
- add contracts guide
- add troubleshooting notes

## Repo Assumptions That Must Be Verified Before Implementation

- `scripts/doctor-default-access.mjs` remains JSON-capable and stable
- `scripts/install-default-access.mjs` continues to expose dry-run JSON and bounded side effects
- `scripts/install-default-codex-mcp.mjs` remains suitable for adapter wrapping
- `scripts/install-mimir-launchers.mjs` remains dry-run structured and safe to wrap
- the current root build target remains `corepack pnpm build`
- Docker tool registry shape in `docker/tool-registry/*.json` remains authoritative for RTK and aider metadata

If any of those assumptions fail during implementation, adapters or replacement backend logic must be updated rather than shifting logic into the GUI.

## Evidence Status

### Verified facts

- Existing setup helpers live under `scripts/`.
- `scripts/doctor-default-access.mjs` exposes structured JSON output and bounded diagnostics.
- `scripts/install-default-access.mjs`, `scripts/install-default-codex-mcp.mjs`, and `scripts/install-mimir-launchers.mjs` are reusable only through installer adapters.
- RTK and aider are already represented in `docker/tool-registry/*.json`.
- The repo already documents installation, Docker operation, and runtime access separately.

### Assumptions

- Windows PowerShell remains the baseline launcher for the first implementation.
- Existing Node setup scripts will not regress materially before implementation begins.

### TODO gaps

- Final manifest schema and reason-code catalog need to be written in the contracts document during implementation planning.
