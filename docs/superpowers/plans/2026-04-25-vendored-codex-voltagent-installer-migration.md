# Vendored Codex VoltAgent Installer Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendor `codex-claude-voltagent-client` into MimisBrunnr and extend the existing Windows installer so one installer provisions both Mimir access and the Codex/VoltAgent client access path.

**Architecture:** Keep the external client mostly intact as a vendored subtree under `vendor/codex-claude-voltagent-client/`, then use a thin Windows-installer adapter that calls the vendored Node entrypoints for onboarding, doctor, and smoke. Do not collapse the runtime boundary: Mimir still owns memory, retrieval, governed writes, and local execution, while the vendored Codex/Claude VoltAgent client still owns skills, workspace roots, and Claude profile selection.

**Tech Stack:** TypeScript, Node.js, pnpm workspaces, PowerShell installer backend, Vitest, Node test runner, Codex native skill discovery, `@voltagent/core`

---

## Locked file structure and responsibilities

### Vendored subtree

- Create: `vendor/codex-claude-voltagent-client/`
  - canonical vendored runtime/config/router/escalation client surface
- Create: `vendor/codex-claude-voltagent-client/VENDORED_FROM.md`
  - provenance and local patch notes

### Monorepo integration points

- Modify: `pnpm-workspace.yaml`
  - make the vendored client a workspace package so root install resolves its dependencies
- Modify: `package.json`
  - add helper scripts for building, testing, onboarding, doctor, and smoke of the vendored client from the monorepo root

### Windows installer integration

- Modify: `scripts/installers/windows/lib/client-access.ps1`
  - combine current `default-access` behavior with vendored Codex/VoltAgent access behavior under the same `codex` client
- Create: `scripts/installers/windows/lib/adapters/codex-voltagent-access.ps1`
  - thin PowerShell adapter that shells into vendored Node package scripts
- Modify: `scripts/installers/windows/cli.ps1`
  - add `-WorkspacePath` and keep `plan-client-access` / `apply-client-access` reporting both sub-surfaces
- Modify: `scripts/installers/windows/lib/repo-bootstrap.ps1`
  - make repo preparation build the vendored client so runtime-probe based smoke can be release-honest

### Installer-facing docs and tests

- Modify: `documentation/setup/installation.md`
- Modify: `documentation/setup/windows-installer.md`
- Modify: `tests/e2e/windows-installer-cli.test.mjs`

### Transitional external-repo marker

- Modify: `F:\Dev\scripts\codex-claude-voltagent-client\README.md`
  - mark the external repo transitional and point at MimisBrunnr as canonical

## Task 1: Vendor the external client into the monorepo and make it workspace-installable

**Files:**
- Create: `vendor/codex-claude-voltagent-client/` (copied subtree)
- Create: `vendor/codex-claude-voltagent-client/VENDORED_FROM.md`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `scripts/installers/windows/lib/repo-bootstrap.ps1`

- [ ] **Step 1: Copy the external client into the vendored subtree**

Run:

```powershell
New-Item -ItemType Directory -Force -Path "F:\Dev\scripts\Mimir\mimir\vendor" | Out-Null
Copy-Item -Recurse -Force `
  "F:\Dev\scripts\codex-claude-voltagent-client" `
  "F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client"
```

Expected:
- `vendor/codex-claude-voltagent-client/` exists
- the vendored tree contains `src/`, `skills/`, `plugins/`, `scripts/`, `tests/`, and `package.json`

- [ ] **Step 2: Add provenance tracking**

Create:

```md
<!-- F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\VENDORED_FROM.md -->
# Vendored From

- Source repository: `F:\Dev\scripts\codex-claude-voltagent-client`
- Source branch: `feature/codex-default-voltagent`
- Imported commit: `30cb360`
- Canonical release repository: `F:\Dev\scripts\Mimir\mimir`
- Allowed local changes:
  - repo-root and cwd resolution fixes
  - monorepo package-script integration
  - installer handoff/reporting integration
  - monorepo smoke and docs path fixes
```

- [ ] **Step 3: Make the vendored client installable from the monorepo root**

Update:

```yaml
# F:\Dev\scripts\Mimir\mimir\pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "vendor/codex-claude-voltagent-client"
```

Update:

```json
// F:\Dev\scripts\Mimir\mimir\package.json
{
  "scripts": {
    "vendor:codex-voltagent:build": "pnpm --dir vendor/codex-claude-voltagent-client build",
    "vendor:codex-voltagent:typecheck": "pnpm --dir vendor/codex-claude-voltagent-client typecheck",
    "vendor:codex-voltagent:test": "pnpm --dir vendor/codex-claude-voltagent-client test",
    "vendor:codex-voltagent:onboard": "pnpm --dir vendor/codex-claude-voltagent-client codex:onboard",
    "vendor:codex-voltagent:doctor": "pnpm --dir vendor/codex-claude-voltagent-client codex:doctor",
    "vendor:codex-voltagent:smoke": "pnpm --dir vendor/codex-claude-voltagent-client codex:smoke"
  }
}
```

- [ ] **Step 4: Run workspace install and vendored client verification**

Run:

```powershell
corepack pnpm install
corepack pnpm vendor:codex-voltagent:typecheck
corepack pnpm vendor:codex-voltagent:build
corepack pnpm --dir vendor/codex-claude-voltagent-client exec vitest run `
  tests/scripts/codex-onboard.test.ts `
  tests/scripts/codex-doctor.test.ts `
  tests/smoke/codex-onboarding-smoke.test.ts
```

Expected:
- install succeeds from the monorepo root
- vendored typecheck/build succeed
- vendored onboarding/doctor/smoke tests pass inside the monorepo

- [ ] **Step 5: Extend repo preparation to build the vendored client**

Modify the repo-bootstrap flow so the prepare step runs both:

```powershell
corepack pnpm build
corepack pnpm vendor:codex-voltagent:build
```

and verifies:

```text
F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\dist\index.js
```

Update the existing `prepare-repo-workspace` contract test in:

```js
// F:\Dev\scripts\Mimir\mimir\tests\e2e\windows-installer-cli.test.mjs
// assert the fake corepack stub accepts `pnpm vendor:codex-voltagent:build`
// and that the vendored dist/index.js output is required
```

- [ ] **Step 6: Commit**

```powershell
git add pnpm-workspace.yaml package.json `
        scripts/installers/windows/lib/repo-bootstrap.ps1 `
        tests/e2e/windows-installer-cli.test.mjs `
        vendor/codex-claude-voltagent-client
git commit -m "feat: vendor codex voltagent client"
```

## Task 2: Add a thin Windows-installer adapter for vendored Codex/VoltAgent access

**Files:**
- Create: `scripts/installers/windows/lib/adapters/codex-voltagent-access.ps1`
- Modify: `scripts/installers/windows/lib/client-access.ps1`
- Modify: `scripts/installers/windows/cli.ps1`
- Test: `tests/e2e/windows-installer-cli.test.mjs`

- [ ] **Step 1: Write a failing installer contract test for the vendored access surface**

Add a new test block to:

```js
// F:\Dev\scripts\Mimir\mimir\tests\e2e\windows-installer-cli.test.mjs
test("windows installer cli plan-client-access includes vendored codex voltagent writes", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  // arrange a temp config/bin/state root plus a workspace path and assert that the response includes
  // both mimir_access and codex_voltagent_access sections
});
```

- [ ] **Step 2: Run the targeted installer test to confirm the missing surface**

Run:

```powershell
node --test tests/e2e/windows-installer-cli.test.mjs
```

Expected:
- FAIL because `plan-client-access` currently only reports the `default-access`/Mimir layer

- [ ] **Step 3: Implement the vendored client adapter**

Create:

```powershell
# F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\lib\adapters\codex-voltagent-access.ps1
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "package-scripts.ps1")

function Invoke-CodexVoltAgentPlanAdapter {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$WorkspacePath
  )

  return Invoke-InstallerCorepackPnpmCommand `
    -RepoRoot $RepoRoot `
    -PnpmArguments @(
      "--dir",
      "vendor/codex-claude-voltagent-client",
      "codex:doctor",
      "--",
      "--workspace",
      $WorkspacePath
    )
}
```

Modify:

```powershell
# F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\lib\client-access.ps1
. (Join-Path $PSScriptRoot "adapters\codex-voltagent-access.ps1")
```

Modify:

```powershell
# F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\cli.ps1
param(
  ...
  [string]$WorkspacePath = ""
)
```

and require `WorkspacePath` for:

- `plan-client-access`
- `apply-client-access`

Then extend the returned `clientAccess` and `writePlan` shapes so they include:

```powershell
[pscustomobject]@{
  mimirAccess = ...
  codexVoltAgentAccess = [pscustomobject]@{
    skillInstallPath = Join-Path $HOME ".codex\skills\voltagent-default"
    vendoredClientRoot = Join-Path $RepoRoot "vendor\codex-claude-voltagent-client"
    workspacePath = $WorkspacePath
    workspaceConfigTarget = Join-Path $WorkspacePath "client-config.json"
  }
}
```

