# Guided Toolbox Authoring And Workflow Composition Implementation Plan

> **Status note (2026-04-27):** This plan is now partially historical. The repo
> has already landed authored workflows, guided scaffolding, preview,
> `list-toolbox-servers`, `sync-toolbox-runtime`, role-aware narrow selection,
> and dynamic broker integration. Use it to understand the phase intent, but
> use `documentation/operations/docker-toolbox-v1.md`,
> `documentation/reference/interfaces.md`, and
> `documentation/planning/current-implementation.md` and
> `documentation/planning/backlog.md` for the live state. Unchecked tasks below
> should not be treated as the current execution queue without reconciling them
> against those canonical docs.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one operator-friendly toolbox authoring flow that can create reusable toolboxes and repeated multi-band workflows, while keeping runtime activation restricted to compiled compatibility profiles and keeping the default MCP surface narrow.

**Architecture:** Move repeated multi-band compositions into first-class authored workflow manifests, keep bands as reusable capability slices, and compile both band-backed and workflow-backed compatibility profiles from one policy graph. Add one umbrella CLI scaffolding surface with wizard/JSON parity, then teach broker/control selection to choose the narrowest compiled target using task categories first and actor role only as a tie-breaker.

**Tech Stack:** TypeScript, Node.js CLI, YAML toolbox manifests, MCP toolbox broker, Node test runner

---

## Historical File Boundary Map For This Slice

**Policy contracts and compiler**
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\contracts\src\toolbox\policy.contract.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\contracts\src\toolbox\control.contract.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\toolbox\policy-compiler.ts`

**Authoring and CLI**
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\toolbox\toolbox-authoring.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\index.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\apps\mimir-cli\src\command-surface.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\apps\mimir-cli\src\main.ts`

**Broker/control selection**
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\toolbox\control-surface.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\apps\mimir-toolbox-mcp\src\main.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\apps\mimir-toolbox-mcp\src\session-state.ts` only if workflow metadata needs to persist in session state

**Authored manifests and docs**
- Create: `F:\Dev\scripts\Mimir\mimir\docker\mcp\workflows\*.yaml`
- Modify: `F:\Dev\scripts\Mimir\mimir\docker\mcp\bands\*.yaml`
- Modify: `F:\Dev\scripts\Mimir\mimir\docker\mcp\intents.yaml`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\operations\docker-toolbox-v1.md`

**Tests**
- Modify: `F:\Dev\scripts\Mimir\mimir\tests\e2e\toolbox-manifest-contracts.test.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\tests\e2e\toolbox-cli.test.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\tests\e2e\mimir-control-mcp.test.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\tests\e2e\mimir-toolbox-mcp.test.mjs`

---

### Task 1: Introduce Authored Workflow Manifests And Compiler Support

