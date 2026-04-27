# Mimir Docker Toolbox V1 Remaining Work Implementation Plan

> **Status note (2026-04-27):** This plan captured the reconnect-first
> remaining-work phase. The Kubernetes read-only slice landed, and the repo has
> since moved beyond this plan into the dynamic broker and guided authoring
> phases. Read this as historical execution context, not as the current live
> backlog. For current shipped behavior and backlog, use
> `documentation/planning/current-implementation.md`,
> `documentation/operations/docker-toolbox-v1.md`, and
> `documentation/planning/backlog.md`. Unchecked boxes below are historical
> execution artifacts, not the live work queue.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining Docker Toolbox v1 work from the verified current baseline by adding a read-only Kubernetes observation band, keeping Docker runtime and installer planning aligned, and updating rollout/backlog status without widening toolbox authority.

**Architecture:** Keep the existing manifest compiler, `mimir-control`, lease enforcement, and Docker runtime planning flow intact. This plan only extends manifest-defined peer bands and the tests/docs that prove them; Kubernetes enters as a read-only peer in observation profiles, while mutation remains deferred behind approval-gated admin work.

**Tech Stack:** Node.js 22, TypeScript, YAML manifests under `docker/mcp`, MCP stdio transports, `node:test` e2e suites, PowerShell installer backend, Docker MCP Toolkit planning.

---

## Historical Verified Baseline On 2026-04-19

This is the starting point. Do not re-plan these foundations.

- Verified on `2026-04-19` with:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-manifest-contracts.test.mjs tests/e2e/toolbox-cli.test.mjs tests/e2e/mimir-control-mcp.test.mjs tests/e2e/toolbox-session-lease.test.mjs tests/e2e/docker-toolbox-sync.test.mjs tests/e2e/command-catalog.test.mjs
```

- Verified result: `53` tests passed, `0` failed.
- Backlog state before this remaining-work slice:
  - `TB-001` done
  - `TB-002` done
  - `TB-003` done
  - `TB-004` partial
  - `TB-005` ready
  - `TB-006` blocked
  - `TB-007` ready

## Scope Guardrails

This refresh keeps focus on the existing toolbox track.

- In scope:
  - read-only Kubernetes observation inside toolbox manifests and profiles
  - Docker runtime-plan and installer audit alignment for the new peer band
  - docs/backlog updates that reflect the actual post-change state
- Out of scope in this plan:
  - Kubernetes mutation or deployment tools
  - hot-add session semantics
  - new client overlay concepts
  - making Docker Desktop the policy source of truth

## Sprint 1: Add The Read-Only Kubernetes Manifest Band

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\docker\mcp\categories.yaml`
- Create: `F:\Dev\scripts\Mimir\mimir\docker\mcp\servers\kubernetes-read.yaml`
- Test: `F:\Dev\scripts\Mimir\mimir\tests\e2e\toolbox-manifest-contracts.test.mjs`

- [ ] **Step 1: Add failing manifest assertions for the Kubernetes read-only band**

Add these assertions near the checked-in manifest test in `tests/e2e/toolbox-manifest-contracts.test.mjs`:

```js
  assert.ok(compiled.categories["k8s-read"]);
  assert.ok(compiled.categories["k8s-logs-read"]);
  assert.ok(compiled.categories["k8s-events-read"]);
  assert.ok(compiled.servers["kubernetes-read"]);
  assert.ok(
    compiled.servers["kubernetes-read"].tools.some(
      (tool) => tool.toolId === "kubernetes.logs.query"
    )
  );
```

- [ ] **Step 2: Run the manifest-contract suite and verify it fails for the missing Kubernetes categories/server**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-manifest-contracts.test.mjs
```

Expected: FAIL with an assertion about missing `k8s-read` or `kubernetes-read`.

- [ ] **Step 3: Add the Kubernetes read-only categories**

Insert these category entries into `docker/mcp/categories.yaml` after the existing operational read categories:

```yaml
  k8s-read:
    description: Inspect Kubernetes cluster state
    trustClass: ops-read
    mutationLevel: read
  k8s-logs-read:
    description: Read Kubernetes pod and container logs
    trustClass: ops-read
    mutationLevel: read
  k8s-events-read:
    description: Read Kubernetes cluster and workload events
    trustClass: ops-read
    mutationLevel: read
