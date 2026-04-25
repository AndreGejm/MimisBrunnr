# Global VoltAgent Default Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VoltAgent active by default in every current and future Codex workspace through a home-global config under `~/.codex/voltagent/client-config.json`, while preserving optional workspace-local `client-config.json` overrides.

**Architecture:** Keep the current vendored Codex/Claude VoltAgent runtime boundary intact, but change config discovery and trust evaluation from workspace-local-by-default to home-global-by-default. The change is additive: local overrides still win, legacy `trustedWorkspaceRoots` configs still parse, and the Windows installer becomes responsible for writing the global config instead of a workspace-local one.

**Tech Stack:** TypeScript, Node.js, pnpm, Zod, PowerShell installer backend, Vitest, Node test runner, Codex native skill discovery

---

## Locked file structure and responsibilities

### Vendored config/runtime surfaces

- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\src\config\schema.ts`
  - add `workspaceTrustMode`, relax the non-local trust-root requirement, preserve legacy configs
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\src\config\load-client-config.ts`
  - keep schema parsing as the single typed entrypoint
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\lib\client-config.mjs`
  - add shared config discovery, source reporting, global trust evaluation, and status/doctor shape updates
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\lib\init-client-config.mjs`
  - default config output to `~/.codex/voltagent/client-config.json` and default runtime trust mode to `all-workspaces`

### Vendored CLI entrypoints

- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\scripts\codex-onboard.mjs`
  - treat home-global config as the default install target
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\scripts\codex-doctor.mjs`
  - discover config automatically and report whether it came from workspace override or home-global default
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\status.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\doctor.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\enable.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\disable.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\profiles.mjs`
  - stop requiring an explicit `--config` for the common path

### Installer integration

- Modify: `F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\lib\adapters\codex-voltagent-access.ps1`
  - point plan/apply metadata at the home-global config path by default
- Modify: `F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\lib\client-access.ps1`
  - plan/apply a global config write target instead of a workspace-local config for the default path

### Tests and docs

- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\tests\config\load-client-config.test.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\tests\scripts\codex-onboard.test.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\tests\scripts\codex-doctor.test.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\tests\plugin\plugin-shell.test.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\tests\plugin\plugin-controls.test.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\tests\docs\public-docs.test.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\tests\e2e\windows-installer-codex-voltagent-smoke.test.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\setup\installation.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\setup\windows-installer.md`

## Task 1: Add schema support for global-default activation

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\src\config\schema.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\tests\config\load-client-config.test.ts`

- [ ] **Step 1: Write failing schema tests for the new trust model**

Add tests like:

```ts
it("accepts global default mode with workspaceTrustMode all-workspaces", () => {
  const config = loadClientConfig({
    mimir: { serverCommand: ["mimir"] },
    skills: { rootPaths: ["C:/Users/vikel/.codex/skills"] },
    models: { primary: "openai/gpt-5-mini" },
    runtime: {
      mode: "voltagent-default",
      workspaceTrustMode: "all-workspaces"
    }
  });

  expect(config.runtime.workspaceTrustMode).toBe("all-workspaces");
  expect(config.runtime.trustedWorkspaceRoots).toEqual([]);
});

it("accepts explicit-roots mode for legacy workspace configs", () => {
  const config = loadClientConfig({
    mimir: { serverCommand: ["mimir"] },
    skills: { rootPaths: ["C:/Users/vikel/.codex/skills"] },
    models: { primary: "openai/gpt-5-mini" },
    runtime: {
      mode: "voltagent-default",
      workspaceTrustMode: "explicit-roots",
      trustedWorkspaceRoots: ["F:/Dev/scripts/Mimir/mimir"]
    }
  });

  expect(config.runtime.workspaceTrustMode).toBe("explicit-roots");
  expect(config.runtime.trustedWorkspaceRoots).toEqual([
    "F:/Dev/scripts/Mimir/mimir"
  ]);
});
```

- [ ] **Step 2: Run the schema test file to confirm the current model rejects the new config**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client exec vitest run tests/config/load-client-config.test.ts
```

Expected:
- FAIL on the new `workspaceTrustMode` test because the schema does not define that property yet

- [ ] **Step 3: Implement the additive schema change**

Update the runtime schema to:

