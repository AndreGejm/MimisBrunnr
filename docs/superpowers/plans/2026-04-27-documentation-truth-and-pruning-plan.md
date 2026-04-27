# Documentation Truth And Pruning Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workspace documentation descriptive, factual, and current by removing stale claims, collapsing duplicate current-state guidance, and clearly marking historical material as historical.

**Architecture:** Treat documentation as three layers: current-state canonical docs, supporting operator/contributor docs, and historical phase docs. Rewrite the first layer to match code, prune or tighten the second layer so it does not compete with canonical docs, and either mark or remove stale imperative language from the historical layer.

**Tech Stack:** Markdown, PowerShell, `git`, `Select-String`, existing repo docs under `documentation/` and `docs/`

---

## File Structure

### Canonical current-state docs

- `F:\Dev\scripts\Mimir\mimir\documentation\architecture\overview.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\architecture\module-map.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\architecture\session-semantics.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\operations\docker-toolbox-v1.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\operations\running.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\operations\voltagent-runtime.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\reference\interfaces.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\reference\repo-map.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\reference\external-client-boundary.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\planning\current-implementation.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\planning\backlog.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\planning\go-live-gates.md`

### Supporting operator, setup, and contributor docs

- `F:\Dev\scripts\Mimir\mimir\documentation\setup\installation.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\setup\windows-installer.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\setup\windows-installer-contracts.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\setup\development-workflow.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\apps\mimir-cli.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\scripts\README.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\CONTRIBUTING.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\release\contributor-beta-readiness.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\release\RELEASE_NOTES.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\manuals\mimir-complete-manual.md`

### Historical phase docs that should not read like live behavior

- `F:\Dev\scripts\Mimir\mimir\documentation\superpowers\specs\2026-04-18-mcp-toolbox-v1-implementation-spec.md`
- `F:\Dev\scripts\Mimir\mimir\documentation\superpowers\plans\2026-04-19-mcp-toolbox-v1-remaining-work-plan.md`
- `F:\Dev\scripts\Mimir\mimir\docs\superpowers\plans\2026-04-27-guided-toolbox-authoring-and-workflows.md`
- `F:\Dev\scripts\Mimir\mimir\docs\superpowers\specs\2026-04-24-codex-claude-voltagent-external-integration-design.md`
- `F:\Dev\scripts\Mimir\mimir\docs\superpowers\specs\2026-04-25-global-voltagent-default-activation-design.md`

### Source-of-truth code surfaces to verify against while editing docs

- `F:\Dev\scripts\Mimir\mimir\apps\mimir-cli\src\main.ts`
- `F:\Dev\scripts\Mimir\mimir\apps\mimir-mcp\src\main.ts`
- `F:\Dev\scripts\Mimir\mimir\apps\mimir-control-mcp\src\main.ts`
- `F:\Dev\scripts\Mimir\mimir\apps\mimir-toolbox-mcp\src\main.ts`
- `F:\Dev\scripts\Mimir\mimir\apps\mimir-toolbox-mcp\src\session-state.ts`
- `F:\Dev\scripts\Mimir\mimir\packages\contracts\src\toolbox\policy.contract.ts`
- `F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\toolbox\control-surface.ts`
- `F:\Dev\scripts\Mimir\mimir\docker\mcp\bands\*.yaml`
- `F:\Dev\scripts\Mimir\mimir\docker\mcp\workflows\*.yaml`
- `F:\Dev\scripts\Mimir\mimir\docker\mcp\profiles\*.yaml`

## Documentation rules for this plan

- Current-state docs must describe only behavior that exists in the repo now.
- Historical docs may remain, but they must not sound like the current runtime contract.
- When a document duplicates live truth and adds no unique value, remove or replace the stale section instead of adding more caveats.
- Prefer "this exists / this is blocked / this is partial" over roadmap phrasing in current-state docs.
- Do not document Docker-native profile support as live if the installed toolkit on this machine still lacks it.
- Do not describe reconnect-only activation as the whole toolbox story; the dynamic broker now exists and must be reflected wherever session behavior is explained.