```

- [ ] **Step 4: Create the Kubernetes read-only peer descriptor**

Create `docker/mcp/servers/kubernetes-read.yaml` with this exact manifest:

```yaml
server:
  id: kubernetes-read
  displayName: Kubernetes Read
  source: peer
  kind: peer
  trustClass: ops-read
  mutationLevel: read
  tools:
    - toolId: kubernetes.context.inspect
      displayName: Inspect Kubernetes Context
      category: k8s-read
      trustClass: ops-read
      mutationLevel: read
      semanticCapabilityId: kubernetes.context.inspect
    - toolId: kubernetes.namespaces.list
      displayName: List Kubernetes Namespaces
      category: k8s-read
      trustClass: ops-read
      mutationLevel: read
      semanticCapabilityId: kubernetes.namespace.list
    - toolId: kubernetes.workloads.list
      displayName: List Kubernetes Workloads
      category: k8s-read
      trustClass: ops-read
      mutationLevel: read
      semanticCapabilityId: kubernetes.workload.list
    - toolId: kubernetes.pods.list
      displayName: List Kubernetes Pods
      category: k8s-read
      trustClass: ops-read
      mutationLevel: read
      semanticCapabilityId: kubernetes.pod.list
    - toolId: kubernetes.events.list
      displayName: List Kubernetes Events
      category: k8s-events-read
      trustClass: ops-read
      mutationLevel: read
      semanticCapabilityId: kubernetes.events.list
    - toolId: kubernetes.logs.query
      displayName: Query Kubernetes Logs
      category: k8s-logs-read
      trustClass: ops-read
      mutationLevel: read
      semanticCapabilityId: kubernetes.logs.query
```

- [ ] **Step 5: Re-run the manifest-contract suite and verify the manifest layer is green again**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-manifest-contracts.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the manifest-band slice**

Run:

```powershell
git add docker/mcp/categories.yaml docker/mcp/servers/kubernetes-read.yaml tests/e2e/toolbox-manifest-contracts.test.mjs
git commit -m "feat: add kubernetes read toolbox manifest band"
```

## Sprint 2: Wire Kubernetes Read-Only Access Into Runtime Toolboxes

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\docker\mcp\intents.yaml`
- Modify: `F:\Dev\scripts\Mimir\mimir\docker\mcp\profiles\runtime-observe.yaml`
- Modify: `F:\Dev\scripts\Mimir\mimir\docker\mcp\profiles\core-dev+runtime-observe.yaml`
- Modify: `F:\Dev\scripts\Mimir\mimir\docker\mcp\profiles\runtime-admin.yaml`
- Modify: `F:\Dev\scripts\Mimir\mimir\docker\mcp\profiles\full.yaml`
- Test: `F:\Dev\scripts\Mimir\mimir\tests\e2e\toolbox-cli.test.mjs`
- Test: `F:\Dev\scripts\Mimir\mimir\tests\e2e\mimir-control-mcp.test.mjs`

- [ ] **Step 1: Add failing runtime-observe assertions for CLI and MCP active tools**

Extend the existing runtime-observe checks in both test files with these assertions:

```js
    assert.ok(activeToolIds.includes("kubernetes.context.inspect"));
    assert.ok(activeToolIds.includes("kubernetes.events.list"));
    assert.ok(activeToolIds.includes("kubernetes.logs.query"));
    assert.ok(!activeToolIds.includes("kubernetes.apply"));
```

For the CLI suite, add the same tool checks to the runtime-admin approved session test so admin profiles inherit read-only Kubernetes visibility without adding mutation:

```js
  assert.ok(
    activeToolsPayload.activeTools.some(
      (tool) => tool.toolId === "kubernetes.context.inspect" && tool.availabilityState === "active"
    )
  );
  assert.ok(
    !activeToolsPayload.activeTools.some((tool) => tool.toolId === "kubernetes.apply")
  );
```

- [ ] **Step 2: Run the CLI and control-MCP suites and verify they fail before profile wiring**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-cli.test.mjs tests/e2e/mimir-control-mcp.test.mjs
```

Expected: FAIL because the runtime-observe profiles do not yet include `kubernetes-read`.

- [ ] **Step 3: Add Kubernetes read-only categories to the runtime-oriented intents**

Update the `runtime-observe`, `core-dev+runtime-observe`, `runtime-admin`, and `full` entries in `docker/mcp/intents.yaml` so their summaries and allowed categories include Kubernetes observation:

```yaml
  runtime-observe:
    displayName: Runtime Observe
    summary: Read-only runtime inspection across logs, metrics, traces, Docker, and Kubernetes state.
    exampleTasks:
      - Investigate service startup failures from logs, metrics, and cluster events
      - Inspect live container and pod state without mutating runtime resources
    targetProfile: runtime-observe
    trustClass: ops-read
    requiresApproval: false
    activationMode: session-switch
    allowedCategories:
      - repo-read
      - internal-memory
      - logs-read
      - metrics-read
      - traces-read
      - docker-read
      - k8s-read
      - k8s-logs-read
      - k8s-events-read
```

Mirror the same three Kubernetes categories into:

```yaml
  core-dev+runtime-observe.allowedCategories
  runtime-admin.allowedCategories
  full.allowedCategories
```

Keep `delivery-admin` unchanged.

- [ ] **Step 4: Add the Kubernetes peer to the observation and operator profiles**

Update these profile manifests exactly as follows:

`docker/mcp/profiles/runtime-observe.yaml`

```yaml
profile:
  id: runtime-observe
  displayName: Runtime Observe
  sessionMode: toolbox-activated
  includeServers:
    - mimir-control
    - mimir-core
    - grafana-observe
    - docker-read
    - kubernetes-read
  allowedCategories:
    - repo-read
    - internal-memory
    - logs-read
    - metrics-read
    - traces-read
    - docker-read
    - k8s-read
    - k8s-logs-read
    - k8s-events-read
  deniedCategories:
    - github-write
    - docker-write
    - deployment
  fallbackProfile: core-dev
```

`docker/mcp/profiles/core-dev+runtime-observe.yaml`

```yaml
profile:
  id: core-dev+runtime-observe
  displayName: Core Dev Plus Runtime Observe
  sessionMode: toolbox-activated
  baseProfiles:
    - core-dev
    - runtime-observe
  compositeReason: repeated_workflow
  includeServers:
    - mimir-control
    - mimir-core
    - grafana-observe
    - docker-read
    - kubernetes-read
  allowedCategories:
    - repo-read
    - repo-write
    - local-docs
    - internal-memory
    - internal-memory-write
    - logs-read
    - metrics-read
    - traces-read
    - docker-read
    - k8s-read
    - k8s-logs-read
    - k8s-events-read
  deniedCategories:
    - github-write
    - docker-write
    - deployment
  fallbackProfile: runtime-observe
```

`docker/mcp/profiles/runtime-admin.yaml`

```yaml
profile:
  id: runtime-admin
  displayName: Runtime Admin
  sessionMode: toolbox-activated
  includeServers:
    - mimir-control
    - mimir-core
    - grafana-observe
    - docker-read
    - kubernetes-read
    - docker-admin
  allowedCategories:
    - repo-read
    - internal-memory
    - logs-read
    - metrics-read
    - traces-read
    - docker-read
    - k8s-read
    - k8s-logs-read
    - k8s-events-read
    - docker-write
  deniedCategories:
    - deployment
  fallbackProfile: runtime-observe