- [ ] **Step 4: Re-run the targeted installer contract**

Run:

```powershell
node --test tests/e2e/windows-installer-cli.test.mjs
```

Expected:
- the new test now passes
- no existing installer contract tests regress

- [ ] **Step 5: Commit**

```powershell
git add scripts/installers/windows/lib/adapters/codex-voltagent-access.ps1 `
        scripts/installers/windows/lib/client-access.ps1 `
        scripts/installers/windows/cli.ps1 `
        tests/e2e/windows-installer-cli.test.mjs
git commit -m "feat: add vendored codex voltagent installer adapter"
```

## Task 3: Extend `plan-client-access` and `apply-client-access` to install both layers

**Files:**
- Modify: `scripts/installers/windows/lib/client-access.ps1`
- Modify: `scripts/installers/windows/cli.ps1`
- Test: `tests/e2e/windows-installer-cli.test.mjs`

- [ ] **Step 1: Add failing assertions for combined apply reporting**

Extend:

```js
// F:\Dev\scripts\Mimir\mimir\tests\e2e\windows-installer-cli.test.mjs
test("windows installer cli apply-client-access reports mimir and vendored codex voltagent results", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  // assert:
  // envelope.details.clientAccess.mimirAccess.configured === true
  // envelope.details.clientAccess.codexVoltAgentAccess.nativeSkillsInstalled === true
  // envelope.details.clientAccess.codexVoltAgentAccess.clientConfigPresent === true
});
```

- [ ] **Step 2: Run the installer contract to confirm the missing combined apply shape**

Run:

```powershell
node --test tests/e2e/windows-installer-cli.test.mjs
```

Expected:
- FAIL because `apply-client-access` does not yet execute or report the vendored client provisioning layer

- [ ] **Step 3: Implement combined plan/apply behavior**

Modify:

```powershell
# F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\lib\client-access.ps1
function Invoke-InstallerClientAccessPlan {
  ...
  return [pscustomobject]@{
    client = $client
    command = $adapter.command
    clientAccess = [pscustomobject]@{
      clientName = $client.clientName
      displayName = $client.displayName
      accessKind = $client.accessKind
      serverName = $ServerName
      configPath = $ConfigPath
      mimirAccess = ...
      codexVoltAgentAccess = ...
    }
    writePlan = [pscustomobject]@{
      mimirAccess = ...
      codexVoltAgentAccess = [pscustomobject]@{
        workspaceConfigPath = ...
        nativeSkillLinkPath = ...
        vendoredClientRoot = ...
      }
    }
  }
}
```

Modify:

```powershell
# F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\cli.ps1
"apply-client-access" {
  ...
  -Details ([pscustomobject]@{
      clientAccess = $adapter.clientAccess
      defaultAccess = [pscustomobject]@{
        report = $report
      }
      applyResult = $adapter.applyResult
    })
  ...
}
```

The apply path must:
- run the current `default-access` apply
- run vendored `codex:onboard -- --workspace <workspace>`
- run vendored `codex:doctor -- --workspace <workspace>`
- merge the results into one stable envelope

- [ ] **Step 4: Re-run installer verification**

Run:

```powershell
node --test tests/e2e/windows-installer-cli.test.mjs
git diff --check
```

Expected:
- installer contract tests pass
- diff check is clean

- [ ] **Step 5: Commit**

```powershell
git add scripts/installers/windows/lib/client-access.ps1 `
        scripts/installers/windows/cli.ps1 `
        tests/e2e/windows-installer-cli.test.mjs
git commit -m "feat: install vendored codex voltagent access"
```

## Task 4: Add a monorepo-owned combined smoke path

**Files:**
- Modify: `package.json`
- Modify: `tests/e2e/windows-installer-cli.test.mjs`
- Create: `tests/e2e/vendored-codex-onboarding-smoke.test.mjs`

- [ ] **Step 1: Write the failing combined smoke**

Create:

```js
// F:\Dev\scripts\Mimir\mimir\tests\e2e\vendored-codex-onboarding-smoke.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