## Task 1: Audit the documentation set for stale claims and duplicate ownership

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\planning\backlog.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\planning\current-implementation.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\planning\go-live-gates.md`
- Inspect: all files listed in "Canonical current-state docs"

- [ ] **Step 1: Search for high-risk stale phrases**

Run:

```powershell
Get-ChildItem documentation docs -Recurse -File | Select-String -Pattern 'profile-bound sessions only|reconnect/fork only|Recommended earliest target for all-workspace default rollout|docker mcp profile|only stable MCP surface|current repo also includes|historical context' | Select-Object Path, LineNumber, Line
```

Expected:
- we get a concrete list of docs still using older toolbox or rollout language

- [ ] **Step 2: Review current-state planning docs against live code surfaces**

Open and verify against the code/source files:

- `documentation/planning/current-implementation.md`
- `documentation/planning/backlog.md`
- `documentation/planning/go-live-gates.md`
- `apps/mimir-toolbox-mcp/src/main.ts`
- `apps/mimir-cli/src/main.ts`

Expected:
- we can point to the exact docs that remain canonical for current behavior
- any contradictions are noted before editing

- [ ] **Step 3: Write a short audit note into the plan execution log**

Add a temporary working note outside tracked docs, for example in the task log or commit description, listing:

- stale current-state claims
- duplicate docs competing for authority
- historical docs that need a status note rather than a rewrite

Expected:
- we have an explicit edit list before touching more docs

## Task 2: Rewrite current-state architecture and runtime docs to be authoritative

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\architecture\overview.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\architecture\module-map.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\architecture\session-semantics.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\operations\docker-toolbox-v1.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\operations\running.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\operations\voltagent-runtime.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\reference\interfaces.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\reference\repo-map.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\reference\external-client-boundary.md`

- [ ] **Step 1: Align architecture docs to the live transport set**

Make sure these docs explicitly reflect:

- `apps/mimir-mcp`
- `apps/mimir-control-mcp`
- `apps/mimir-toolbox-mcp`
- broker-driven `tools/list_changed`
- authored `bands` and `workflows`
- compatibility `profiles` as compiled artifacts

Expected:
- no architecture doc still implies the thin core MCP adapter is the whole story

- [ ] **Step 2: Align session semantics to the real session model**

In `session-semantics.md`, ensure the doc states:

- `legacy-direct`, `toolbox-bootstrap`, and `toolbox-activated`
- `broker-dynamic` and `compatibility-reconnect`
- idle and lease-expiry contraction
- same-session visibility change through `notifications/tools/list_changed`

Expected:
- the session doc matches `apps/mimir-toolbox-mcp/src/main.ts` and
  `apps/mimir-toolbox-mcp/src/session-state.ts`

- [ ] **Step 3: Align interfaces to the real CLI and MCP control surface**

Verify `interfaces.md` against `apps/mimir-cli/src/main.ts` and ensure it lists:

- `list-toolbox-servers`
- `scaffold-toolbox`
- `preview-toolbox`
- `sync-toolbox-runtime`
- the six toolbox lifecycle commands
- the broker's dynamic tool-surface behavior

Expected:
- the interface doc is complete enough that an operator can trust it without
  reading `main.ts`

## Task 3: Tighten setup, installer, and contributor docs so they point to the right canon

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\setup\installation.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\setup\windows-installer.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\setup\windows-installer-contracts.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\setup\development-workflow.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\apps\mimir-cli.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\scripts\README.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\CONTRIBUTING.md`

- [ ] **Step 1: Remove outdated one-path setup language**

Check these files for any implication that:

- Docker-native profile apply is generally available now
- Codex is the only meaningful client concept everywhere
- reconnect-only flows are the whole toolbox model

Expected:
- setup docs describe what exists now and what remains optional or blocked

- [ ] **Step 2: Make contributor docs point to the right source of truth**

Ensure contributor-facing docs send readers to:

- `documentation/reference/interfaces.md`
- `documentation/operations/docker-toolbox-v1.md`
- `documentation/architecture/session-semantics.md`

and not to outdated plans for live behavior.

Expected:
- new contributors know which docs are authoritative and which are historical

- [ ] **Step 3: Keep installer docs factual about current limitations**

Confirm installer docs state:

- read-only audit surfaces exist
- runtime preparation exists
- Docker apply remains blocked or plan-only where true
- client support and handoff readiness are stated exactly as implemented

Expected:
- installer docs do not over-promise GUI/bootstrap or Docker mutation behavior

## Task 4: Prune or mark historical docs so they stop competing with live docs

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\superpowers\specs\2026-04-18-mcp-toolbox-v1-implementation-spec.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\superpowers\plans\2026-04-19-mcp-toolbox-v1-remaining-work-plan.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\docs\superpowers\plans\2026-04-27-guided-toolbox-authoring-and-workflows.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\docs\superpowers\specs\2026-04-24-codex-claude-voltagent-external-integration-design.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\docs\superpowers\specs\2026-04-25-global-voltagent-default-activation-design.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\manuals\mimir-complete-manual.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\release\RELEASE_NOTES.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\release\contributor-beta-readiness.md`

- [ ] **Step 1: Add or tighten status notes at the top of historical docs**

Each historical doc should state one of:

- historical phase spec
- governing boundary still active
- broad manual with newer canonical docs elsewhere

Expected:
- a reader landing on an older file immediately understands whether it is live
  behavior or phase history