**Files:**
- Create: `F:\Dev\scripts\Mimir\mimir\docker\mcp\workflows\*.yaml`
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\contracts\src\toolbox\policy.contract.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\toolbox\policy-compiler.ts`
- Test: `F:\Dev\scripts\Mimir\mimir\tests\e2e\toolbox-manifest-contracts.test.mjs`

- [ ] **Step 1: Write the failing manifest/compiler test**

```js
test("workflow manifests compile into compatibility profiles without authored composite profile files", async (t) => {
  const manifestDirectory = await mkdtemp(path.join(os.tmpdir(), "mimir-toolbox-workflows-"));
  await cp(path.resolve("docker", "mcp"), manifestDirectory, { recursive: true });
  await rm(path.join(manifestDirectory, "profiles", "core-dev+docs-research.yaml"), { force: true });

  await writeFile(
    path.join(manifestDirectory, "workflows", "core-dev+docs-research.yaml"),
    [
      "workflow:",
      "  id: core-dev+docs-research",
      "  displayName: Core Dev Plus Docs Research",
      "  includeBands:",
      "    - core-dev",
      "    - docs-research",
      "  compositeReason: repeated_workflow",
      "  fallbackProfile: core-dev"
    ].join("\\n"),
    "utf8"
  );

  const policy = compileToolboxPolicyFromDirectory(manifestDirectory);
  assert.deepEqual(policy.profiles["core-dev+docs-research"].includeBands, ["core-dev", "docs-research"]);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-manifest-contracts.test.mjs --test-name-pattern "workflow manifests compile into compatibility profiles without authored composite profile files"
```

Expected: FAIL because `workflows` are not yet part of the authored manifest set or compiled profile graph.

- [ ] **Step 3: Extend the toolbox contract with authored workflow manifests**

```ts
export interface ToolboxWorkflowManifest {
  id: string;
  displayName: string;
  includeBands: string[];
  compositeReason: string;
  fallbackProfile?: string;
  sessionMode?: ToolboxSessionMode;
  preferredActorRoles?: ActorRole[];
  autoExpand?: boolean;
  requiresApproval?: boolean;
  summary?: string;
  exampleTasks?: string[];
}
```

- [ ] **Step 4: Teach the compiler to load workflows and derive compatibility profiles from them**

```ts
const workflows = loadOptionalManifestDirectory(path.join(root, "workflows"), "workflow", readWorkflow);

profiles: mergeAuthoredAndDerivedProfiles(
  authoredProfiles,
  deriveProfilesFromBandsAndWorkflows(bands, workflows)
)
```

- [ ] **Step 5: Keep exact-band-set resolution deterministic**

```ts
function deriveProfilesFromBandsAndWorkflows(
  bands: Record<string, ToolboxBandManifest>,
  workflows: Record<string, ToolboxWorkflowManifest>
): Record<string, ToolboxProfileManifest> {
  return Object.fromEntries(
    Object.values(workflows).map((workflow) => [
      workflow.id,
      {
        id: workflow.id,
        displayName: workflow.displayName,
        sessionMode: workflow.sessionMode ?? "toolbox-activated",
        includeBands: uniqueSorted(workflow.includeBands),
        compositeReason: workflow.compositeReason,
        fallbackProfile: workflow.fallbackProfile
      }
    ])
  );
}
```

- [ ] **Step 6: Run the targeted test to verify it passes**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-manifest-contracts.test.mjs --test-name-pattern "workflow manifests compile into compatibility profiles without authored composite profile files"
```

Expected: PASS

- [ ] **Step 7: Commit**

```powershell
git -C F:\Dev\scripts\Mimir\mimir add packages/contracts/src/toolbox/policy.contract.ts packages/infrastructure/src/toolbox/policy-compiler.ts tests/e2e/toolbox-manifest-contracts.test.mjs docker/mcp/workflows
git -C F:\Dev\scripts\Mimir\mimir commit -m "feat: add authored toolbox workflow manifests"
```

### Task 2: Replace Band-Only Scaffolding With One Guided Toolbox Authoring Surface

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\toolbox\toolbox-authoring.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\index.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\apps\mimir-cli\src\command-surface.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\apps\mimir-cli\src\main.ts`
- Test: `F:\Dev\scripts\Mimir\mimir\tests\e2e\toolbox-cli.test.mjs`

- [ ] **Step 1: Write the failing CLI scaffolding tests**

```js
test("mimir-cli scaffold-toolbox can create a reusable toolbox band from one payload", async () => {
  // expect band file, base profile, intent, and optional workflow hints
});

test("mimir-cli scaffold-toolbox can create a repeated workflow from existing bands", async () => {
  // expect workflow manifest and compiled compatibility profile, with no authored composite profile file
});
```

- [ ] **Step 2: Run the targeted CLI tests to verify they fail**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-cli.test.mjs --test-name-pattern "scaffold-toolbox"
```

Expected: FAIL because only `scaffold-toolbox-band` exists and there is no workflow path.

- [ ] **Step 3: Replace the current single-purpose input contract with a discriminated authoring command**

```ts
type ScaffoldToolboxInput =
  | { mode: "toolbox"; bandId: string; displayName: string; serverIds: string[]; ... }
  | { mode: "workflow"; workflowId: string; displayName: string; includeBands: string[]; ... };
```

- [ ] **Step 4: Add one CLI command surface for wizard or JSON mode**

```ts
if (parsed.command === "scaffold-toolbox") {
  const payload = await loadCommandPayload(parsed.options);
  const result = await scaffoldToolbox(payload as ScaffoldToolboxInput);
  writeJson({ ok: true, ...result }, parsed.options.pretty);
}
```

- [ ] **Step 5: Keep `scaffold-toolbox-band` as a compatibility alias only if needed**

```ts
const normalizedPayload = parsed.command === "scaffold-toolbox-band"
  ? { mode: "toolbox", ...payload }
  : payload;
```

- [ ] **Step 6: Run the targeted CLI tests to verify they pass**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-cli.test.mjs --test-name-pattern "scaffold-toolbox"
```

Expected: PASS

- [ ] **Step 7: Commit**

```powershell
git -C F:\Dev\scripts\Mimir\mimir add packages/infrastructure/src/toolbox/toolbox-authoring.ts packages/infrastructure/src/index.ts apps/mimir-cli/src/command-surface.ts apps/mimir-cli/src/main.ts tests/e2e/toolbox-cli.test.mjs
git -C F:\Dev\scripts\Mimir\mimir commit -m "feat: add guided toolbox and workflow scaffolding"
```

### Task 3: Add Operator Discovery And Preview For Servers, Bands, And Workflows

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\apps\mimir-cli\src\command-surface.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\apps\mimir-cli\src\main.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\toolbox\toolbox-authoring.ts`
- Test: `F:\Dev\scripts\Mimir\mimir\tests\e2e\toolbox-cli.test.mjs`

- [ ] **Step 1: Write failing tests for server listing and dry-run preview**

```js
test("mimir-cli list-toolbox-servers returns summarized MCP server choices", async () => {
  // assert server ids, source, runtime binding, categories, mutation level
});

test("mimir-cli preview-toolbox shows compiled categories and target profile without writing files", async () => {
  // assert no file changes plus a rendered preview object
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-cli.test.mjs --test-name-pattern "list-toolbox-servers|preview-toolbox"
```

Expected: FAIL because those commands do not exist yet.

- [ ] **Step 3: Expose server summaries from the compiled policy**

```ts
const servers = Object.values(policy.servers).map((server) => ({
  id: server.id,
  displayName: server.displayName,
  source: server.source,
  kind: server.kind,
  usageClass: server.usageClass ?? "general",
  trustClass: server.trustClass,
  mutationLevel: server.mutationLevel,
  categories: uniqueSorted(server.tools.map((tool) => tool.category))
}));
```

- [ ] **Step 4: Add a preview path that compiles the requested authored object without writing**

```ts
if (parsed.command === "preview-toolbox") {
  const preview = await previewScaffoldToolbox(payload as ScaffoldToolboxInput);
  writeJson({ ok: true, preview }, parsed.options.pretty);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-cli.test.mjs --test-name-pattern "list-toolbox-servers|preview-toolbox"
```

Expected: PASS

- [ ] **Step 6: Commit**

```powershell
git -C F:\Dev\scripts\Mimir\mimir add apps/mimir-cli/src/command-surface.ts apps/mimir-cli/src/main.ts packages/infrastructure/src/toolbox/toolbox-authoring.ts tests/e2e/toolbox-cli.test.mjs
git -C F:\Dev\scripts\Mimir\mimir commit -m "feat: add toolbox authoring discovery and preview commands"
```

### Task 4: Make Selection Task-First And Role-Aware Across Control Surface And Broker

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\contracts\src\toolbox\control.contract.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\toolbox\control-surface.ts`
- Modify: `F:\Dev\scripts\Mimir\mimir\apps\mimir-toolbox-mcp\src\main.ts`
- Test: `F:\Dev\scripts\Mimir\mimir\tests\e2e\mimir-control-mcp.test.mjs`
- Test: `F:\Dev\scripts\Mimir\mimir\tests\e2e\mimir-toolbox-mcp.test.mjs`

- [ ] **Step 1: Write failing tests for role-aware tie-breaking**

```js
test("request-toolbox-activation prefers the narrowest workflow by required categories before role, then uses role as tie-breaker", async () => {
  // assert category-first behavior
});

test("broker auto-expand prefers a role-affine candidate only when safety ranking is otherwise equal", async () => {
  // assert preferredActorRoles affects tie-break, not trust widening
});
```

- [ ] **Step 2: Run the broker/control tests to verify they fail**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/mimir-control-mcp.test.mjs tests/e2e/mimir-toolbox-mcp.test.mjs --test-name-pattern "role-aware|tie-break"
```

Expected: FAIL because role hints are compiled but not consumed.

- [ ] **Step 3: Extend activation input with optional actor role**

```ts
interface RequestToolboxActivationInput {
  requestedToolbox?: string;
  requiredCategories?: string[];
  taskSummary?: string;
  clientId?: string;
  actorRole?: ActorRole;
  approval?: ToolboxApprovalGrant;
}
```

- [ ] **Step 4: Add role-aware scoring without allowing role to widen trust**

```ts
return (
  leftScore.requiresApproval - rightScore.requiresApproval
  || leftScore.mutationRank - rightScore.mutationRank
  || leftScore.trustLevel - rightScore.trustLevel
  || leftScore.extraCategoryCount - rightScore.extraCategoryCount
  || leftScore.bandCount - rightScore.bandCount
  || rightScore.roleAffinity - leftScore.roleAffinity
  || leftScore.id.localeCompare(rightScore.id)
);
```

- [ ] **Step 5: Reuse the same scoring rules in broker-side auto-expand**

```ts
const autoExpandIntentId = findAutoExpandIntentIdForCategories(
  scopedControl.policy,
  sessionState.activeBands,
  requiredCategories,
  optionalString(args.actorRole)
);
```

- [ ] **Step 6: Run the broker/control tests to verify they pass**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/mimir-control-mcp.test.mjs tests/e2e/mimir-toolbox-mcp.test.mjs --test-name-pattern "role-aware|tie-break"
```

Expected: PASS

- [ ] **Step 7: Commit**

```powershell
git -C F:\Dev\scripts\Mimir\mimir add packages/contracts/src/toolbox/control.contract.ts packages/infrastructure/src/toolbox/control-surface.ts apps/mimir-toolbox-mcp/src/main.ts tests/e2e/mimir-control-mcp.test.mjs tests/e2e/mimir-toolbox-mcp.test.mjs
git -C F:\Dev\scripts\Mimir\mimir commit -m "feat: add role-aware toolbox selection tie-breakers"
```

### Task 5: Document The Operator Workflow And Verify The Full Slice

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\operations\docker-toolbox-v1.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\tests\e2e\toolbox-manifest-contracts.test.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\tests\e2e\toolbox-cli.test.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\tests\e2e\mimir-control-mcp.test.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\tests\e2e\mimir-toolbox-mcp.test.mjs`

- [ ] **Step 1: Update the operator documentation with the new authored model**

```md
## Authored Units

- `servers/` define MCP sources and tool metadata
- `bands/` define reusable capability slices
- `workflows/` define approved repeated multi-band compositions
- compiled compatibility profiles remain generated runtime artifacts
```

- [ ] **Step 2: Run the focused verification suite**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-manifest-contracts.test.mjs tests/e2e/toolbox-cli.test.mjs tests/e2e/mimir-control-mcp.test.mjs tests/e2e/mimir-toolbox-mcp.test.mjs
```

Expected: PASS with all targeted toolbox authoring, control, and broker tests green.

- [ ] **Step 3: Run the build**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir build
```

Expected: exit code 0

- [ ] **Step 4: Commit**

```powershell
git -C F:\Dev\scripts\Mimir\mimir add documentation/operations/docker-toolbox-v1.md tests/e2e/toolbox-manifest-contracts.test.mjs tests/e2e/toolbox-cli.test.mjs tests/e2e/mimir-control-mcp.test.mjs tests/e2e/mimir-toolbox-mcp.test.mjs
git -C F:\Dev\scripts\Mimir\mimir commit -m "docs: document guided toolbox authoring and workflows"
```

---

## Self-Review

- Spec coverage: this plan covers authored workflows, unified scaffolding UX, server discovery/preview, task-first role-aware selection, and full verification.
- Placeholder scan: no `TODO`/`TBD` placeholders remain in task steps.
- Type consistency: this plan consistently uses `bands`, `workflows`, compiled `profiles`, `actorRole`, `preferredActorRoles`, and `requiredCategories`.