```ts
export const workspaceTrustModeSchema = z.enum([
  "all-workspaces",
  "explicit-roots"
]);

runtime: z
  .strictObject({
    mode: clientRuntimeModeSchema.default("local-only"),
    workspaceTrustMode: workspaceTrustModeSchema.default("explicit-roots"),
    trustedWorkspaceRoots: z.array(nonBlankString).default([])
  })
  .default({
    mode: "local-only",
    workspaceTrustMode: "explicit-roots",
    trustedWorkspaceRoots: []
  }),
```

and replace the current trust-root refinement with:

```ts
if (
  config.runtime.mode !== "local-only" &&
  config.runtime.workspaceTrustMode === "explicit-roots" &&
  config.runtime.trustedWorkspaceRoots.length === 0
) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["runtime", "trustedWorkspaceRoots"],
    message:
      "trustedWorkspaceRoots must contain at least one workspace root when workspaceTrustMode is explicit-roots"
  });
}
```

Keep all Claude profile validation intact.

- [ ] **Step 4: Re-run the schema tests**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client exec vitest run tests/config/load-client-config.test.ts
```

Expected:
- PASS
- the old explicit-roots tests still pass
- the new all-workspaces test passes

- [ ] **Step 5: Commit**

```powershell
git -C F:\Dev\scripts\Mimir\mimir add `
  vendor/codex-claude-voltagent-client/src/config/schema.ts `
  vendor/codex-claude-voltagent-client/tests/config/load-client-config.test.ts
git -C F:\Dev\scripts\Mimir\mimir commit -m "feat: add global voltagent trust mode"
```

## Task 2: Add shared config discovery and global trust evaluation

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\lib\client-config.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\tests\scripts\codex-doctor.test.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\tests\plugin\plugin-shell.test.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\tests\plugin\plugin-controls.test.ts`

- [ ] **Step 1: Write failing tests for home-global config discovery**

Add test cases like:

```ts
it("uses the home-global config when no workspace override exists", () => {
  const homeConfigPath = join(homeRoot, ".codex", "voltagent", "client-config.json");
  // write config only at homeConfigPath
  // run scripts/codex-doctor.mjs with --home-root and --workspace but no --config
  // assert report.status.configSource === "home-global-default"
});

it("marks any workspace trusted when workspaceTrustMode is all-workspaces", () => {
  const status = createStatus(config, {
    workspaceRoot: "F:/arbitrary/repo",
    configSource: "home-global-default",
    configPath: "C:/Users/vikel/.codex/voltagent/client-config.json"
  });

  expect(status.workspaceTrusted).toBe(true);
});
```

Update plugin-shell tests to stop assuming every non-local mode needs `trustedWorkspaceRoots`.

- [ ] **Step 2: Run the doctor and plugin tests to capture the old behavior**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client exec vitest run `
  tests/scripts/codex-doctor.test.ts `
  tests/plugin/plugin-shell.test.ts `
  tests/plugin/plugin-controls.test.ts
```

Expected:
- FAIL because `parseCliArgs` still requires `--config`
- FAIL because `createStatus`/`createDoctor` still use explicit-root trust only

- [ ] **Step 3: Add the shared discovery helpers**

In `client-config.mjs`, add:

```js
function defaultHomeGlobalConfigPath(homeRoot = homedir()) {
  return join(homeRoot, ".codex", "voltagent", "client-config.json");
}

export function resolveClientConfigPath({
  explicitConfigPath,
  workspaceRoot,
  homeRoot = homedir()
}) {
  if (explicitConfigPath) {
    return {
      configPath: resolve(explicitConfigPath),
      configSource: "explicit"
    };
  }

  const workspaceConfigPath = resolve(workspaceRoot ?? process.cwd(), "client-config.json");
  if (existsSync(workspaceConfigPath)) {
    return {
      configPath: workspaceConfigPath,
      configSource: "workspace-override"
    };
  }

  return {
    configPath: defaultHomeGlobalConfigPath(homeRoot),
    configSource: "home-global-default"
  };
}
```

Update `parseCliArgs`, `createStatus`, and `createDoctor` so they include:

```js
configPath,
configSource,
workspaceTrustMode: config.runtime.workspaceTrustMode,
workspaceOverrideActive: configSource === "workspace-override"
```

Update trust evaluation:

```js
export function isTrustedWorkspace(runtime, workspaceRoot) {
  if (runtime.workspaceTrustMode === "all-workspaces") {
    return Boolean(workspaceRoot);
  }

  // existing explicit-roots logic
}
```

and make doctor emit:

```js
{
  code: "workspace_trust",
  status: "ok",
  message: "Global all-workspaces trust mode is active."
}
```

when appropriate.

- [ ] **Step 4: Re-run the doctor and plugin tests**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client exec vitest run `
  tests/scripts/codex-doctor.test.ts `
  tests/plugin/plugin-shell.test.ts `
  tests/plugin/plugin-controls.test.ts
```

Expected:
- PASS
- status/doctor report `configSource`
- home-global configs work without `--config`
- `all-workspaces` mode makes arbitrary workspaces trusted

- [ ] **Step 5: Commit**

```powershell
git -C F:\Dev\scripts\Mimir\mimir add `
  vendor/codex-claude-voltagent-client/plugins/codex-voltagent-default/scripts/lib/client-config.mjs `
  vendor/codex-claude-voltagent-client/tests/scripts/codex-doctor.test.ts `
  vendor/codex-claude-voltagent-client/tests/plugin/plugin-shell.test.ts `
  vendor/codex-claude-voltagent-client/tests/plugin/plugin-controls.test.ts
git -C F:\Dev\scripts\Mimir\mimir commit -m "feat: discover global voltagent config by default"
```

## Task 3: Make onboarding and entrypoints write the home-global config by default

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\lib\init-client-config.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\scripts\codex-onboard.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\scripts\codex-doctor.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\status.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\doctor.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\enable.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\disable.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\plugins\codex-voltagent-default\scripts\profiles.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\tests\scripts\codex-onboard.test.ts`

- [ ] **Step 1: Write failing onboarding tests for the new default path**

Update the onboarding test to assert:

```ts
const configPath = join(homeRoot, ".codex", "voltagent", "client-config.json");
expect(result.config.configPath).toBe(configPath);
expect(config.runtime.workspaceTrustMode).toBe("all-workspaces");
expect(config.runtime.trustedWorkspaceRoots).toEqual([]);
expect(result.config.workspaceRoot).toBe(workspaceRoot);
```

Also add a workspace-override test:

```ts
it("still allows an explicit workspace-local override path", () => {
  const overridePath = join(workspaceRoot, "client-config.json");
  // run codex-onboard with --config overridePath
  // expect config written there and configSource later resolves to workspace-override
});
```

- [ ] **Step 2: Run the onboarding test file to confirm the old default still writes into the workspace**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client exec vitest run tests/scripts/codex-onboard.test.ts
```

Expected:
- FAIL because `parseInitArgs` still defaults `configPath` to `<workspace>/client-config.json`

- [ ] **Step 3: Change the default config target and generated runtime block**

Update `init-client-config.mjs`:

```js
function defaultHomeGlobalConfigPath(homeRoot = homedir()) {
  return join(homeRoot, ".codex", "voltagent", "client-config.json");
}

if (!parsed.configPath) {
  parsed.configPath = defaultHomeGlobalConfigPath(homeRoot);
}
```

and update the generated config:

```js
runtime: {
  mode: args.mode,
  workspaceTrustMode:
    args.mode === "local-only" ? "explicit-roots" : "all-workspaces",
  trustedWorkspaceRoots: []
},
```

Keep `--config` as the explicit override surface.

Update `codex-onboard.mjs` and `codex-doctor.mjs` so they do not require a workspace-local config path for the common flow. Update `status.mjs`, `doctor.mjs`, `enable.mjs`, `disable.mjs`, and `profiles.mjs` to call the shared discovery logic and return the resolved config metadata.

- [ ] **Step 4: Re-run the vendored onboarding and doctor tests**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client exec vitest run `
  tests/scripts/codex-onboard.test.ts `
  tests/scripts/codex-doctor.test.ts `
  tests/plugin/plugin-shell.test.ts
```

Expected:
- PASS
- default onboarding writes `~/.codex/voltagent/client-config.json`
- workspace-local override still works when explicitly requested

- [ ] **Step 5: Commit**

```powershell
git -C F:\Dev\scripts\Mimir\mimir add `
  vendor/codex-claude-voltagent-client/plugins/codex-voltagent-default/scripts/lib/init-client-config.mjs `
  vendor/codex-claude-voltagent-client/scripts/codex-onboard.mjs `
  vendor/codex-claude-voltagent-client/scripts/codex-doctor.mjs `
  vendor/codex-claude-voltagent-client/plugins/codex-voltagent-default/scripts/status.mjs `
  vendor/codex-claude-voltagent-client/plugins/codex-voltagent-default/scripts/doctor.mjs `
  vendor/codex-claude-voltagent-client/plugins/codex-voltagent-default/scripts/enable.mjs `
  vendor/codex-claude-voltagent-client/plugins/codex-voltagent-default/scripts/disable.mjs `
  vendor/codex-claude-voltagent-client/plugins/codex-voltagent-default/scripts/profiles.mjs `
  vendor/codex-claude-voltagent-client/tests/scripts/codex-onboard.test.ts