- [ ] **Step 2: Remove current-tense claims from historical docs where they are misleading**

Do not rewrite the whole history. Remove or soften only the lines that still
sound like present tense product truth when they no longer are.

Expected:
- historical docs keep useful context without becoming silent sources of drift

- [ ] **Step 3: Replace stale release checkpoint language with status framing**

For release notes or readiness docs that no longer represent the current repo,
add a short pointer to:

- `documentation/planning/current-implementation.md`
- `documentation/planning/backlog.md`

Expected:
- old release docs stop competing with live implementation docs

## Task 5: Decide whether duplicate docs should be rewritten, reduced, or deleted

**Files:**
- Review candidate duplicates found during Task 1
- Possible modify/delete targets:
  - `F:\Dev\scripts\Mimir\mimir\documentation\apps\mimir-cli.md`
  - `F:\Dev\scripts\Mimir\mimir\documentation\scripts\README.md`
  - `F:\Dev\scripts\Mimir\mimir\documentation\manuals\mimir-complete-manual.md`

- [ ] **Step 1: Classify duplicate docs**

For each doc that overlaps with canonical docs, choose one:

- keep as a focused leaf doc
- reduce to a short pointer doc
- delete if it adds no unique value

Expected:
- every surviving doc has a clear purpose instead of repeating broader docs

- [ ] **Step 2: Apply the smallest honest change**

Rules:

- if a leaf doc still helps navigation, keep it short and factual
- if a giant manual is still useful, add status framing instead of pretending it
  is the sole source of truth
- if a file is pure duplication with stale behavior, remove it

Expected:
- the doc set gets smaller or clearer, not just longer

## Task 6: Add a factual documentation maintenance policy

**Files:**
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\CONTRIBUTING.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\setup\development-workflow.md`
- Modify: `F:\Dev\scripts\Mimir\mimir\documentation\planning\backlog.md`

- [ ] **Step 1: Document the three doc classes**

Define:

- canonical current-state docs
- supporting operator/contributor docs
- historical phase docs

Expected:
- future contributors know where to edit instead of creating new drift

- [ ] **Step 2: Document the removal rule**

State explicitly:

- stale or misleading text must be removed or rewritten, not hidden behind
  extra narrative

Expected:
- the repo has a clear maintenance rule for future doc work

- [ ] **Step 3: Add a current verification ritual**

Document that doc changes should be checked with:

```powershell
git diff --check
Get-ChildItem documentation docs -Recurse -File | Select-String -Pattern 'profile-bound sessions only|Recommended earliest target for all-workspace default rollout|only stable MCP surface'
```

Expected:
- future doc passes have a lightweight repeatable truth check

## Task 7: Verification and sign-off

**Files:**
- Verify all edited docs in `documentation/` and `docs/`

- [ ] **Step 1: Run formatting and whitespace verification**

Run:

```powershell
git diff --check
```

Expected:
- no diff errors

- [ ] **Step 2: Run a stale-phrase sweep**

Run:

```powershell
Get-ChildItem documentation docs -Recurse -File | Select-String -Pattern 'profile-bound sessions only|reconnect/fork only|Recommended earliest target for all-workspace default rollout|only stable MCP surface' | Select-Object Path, LineNumber, Line
```

Expected:
- either no hits, or only intentionally historical/status-noted occurrences

- [ ] **Step 3: Spot-check the live canon**

Open and manually verify:

- `documentation/operations/docker-toolbox-v1.md`
- `documentation/reference/interfaces.md`
- `documentation/planning/current-implementation.md`
- `documentation/planning/backlog.md`

Expected:
- these four docs tell a consistent current-state story without relying on
  historical docs

- [ ] **Step 4: Commit the documentation cleanup**

Run:

```bash
git add documentation docs
git commit -m "docs: align toolbox and rollout documentation with current repo state"
```

Expected:
- one focused docs commit with no unrelated code changes

## Acceptance criteria

This plan is complete only when all of the following are true:

1. No current-state doc describes reconnect-only toolbox behavior as the whole system.
2. No current-state doc treats Docker-native profile apply as generally available when it is still blocked on this machine.
3. Canonical docs clearly describe the dynamic broker, bands, workflows, and current rollout blockers.
4. Historical docs are visibly historical or governing-boundary docs, not silent alternate sources of truth.
5. Supporting setup and contributor docs point readers to the correct canonical docs.
6. The doc set is smaller, clearer, or more sharply divided by purpose after the pass.
7. `git diff --check` passes.
8. A stale-phrase sweep shows no misleading live claims outside intentionally historical docs.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-27-documentation-truth-and-pruning-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task group, review between groups, faster doc cleanup with tighter scope
2. **Inline Execution** - execute the plan in this session using an implementation pass with checkpoints