```

`docker/mcp/profiles/full.yaml`

```yaml
profile:
  id: full
  displayName: Full Access
  sessionMode: toolbox-activated
  includeServers:
    - mimir-control
    - mimir-core
    - github-read
    - github-write
    - brave-search
    - docker-docs
    - microsoft-learn
    - grafana-observe
    - docker-read
    - kubernetes-read
    - docker-admin
  allowedCategories:
    - repo-read
    - repo-write
    - local-docs
    - internal-memory
    - internal-memory-write
    - docs-search
    - web-search
    - github-read
    - github-write
    - logs-read
    - metrics-read
    - traces-read
    - docker-read
    - k8s-read
    - k8s-logs-read
    - k8s-events-read
    - docker-write
    - model-inference
    - deployment
  deniedCategories: []
  fallbackProfile: delivery-admin
```

- [ ] **Step 5: Re-run the CLI and MCP suites and then the full toolbox slice**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-cli.test.mjs tests/e2e/mimir-control-mcp.test.mjs
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-manifest-contracts.test.mjs tests/e2e/toolbox-cli.test.mjs tests/e2e/mimir-control-mcp.test.mjs tests/e2e/toolbox-session-lease.test.mjs tests/e2e/docker-toolbox-sync.test.mjs tests/e2e/command-catalog.test.mjs
```

Expected:

- first command PASS
- second command PASS with the broader toolbox regression slice still green

- [ ] **Step 6: Commit the runtime wiring slice**

Run:

```powershell
git add docker/mcp/intents.yaml docker/mcp/profiles/runtime-observe.yaml docker/mcp/profiles/core-dev+runtime-observe.yaml docker/mcp/profiles/runtime-admin.yaml docker/mcp/profiles/full.yaml tests/e2e/toolbox-cli.test.mjs tests/e2e/mimir-control-mcp.test.mjs
git commit -m "feat: add kubernetes read access to runtime toolboxes"
```

## Sprint 3: Keep Docker Runtime Planning And Installer Audits Aligned

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\scripts\docker\audit-toolbox-assets.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\tests\e2e\docker-toolbox-sync.test.mjs`
- Modify: `F:\Dev\scripts\Mimir\mimir\tests\e2e\windows-installer-cli.test.mjs`

- [ ] **Step 1: Add failing sync and installer assertions for the Kubernetes peer**

In `tests/e2e/docker-toolbox-sync.test.mjs`, add these checks:

```js
  assert.ok(first.servers.some((server) => server.id === "kubernetes-read"));

  const runtimeObserveCommand = payload.apply.plan.commands.find(
    (command) => command.profileId === "runtime-observe"
  );
  assert.ok(runtimeObserveCommand);
  assert.ok(
    runtimeObserveCommand.serverRefs.includes(
      "catalog://mcp/docker-mcp-catalog/kubernetes-read"
    )
  );
```

In `tests/e2e/windows-installer-cli.test.mjs`, extend the `audit-toolbox-assets` and `prepare-toolbox-runtime` assertions with:

```js
  assert.ok(
    envelope.details.toolboxAssets.runtimePlan.serverIds.includes("kubernetes-read")
  );
  assert.ok(
    envelope.details.toolboxAssets.runtimePlan.profileIds.includes("runtime-observe")
  );
  assert.ok(
    writtenPlan.servers.some((server) => server.id === "kubernetes-read")
  );
```

- [ ] **Step 2: Run the sync and installer suites and verify they fail before the audit script is extended**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/docker-toolbox-sync.test.mjs tests/e2e/windows-installer-cli.test.mjs
```

Expected: FAIL because `audit-toolbox-assets.mjs` only returns runtime plan counts today.

- [ ] **Step 3: Extend the toolbox asset audit JSON with runtime plan ids**

Update `scripts/docker/audit-toolbox-assets.mjs` so the valid report exposes deterministic server/profile ids:

```js
    runtimePlan: {
      generatedAt: runtimePlan.generatedAt,
      serverCount: runtimePlan.servers.length,
      profileCount: runtimePlan.profiles.length,
      serverIds: runtimePlan.servers.map((server) => server.id),
      profileIds: runtimePlan.profiles.map((profile) => profile.id)
    },
```

