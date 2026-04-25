# Codex Default VoltAgent Stable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make VoltAgent the stable default workflow in Codex by using native Codex skill discovery for activation, keeping `codex-claude-voltagent-client` as the shared runtime harness for Codex and Claude, and enforcing deterministic Claude role and skill-pack selection.

**Architecture:** Codex activation should be instruction-first and skill-first, matching the existing Superpowers installation model. The external client package remains the shared runtime layer for Workspace skills, Claude escalation, and Mimir access. The plugin shell stays available for bootstrap, diagnostics, and route inspection, but it is not the primary activation mechanism.

**Tech Stack:** TypeScript, Node.js, `@voltagent/core`, Zod, Vitest, Codex native skill discovery, MCP stdio transport.

---

## Why this plan

This repository already has the hard part of the runtime:

- local VoltAgent runtime and workspace mounting
- Mimir MCP adapter
- cached read surface
- route classifier
- Claude profile registry
- plugin shell scripts for bootstrap, diagnostics, and handoff generation

What it does **not** have yet is the most stable Codex-facing activation path:

- no top-level `skills/` tree for native Codex discovery
- no Superpowers-style `.codex/INSTALL.md`
- no canonical "default workflow" skill that teaches Codex when to use the harness
- bootstrap still depends on explicit Mimir command arguments instead of reading Codex's existing MCP config

The safest rollout is therefore:

1. native Codex skill discovery first
2. explicit default workflow instructions second
3. shared runtime reuse third
4. optional plugin shell usage for diagnostics/bootstrap only

This avoids relying on undocumented Codex startup hooks or VoltAgent preview workflows for the default path.

## Current source map

### Existing runtime and config

- `src/config/schema.ts`
- `src/config/load-client-config.ts`
- `src/runtime/client-voltagent-runtime.ts`
- `src/runtime/create-client-workspace.ts`
- `src/runtime/workspace-skill-policy.ts`
- `src/entrypoints/create-codex-client.ts`
- `src/entrypoints/create-claude-client.ts`
- `src/entrypoints/create-codex-runtime.ts`
- `src/entrypoints/create-claude-runtime.ts`
- `src/entrypoints/create-client-surface.ts`
- `src/mimir/mimir-command-adapter.ts`
- `src/mimir/stdio-mimir-transport.ts`
- `src/mimir/create-cached-mimir-command-surface.ts`
- `src/router/client-task-router.ts`
- `src/escalation/claude-profile-registry.ts`
- `src/diagnostics/client-status.ts`

### Existing plugin shell

- `plugins/codex-voltagent-default/.codex-plugin/plugin.json`
- `plugins/codex-voltagent-default/scripts/*.mjs`
- `plugins/codex-voltagent-default/skills/*/SKILL.md`

### Existing tests

- `tests/runtime/client-voltagent-runtime.test.ts`
- `tests/router/client-task-router.test.ts`
- `tests/integration/composed-client-surface.test.ts`
- `tests/plugin/plugin-shell.test.ts`
- `tests/plugin/plugin-init-config.test.ts`
- `tests/plugin/plugin-bootstrap-default-runtime.test.ts`
- `tests/plugin/plugin-claude-handoff.test.ts`
- `tests/plugin/plugin-claude-auto-handoff.test.ts`
- `tests/plugin/plugin-composition.test.ts`
- `tests/docs/public-docs.test.ts`

## Target file structure

### New top-level Codex-native skill surface

- Create: `skills/voltagent-default-workflow/SKILL.md`
- Create: `skills/voltagent-status/SKILL.md`
- Create: `skills/voltagent-doctor/SKILL.md`
- Create: `skills/voltagent-bootstrap-default-runtime/SKILL.md`
- Create: `skills/voltagent-route-preview/SKILL.md`
- Create: `skills/voltagent-profiles/SKILL.md`
- Create: `skills/voltagent-claude-handoff/SKILL.md`
- Create: `skills/voltagent-claude-auto-handoff/SKILL.md`
- Create: `skills/voltagent-enable/SKILL.md`
- Create: `skills/voltagent-disable/SKILL.md`

### Codex install/bootstrap docs and scripts

- Create: `.codex/INSTALL.md`
- Create: `scripts/install-codex.ps1`
- Create: `scripts/install-codex.sh`

### Runtime/bootstrap enhancements

- Modify: `src/config/schema.ts`
- Modify: `src/config/load-client-config.ts`
- Modify: `src/diagnostics/client-status.ts`
- Modify: `src/escalation/claude-profile-registry.ts`
- Modify: `plugins/codex-voltagent-default/scripts/lib/init-client-config.mjs`
- Modify: `plugins/codex-voltagent-default/scripts/bootstrap-default-runtime.mjs`
- Modify: `plugins/codex-voltagent-default/scripts/doctor.mjs`
- Modify: `plugins/codex-voltagent-default/scripts/status.mjs`
- Modify: `plugins/codex-voltagent-default/scripts/route-preview.mjs`