git -C F:\Dev\scripts\Mimir\mimir commit -m "feat: default voltagent onboarding to global config"
```

## Task 4: Move the Windows installer default path to the home-global config

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\lib\adapters\codex-voltagent-access.ps1`
- Modify: `F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\lib\client-access.ps1`
- Modify: `F:\Dev\scripts\Mimir\mimir\tests\e2e\windows-installer-codex-voltagent-smoke.test.mjs`

- [ ] **Step 1: Write a failing installer smoke expectation for the global config path**

Change the smoke assertions to:

```js
const globalConfigPath = path.join(
  homeRoot,
  ".codex",
  "voltagent",
  "client-config.json"
);

assert.equal(doctorResult.exitCode, 0, doctorResult.stderr);
assert.equal(doctorReport.status.configSource, "home-global-default");

const vendoredConfig = JSON.parse(await readFile(globalConfigPath, "utf8"));
assert.equal(vendoredConfig.runtime.workspaceTrustMode, "all-workspaces");
assert.deepEqual(vendoredConfig.runtime.trustedWorkspaceRoots, []);
```

Leave one explicit local-override path test for a follow-up CLI contract if needed, but move the main installer smoke to the global path.

- [ ] **Step 2: Run the smoke test to confirm the installer still writes `<workspace>/client-config.json`**

Run:

```powershell
node --test F:\Dev\scripts\Mimir\mimir\tests\e2e\windows-installer-codex-voltagent-smoke.test.mjs
```

Expected:
- FAIL because the adapter still points the onboard/doctor flow at `Join-Path $WorkspacePath "client-config.json"`

- [ ] **Step 3: Change the installer adapter metadata and apply flow**

In `codex-voltagent-access.ps1`, replace:

```powershell
function Get-CodexVoltAgentWorkspaceConfigPath {
  param([string]$WorkspacePath)
  return Join-Path $WorkspacePath "client-config.json"
}
```

with:

```powershell
function Get-CodexVoltAgentHomeConfigPath {
  param([string]$HomeRoot = $HOME)
  return Join-Path $HomeRoot ".codex\voltagent\client-config.json"
}
```

Update plan metadata and onboarding/doctor adapter arguments to use the home-global config path by default:

```powershell
$configPath = Get-CodexVoltAgentHomeConfigPath -HomeRoot $HomeRoot
...
"--config",
$configPath,
```

In `client-access.ps1`, rename the write target/report field from workspace config to home-global config for the default path:

```powershell
New-InstallerWriteTarget `
  -Id "codex-voltagent-global-config" `
  -Path $codexVoltAgentPlan.configPath `
  -MutationKind "write_file"
```

Keep `workspacePath` in the report because runtime probe still needs a workspace context.

- [ ] **Step 4: Re-run the installer smoke and diff check**

Run:

```powershell
node --test F:\Dev\scripts\Mimir\mimir\tests\e2e\windows-installer-codex-voltagent-smoke.test.mjs
git -C F:\Dev\scripts\Mimir\mimir diff --check
```

Expected:
- PASS
- no diff-format issues
- installer provisions global config plus native skills in one apply path

- [ ] **Step 5: Commit**

```powershell
git -C F:\Dev\scripts\Mimir\mimir add `
  scripts/installers/windows/lib/adapters/codex-voltagent-access.ps1 `
  scripts/installers/windows/lib/client-access.ps1 `
  tests/e2e/windows-installer-codex-voltagent-smoke.test.mjs
git -C F:\Dev\scripts\Mimir\mimir commit -m "feat: install global voltagent config by default"
```

## Task 5: Update docs and public assertions to make the global path canonical

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\tests\docs\public-docs.test.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\README.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\.codex\INSTALL.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client\docs\codex-default-activation.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\setup\installation.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\setup\windows-installer.md`

- [ ] **Step 1: Write failing public-doc assertions for the global config path**

Add assertions like:

```ts
expect(readme).toContain("~/.codex/voltagent/client-config.json");
expect(installDoc).toContain("home-global default");
expect(activationDoc).toContain("workspace override");
expect(activationDoc).toContain("home-global-default");
expect(activationDoc).not.toContain("bootstrap each workspace individually");
```

- [ ] **Step 2: Run the docs test file to capture the stale wording**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client exec vitest run tests/docs/public-docs.test.ts
```