Also extend the invalid report shape so it stays schema-stable:

```js
    runtimePlan: {
      generatedAt: null,
      serverCount: 0,
      profileCount: 0,
      serverIds: [],
      profileIds: []
    },
```

Keep the arrays sorted by relying on the already sorted runtime plan.

- [ ] **Step 4: Re-run the sync and installer suites**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/docker-toolbox-sync.test.mjs tests/e2e/windows-installer-cli.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run the installer audit commands on the current machine and record the actual runtime-plan state**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\cli.ps1 -Operation audit-toolbox-assets -Json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\cli.ps1 -Operation prepare-toolbox-runtime -Json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\cli.ps1 -Operation plan-docker-mcp-toolkit-apply -Json
```

Expected:

- `audit-toolbox-assets`: `status` is `success` and `runtimePlan.serverIds` includes `kubernetes-read`
- `prepare-toolbox-runtime`: `status` is `success` and the written runtime plan includes a `kubernetes-read` server entry
- `plan-docker-mcp-toolkit-apply`: either
  - `status` is `success` with `compatibleWithCurrentToolkit: true`, or
  - `status` is `user_action_required` with `reasonCode: "docker_mcp_toolkit_apply_plan_blocked"` and a `blockedReasons` entry that mentions the missing Docker `profile` surface

- [ ] **Step 6: Commit the runtime-plan alignment slice**

Run:

```powershell
git add scripts/docker/audit-toolbox-assets.mjs tests/e2e/docker-toolbox-sync.test.mjs tests/e2e/windows-installer-cli.test.mjs
git commit -m "test: align toolbox runtime audits with kubernetes peer band"
```

## Sprint 4: Refresh Documentation And Backlog Status From The New Baseline

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\operations\docker-toolbox-v1.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\reference\interfaces.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\planning\current-implementation.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\planning\backlog.md`

- [ ] **Step 1: Update the toolbox operations guide with the Kubernetes read-only scope**

Add this paragraph to `documentation/operations/docker-toolbox-v1.md` under the runtime-model/operator sections:

```md
`runtime-observe`, `core-dev+runtime-observe`, `runtime-admin`, and `full` now include the `kubernetes-read` peer band. V1 keeps that band read-only: cluster inspection, namespace/workload listing, event reads, and log queries are available, but no Kubernetes mutation or deploy tool is exposed.
```

- [ ] **Step 2: Update the interface reference so active-toolbox responses document Kubernetes read-only descriptors**

Add this note to `documentation/reference/interfaces.md` in the toolbox control section:

```md
Observation-oriented profiles may now expose Kubernetes read-only descriptors through `list_active_tools`, including `kubernetes.context.inspect`, `kubernetes.namespaces.list`, `kubernetes.workloads.list`, `kubernetes.events.list`, and `kubernetes.logs.query`. No `kubernetes` mutation tool is part of v1.
```

- [ ] **Step 3: Update the current-implementation snapshot to reflect the new peer band**

Replace the toolbox partial-area bullet in `documentation/planning/current-implementation.md` with this line:

```md
- broader toolbox rollout beyond the current curated peer bands, including target-machine Docker Toolkit validation and future approval-gated Kubernetes mutation
```

Also add this sentence to the toolbox control-plane section:

```md
- category-owned peer curation for docs/web research, GitHub read/write split, Grafana observe, Docker read/admin split, and Kubernetes read-only observation
```

- [ ] **Step 4: Update the toolbox backlog row states from the post-implementation reality**

Update the `Active Toolbox Workstream` table in `documentation/planning/backlog.md` to these statuses after the first three sprints pass:

```md
| TB-004 | Docker runtime sync and installer compatibility gates for toolbox rollout | Plan-first sync, deterministic dry-run output, installer audits, and compatibility blockers exist; current-machine validation is in place, but broader target-machine rollout validation is still pending | partial |
| TB-005 | Add a read-only Kubernetes peer band for toolbox runtime observation | Kubernetes read-only categories, peer manifest, profile wiring, and regression coverage are implemented for observation toolboxes | done |
| TB-006 | Add approval-gated Kubernetes mutation to `runtime-admin` and `delivery-admin` | Still intentionally blocked until the read-only band is stable in real use and the operator approval surface is extended for Kubernetes mutation | blocked |
| TB-007 | Validate reconnect presets and Docker Toolkit apply behavior across target client environments | Current-machine validation is in place, but cross-environment rollout validation still needs explicit target-machine execution | partial |
```

- [ ] **Step 5: Re-run the verified toolbox slice once more and confirm the docs now match the shipped behavior**

Run:

```powershell
corepack pnpm --dir F:\Dev\scripts\Mimir\mimir exec node --test tests/e2e/toolbox-manifest-contracts.test.mjs tests/e2e/toolbox-cli.test.mjs tests/e2e/mimir-control-mcp.test.mjs tests/e2e/toolbox-session-lease.test.mjs tests/e2e/docker-toolbox-sync.test.mjs tests/e2e/command-catalog.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the documentation/backlog refresh**

Run:

```powershell
git add documentation/operations/docker-toolbox-v1.md documentation/reference/interfaces.md documentation/planning/current-implementation.md documentation/planning/backlog.md
git commit -m "docs: refresh toolbox backlog after kubernetes observe slice"
```

## Deferred After This Plan: Approval-Gated Kubernetes Mutation

Do not implement this in the current slice. Keep it explicitly blocked.

When `TB-006` starts later, the likely files are:

- `F:\Dev\scripts\Mimir\mimir\docker\mcp\categories.yaml`
- `F:\Dev\scripts\Mimir\mimir\docker\mcp\servers\kubernetes-admin.yaml`
- `F:\Dev\scripts\Mimir\mimir\docker\mcp\intents.yaml`
- `F:\Dev\scripts\Mimir\mimir\docker\mcp\profiles\runtime-admin.yaml`
- `F:\Dev\scripts\Mimir\mimir\docker\mcp\profiles\delivery-admin.yaml`
- `F:\Dev\scripts\Mimir\mimir\docker\mcp\profiles\full.yaml`
- `F:\Dev\scripts\Mimir\mimir\tests\e2e\toolbox-cli.test.mjs`
- `F:\Dev\scripts\Mimir\mimir\tests\e2e\mimir-control-mcp.test.mjs`
- `F:\Dev\scripts\Mimir\mimir\tests\e2e\toolbox-session-lease.test.mjs`

Blocker rule:

- Do not add `k8s-write`, `k8s-admin`, or deployment-capable Kubernetes tools until the read-only band has shipped cleanly and operator approval semantics are extended beyond the current Docker-only admin path.

## Self-Review

### Spec coverage

- `TB-004` is covered by Sprint 3 and Sprint 4.
- `TB-005` is covered by Sprint 1 and Sprint 2.
- `TB-007` is covered by Sprint 3 manual installer validation and the Sprint 4 backlog refresh to `partial`.
- `TB-006` is intentionally deferred and kept blocked.

### Placeholder scan

- No unresolved placeholder markers remain in the actionable sprints.
- Every sprint names exact files, commands, and concrete YAML/test snippets.

### Type and naming consistency

These identifiers must stay consistent across manifests, runtime plans, tests, and docs:

- categories: `k8s-read`, `k8s-logs-read`, `k8s-events-read`
- server: `kubernetes-read`
- tool ids: `kubernetes.context.inspect`, `kubernetes.namespaces.list`, `kubernetes.workloads.list`, `kubernetes.pods.list`, `kubernetes.events.list`, `kubernetes.logs.query`
- semantic capability ids: `kubernetes.context.inspect`, `kubernetes.namespace.list`, `kubernetes.workload.list`, `kubernetes.pod.list`, `kubernetes.events.list`, `kubernetes.logs.query`