### Documentation

- Modify: `README.md`
- Modify: `plugins/codex-voltagent-default/README.md`
- Create: `docs/codex-default-activation.md`

### Tests

- Create: `tests/skills/codex-native-skills.test.ts`
- Modify: `tests/plugin/plugin-init-config.test.ts`
- Modify: `tests/plugin/plugin-bootstrap-default-runtime.test.ts`
- Modify: `tests/plugin/plugin-controls.test.ts`
- Modify: `tests/plugin/plugin-claude-handoff.test.ts`
- Modify: `tests/plugin/plugin-claude-auto-handoff.test.ts`
- Modify: `tests/plugin/plugin-composition.test.ts`
- Modify: `tests/docs/public-docs.test.ts`

## Invariants

These rules are not optional:

1. **Native activation first**
   - Codex default behavior must come from `~/.codex/skills` discovery and instruction surfaces, not hidden plugin lifecycle assumptions.

2. **Mimir remains narrow**
   - only retrieval, context packet assembly, local execution, traces, and governed writes go to Mimir.

3. **Claude profile selection is client-owned**
   - model does not choose `roleId`
   - model does not choose `skillPackId`
   - profile is selected in client code before handoff

4. **Claude escalation depth is bounded**
   - max Claude escalation depth is `1`
   - Claude escalation cannot recursively trigger another Claude escalation

5. **Skill packs are allowlist-only**
   - do not union in all discovered skills
   - preserve explicit, ordered per-profile skill lists

6. **VoltAgent workspace prompt injection must remain enabled**
   - if custom `onPrepareMessages` is used, explicitly set `workspaceSkillsPrompt`
   - or chain `workspace.createSkillsPromptHook(...)`

7. **Do not use VoltAgent Workflows in the default path**
   - Workflows are preview and should not be a release-critical dependency for Codex default activation.

## Task 1: Promote plugin skills into a native Codex skill tree

**Files:**
- Create: `skills/voltagent-default-workflow/SKILL.md`
- Create: `skills/voltagent-status/SKILL.md`
- Create: `skills/voltagent-doctor/SKILL.md`
- Create: `skills/voltagent-bootstrap-default-runtime/SKILL.md`
- Create: `skills/voltagent-route-preview/SKILL.md`
- Create: `skills/voltagent-profiles/SKILL.md`
- Create: `skills/voltagent-claude-handoff/SKILL.md`
- Create: `skills/voltagent-claude-auto-handoff/SKILL.md`
- Create: `skills/voltagent-enable/SKILL.md`
- Create: `skills/voltagent-disable/SKILL.md`
- Test: `tests/skills/codex-native-skills.test.ts`

- [ ] Copy the current plugin skill prompts into a new top-level `skills/` tree.
- [ ] Add one new `voltagent-default-workflow` skill that explains the stable routing contract:
  - use VoltAgent runtime for local Workspace skill work and paid orchestration
  - use Mimir for retrieval, local coding execution, and governed writes
  - use Claude only through named profiles
- [ ] Keep the skill prompts tool-light: they should point to existing scripts instead of embedding runtime logic in prompt text.
- [ ] Add tests that assert:
  - the new `skills/` tree exists
  - all expected `SKILL.md` files are present
  - plugin skills and top-level skills stay in sync for overlapping names

**Acceptance criteria:**
- Codex can discover a top-level VoltAgent skill pack through a simple `~/.codex/skills` junction.
- The canonical default workflow exists as a native skill, not only inside the plugin shell.

## Task 2: Add Superpowers-style Codex installation and update path

**Files:**
- Create: `.codex/INSTALL.md`
- Create: `scripts/install-codex.ps1`
- Create: `scripts/install-codex.sh`
- Modify: `README.md`
- Test: `tests/docs/public-docs.test.ts`

- [ ] Write installation docs that mirror the proven Superpowers pattern:
  - clone repo
  - create `~/.codex/skills/voltagent-default` junction/symlink to this repo's `skills/`
  - restart Codex
- [ ] Add PowerShell and shell installers for:
  - creating `~/.codex/skills`
  - creating the symlink/junction
  - reporting success/failure clearly
- [ ] Update `README.md` to describe two modes explicitly:
  - native Codex skill installation (primary)
  - plugin shell install (optional)
- [ ] Update docs tests to assert the new install docs mention native skill discovery and do not claim plugin-first activation.