Expected:
- FAIL because the docs still describe workspace-local `client-config.json` as the primary path

- [ ] **Step 3: Update the docs**

Update the vendored docs so they explicitly say:

```md
Default activation now comes from `~/.codex/voltagent/client-config.json`.

Config discovery order:
1. `<workspace>/client-config.json` when present
2. `~/.codex/voltagent/client-config.json`

Workspace-local config is an override surface, not the default setup path.
```

Update Mimir installer docs to say:

```md
`apply-client-access` writes the home-global VoltAgent config under
`%USERPROFILE%\.codex\voltagent\client-config.json` by default, then verifies
that arbitrary workspaces inherit that configuration without a local bootstrap.
```

- [ ] **Step 4: Run docs and smoke verification**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client exec vitest run tests/docs/public-docs.test.ts
node --test F:\Dev\scripts\Mimir\mimir\tests\e2e\windows-installer-codex-voltagent-smoke.test.mjs
git -C F:\Dev\scripts\Mimir\mimir diff --check
```

Expected:
- PASS
- public docs match the new activation model
- installer smoke still passes

- [ ] **Step 5: Commit**

```powershell
git -C F:\Dev\scripts\Mimir\mimir add `
  vendor/codex-claude-voltagent-client/tests/docs/public-docs.test.ts `
  vendor/codex-claude-voltagent-client/README.md `
  vendor/codex-claude-voltagent-client/.codex/INSTALL.md `
  vendor/codex-claude-voltagent-client/docs/codex-default-activation.md `
  documentation/setup/installation.md `
  documentation/setup/windows-installer.md
git -C F:\Dev\scripts\Mimir\mimir commit -m "docs: make global voltagent activation canonical"
```

## Task 6: Run the release-honest verification set on the merged change

**Files:**
- Verify only

- [ ] **Step 1: Run the focused vendored tests**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir\vendor\codex-claude-voltagent-client exec vitest run `
  tests/config/load-client-config.test.ts `
  tests/scripts/codex-onboard.test.ts `
  tests/scripts/codex-doctor.test.ts `
  tests/plugin/plugin-shell.test.ts `
  tests/plugin/plugin-controls.test.ts `
  tests/docs/public-docs.test.ts
```

Expected:
- PASS

- [ ] **Step 2: Run the installer smoke**

Run:

```powershell
node --test F:\Dev\scripts\Mimir\mimir\tests\e2e\windows-installer-codex-voltagent-smoke.test.mjs
```

Expected:
- PASS

- [ ] **Step 3: Run the existing packaged installer smoke**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir test:installer-codex-smoke
```

Expected:
- PASS

- [ ] **Step 4: Run diff hygiene**

Run:

```powershell
git -C F:\Dev\scripts\Mimir\mimir diff --check
```

Expected:
- PASS

- [ ] **Step 5: Commit**

```powershell
git -C F:\Dev\scripts\Mimir\mimir status --short
```

Expected:
- clean or only the intentional verification/log artifacts you already reviewed

## Self-review

### Spec coverage

- home-global config path under `~/.codex/voltagent/client-config.json`: Tasks 2, 3, 4
- workspace override precedence: Tasks 2 and 3
- `workspaceTrustMode = "all-workspaces"` global activation: Tasks 1 and 2
- installer writes the global config by default: Task 4
- status/doctor report config source and trust mode: Tasks 2 and 3
- backward compatibility for existing explicit-root configs: Task 1
- unchanged Mimir versus VoltAgent boundary: preserved across all tasks; no task changes runtime authority ownership

### Placeholder scan

- no placeholder markers remain
- every task has exact file paths
- every verification step names an actual command
- every code-changing task includes concrete code to write or adapt

### Type and boundary consistency

- `workspaceTrustMode` is used consistently as the new runtime property name
- config source names are consistent: `explicit`, `workspace-override`, `home-global-default`
- the global path is consistent everywhere: `~/.codex/voltagent/client-config.json`
- workspace-local `client-config.json` remains an override, not the default

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-global-voltagent-default-activation.md`.

Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