test("vendored codex onboarding smoke provisions native skills and client-config through the monorepo", async (t) => {
  // arrange clean temp home and workspace
  // invoke vendored onboarding through the monorepo package script
  // assert native skill install path exists
  // assert client-config.json exists
  // assert doctor succeeds
});
```

- [ ] **Step 2: Run the new smoke to verify it fails before the package-script wiring exists**

Run:

```powershell
node --test tests/e2e/vendored-codex-onboarding-smoke.test.mjs
```

Expected:
- FAIL until the test harness and monorepo script wiring are complete

- [ ] **Step 3: Add monorepo smoke scripts**

Update:

```json
// F:\Dev\scripts\Mimir\mimir\package.json
{
  "scripts": {
    "test:vendor:codex-voltagent:smoke": "node --test tests/e2e/vendored-codex-onboarding-smoke.test.mjs",
    "test:installer:windows": "node --test tests/e2e/windows-installer-cli.test.mjs"
  }
}
```

And make the new smoke invoke:

```powershell
corepack pnpm vendor:codex-voltagent:onboard -- --workspace <temp-workspace>
corepack pnpm vendor:codex-voltagent:doctor -- --workspace <temp-workspace>
```

- [ ] **Step 4: Run combined smoke verification**

Run:

```powershell
corepack pnpm test:installer:windows
corepack pnpm test:vendor:codex-voltagent:smoke
```

Expected:
- both monorepo-owned installer and vendored onboarding smoke gates pass

- [ ] **Step 5: Commit**

```powershell
git add package.json tests/e2e/vendored-codex-onboarding-smoke.test.mjs tests/e2e/windows-installer-cli.test.mjs
git commit -m "test: add vendored codex onboarding smoke"
```

## Task 5: Make installer docs tell one story

**Files:**
- Modify: `documentation/setup/installation.md`
- Modify: `documentation/setup/windows-installer.md`
- Modify: `documentation/reference/repo-map.md`

- [ ] **Step 1: Write failing doc assertions if needed, or add a docs test block**

If you add a docs check, extend an existing public-docs test or add a new installer-docs test that asserts:
- installer docs mention the vendored Codex/VoltAgent client
- Docker/Desktop stays optional
- the installer is the canonical path

- [ ] **Step 2: Update the installation docs**

Add language like:

```md
The canonical installer now provisions both:

- Mimir access
- vendored Codex/VoltAgent client access

This includes native Codex skill installation, workspace `client-config.json`
bootstrap, and a post-install doctor. Docker Desktop and toolbox apply remain
optional.
```

- [ ] **Step 3: Update the Windows installer doc**

Document that `plan-client-access` and `apply-client-access` now cover:

- current Mimir access surfaces
- vendored Codex native skill install
- workspace `client-config.json`
- vendored doctor path

- [ ] **Step 4: Run docs and diff verification**

Run:

```powershell
git diff --check
node --test tests/e2e/windows-installer-cli.test.mjs
```

Expected:
- docs are internally consistent with the installer contract
- no diff formatting errors

- [ ] **Step 5: Commit**

```powershell
git add documentation/setup/installation.md `
        documentation/setup/windows-installer.md `
        documentation/reference/repo-map.md
git commit -m "docs: describe vendored codex voltagent installer path"
```

## Task 6: Mark the external repository transitional

**Files:**
- Modify: `F:\Dev\scripts\codex-claude-voltagent-client\README.md`

- [ ] **Step 1: Add a transitional banner to the external repo README**

Update the top of:

```md
> Transitional repository: the canonical release source and installer path now
> live in `F:\Dev\scripts\Mimir\mimir`. Use the MimisBrunnr installer and docs
> for installation and release work.
```

- [ ] **Step 2: Re-run a small external README sanity check**

Run:

```powershell
git -C F:\Dev\scripts\codex-claude-voltagent-client diff --check
```

Expected:
- no formatting issues in the external README change

- [ ] **Step 3: Commit in the external repo**

```powershell
git -C F:\Dev\scripts\codex-claude-voltagent-client add README.md
git -C F:\Dev\scripts\codex-claude-voltagent-client commit -m "docs: mark repo transitional"
```

## Self-review

### Spec coverage

- vendored subtree layout: Task 1
- single-installer contract over both Mimir and Codex/VoltAgent access: Tasks 2 and 3
- thin adapter over vendored Node entrypoints: Tasks 2 and 3
- monorepo-owned combined smoke: Task 4
- installer docs as canonical source: Task 5
- external repo transitional status: Task 6

### Placeholder scan

- no `TODO`, `TBD`, or “implement later” markers remain
- all tasks use exact paths
- all verification steps include actual commands

### Type and boundary consistency

- `codex` remains the installer client name
- `plan-client-access` and `apply-client-access` stay the top-level operations
- vendored client remains under `vendor/codex-claude-voltagent-client`
- Mimir runtime ownership is not changed anywhere in the plan

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-vendored-codex-voltagent-installer-migration.md`.

Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