**Acceptance criteria:**
- A user can install VoltAgent default behavior in Codex the same way they install Superpowers.
- The docs no longer imply the plugin shell is the primary activation path.

## Task 3: Auto-read the existing Codex Mimir MCP config during bootstrap

**Files:**
- Modify: `plugins/codex-voltagent-default/scripts/lib/init-client-config.mjs`
- Modify: `plugins/codex-voltagent-default/scripts/bootstrap-default-runtime.mjs`
- Modify: `src/config/schema.ts`
- Modify: `src/config/load-client-config.ts`
- Modify: `tests/plugin/plugin-init-config.test.ts`
- Modify: `tests/plugin/plugin-bootstrap-default-runtime.test.ts`

- [ ] Add support for reading `C:\Users\<user>\.codex\config.toml` by default on Windows, with equivalent `$HOME/.codex/config.toml` support on POSIX.
- [ ] Parse the existing `mcp_servers.mimir` entry and use it to seed:
  - `mimir.serverCommand`
  - `mimir.serverArgs`
  - `mimir.transport`
- [ ] Preserve existing manual overrides:
  - explicit `--mimir-command`
  - explicit `--mimir-arg`
- [ ] Fail with a clear diagnostic if neither Codex config nor explicit args define a valid Mimir MCP command.
- [ ] Expand the config schema only if needed for source metadata, and keep it backward-compatible.

**Acceptance criteria:**
- Bootstrap works out of the box on machines where Codex already has a `mimir` MCP server configured.
- Explicit overrides still win when present.

## Task 4: Harden the Claude profile and skill-pack contract

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/escalation/claude-profile-registry.ts`
- Modify: `plugins/codex-voltagent-default/scripts/lib/claude-handoff.mjs`
- Modify: `plugins/codex-voltagent-default/scripts/claude-handoff.mjs`
- Modify: `plugins/codex-voltagent-default/scripts/claude-auto-handoff.mjs`
- Modify: `tests/escalation/claude-profile-registry.test.ts`
- Modify: `tests/plugin/plugin-claude-handoff.test.ts`
- Modify: `tests/plugin/plugin-claude-auto-handoff.test.ts`

- [ ] Enforce ordered allowlist semantics for skill packs.
- [ ] Add explicit validation that:
  - a profile cannot reference an empty skill pack
  - duplicate skills inside a pack are rejected or normalized deterministically
  - escalation reasons resolve to exactly one profile in auto mode
- [ ] Add explicit depth metadata to handoff envelopes and reject depth > 1.
- [ ] Keep the model chain deterministic:
  - primary first
  - fallback order preserved exactly
- [ ] Ensure the generated handoff always includes:
  - `profileId`
  - `roleId`
  - `skillPackId`
  - ordered skills
  - reason
  - depth
  - output mode/schema marker

**Acceptance criteria:**
- Claude handoff is deterministic, reproducible, and model-independent.
- Auto mode never produces ambiguous profile selection.

## Task 5: Add a stable default-workflow instruction surface

**Files:**
- Create: `skills/voltagent-default-workflow/SKILL.md`
- Create: `docs/codex-default-activation.md`
- Modify: `README.md`
- Modify: `tests/docs/public-docs.test.ts`

- [ ] Write the default workflow skill as the canonical operator guide for Codex.
- [ ] Document the route policy in one place:
  - `client-skill`
  - `client-paid-runtime`
  - `mimir-retrieval`
  - `mimir-local-execution`
  - `mimir-memory-write`
  - `claude-escalation`
- [ ] State the Claude selection rule explicitly:
  - client selects profile
  - model does not select its own role or skills
- [ ] State the failure/degradation policy:
  - without Mimir: local skills still work, governed-write/local-execution routes do not
  - without Claude config: manual/auto Claude routes are blocked, not silently degraded into fuzzy paid calls

**Acceptance criteria:**
- A new Codex user can understand the runtime boundary and escalation policy from one canonical document and one canonical skill.

## Task 6: Keep the plugin shell but demote it to diagnostics/bootstrap

**Files:**
- Modify: `plugins/codex-voltagent-default/README.md`
- Modify: `plugins/codex-voltagent-default/scripts/status.mjs`
- Modify: `plugins/codex-voltagent-default/scripts/doctor.mjs`
- Modify: `plugins/codex-voltagent-default/scripts/route-preview.mjs`
- Modify: `tests/plugin/plugin-shell.test.ts`
- Modify: `tests/plugin/plugin-controls.test.ts`
- Modify: `tests/plugin/plugin-composition.test.ts`

- [ ] Rewrite plugin docs so the plugin is described as:
  - diagnostics surface
  - bootstrap helper
  - route/profile inspection helper
- [ ] Make `status` print whether the workspace is using:
  - native skill install only
  - plugin shell present
  - both
- [ ] Make `doctor` check:
  - `client-config.json`
  - Codex config presence
  - Mimir MCP resolution
  - skill root existence
  - missing profile skill IDs
  - missing provider keys for active mode
- [ ] Make `route-preview` show the exact resolved profile and ordered skills when Claude is selected.

**Acceptance criteria:**
- The plugin remains useful, but the docs and scripts no longer position it as the default activation path.

## Task 7: Verify workspace skill behavior remains correct under hooks

**Files:**
- Modify: `src/runtime/client-voltagent-runtime.ts`
- Modify: `src/runtime/create-client-workspace.ts`
- Modify: `src/runtime/workspace-skill-policy.ts`
- Modify: `tests/runtime/client-voltagent-runtime.test.ts`
- Modify: `tests/integration/composed-client-surface.test.ts`

- [ ] Audit current runtime hook usage for any path that could suppress VoltAgent Workspace skill prompt injection.
- [ ] Enforce one safe pattern across the runtime:
  - either explicit `workspaceSkillsPrompt`
  - or explicit `workspace.createSkillsPromptHook(...)` chaining
- [ ] Add tests proving:
  - available skills are still injected under the chosen runtime path
  - custom message hooks do not silently disable Workspace skill prompts

**Acceptance criteria:**
- VoltAgent Workspace skill behavior is stable and survives future hook customization.

## Task 8: Release gating and final docs cleanup

**Files:**
- Modify: `README.md`
- Modify: `docs/mimir-boundary.md`
- Modify: `docs/codex-default-activation.md`
- Modify: `tests/docs/public-docs.test.ts`

- [ ] Update the top-level README quick start to use the native skill install path first.
- [ ] Keep `docs/mimir-boundary.md` aligned with the new activation model:
  - Codex/Claude own skills, subagents, paid quality
  - Mimir owns memory and local execution
- [ ] Add one rollout note for future work:
  - startup/session auto-bootstrap is not the baseline
  - revisit only if Codex exposes a documented stable hook
- [ ] Ensure public docs do not claim VoltAgent Workflows or hidden plugin boot as the default path.

**Acceptance criteria:**
- Public docs tell a consistent story about stability, activation, and boundaries.

## Verification gates

Run after each task as appropriate:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Focused checks:

```bash
pnpm test -- --run tests/plugin/plugin-init-config.test.ts
pnpm test -- --run tests/plugin/plugin-bootstrap-default-runtime.test.ts
pnpm test -- --run tests/plugin/plugin-claude-handoff.test.ts
pnpm test -- --run tests/plugin/plugin-claude-auto-handoff.test.ts
pnpm test -- --run tests/runtime/client-voltagent-runtime.test.ts
pnpm test -- --run tests/integration/composed-client-surface.test.ts
pnpm test -- --run tests/docs/public-docs.test.ts
```

Manual smoke checks:

1. Install native skills through the new `.codex/INSTALL.md` path.
2. Restart Codex and confirm the new VoltAgent skills are discoverable.
3. Run the bootstrap with no explicit Mimir command args on a machine that already has `mcp_servers.mimir` configured.
4. Generate a manual Claude handoff and confirm it includes deterministic role and skill-pack metadata.
5. Preview an auto route and confirm it resolves to one profile only.

## Rollout order

Implement in this order:

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
8. Task 8

Reason:
- Tasks 1 and 2 establish the stable Codex-native activation path.
- Task 3 removes the biggest setup fragility.
- Task 4 hardens the Claude contract before the default workflow depends on it.
- Tasks 5 and 6 align instructions and tooling around the stable path.
- Task 7 prevents a known VoltAgent hook regression.
- Task 8 closes the release/docs loop.

## Out of scope

Do not include these in this implementation unless explicitly approved later:

- hidden Codex startup hooks
- background daemon/process ownership changes
- VoltAgent Workflows as the default route engine
- Mimir-side Workspace skill execution
- recursive Claude escalation
- profile selection delegated to the model

## Definition of done

This work is done when:

- VoltAgent can be installed in Codex through native skill discovery exactly like Superpowers-style installs.
- Codex has a canonical default workflow skill for using the shared VoltAgent harness.
- Bootstrap can auto-read the existing Codex `mimir` MCP config in the normal case.
- Claude escalation is deterministic and profile-driven.
- Plugin shell remains available, but is clearly secondary to native skill activation.
- The runtime preserves VoltAgent Workspace skill prompt behavior under custom hooks.
