# Global VoltAgent Default Activation Design

## Summary

Move VoltAgent activation from a workspace-local `client-config.json` model to a
home-global default model under `~/.codex/voltagent/client-config.json`, while
preserving optional workspace-local overrides.

This change is about activation and configuration discovery. It does **not**
change the existing runtime boundary:

- Mimir continues to own durable memory, retrieval, governed writes, and local execution.
- The vendored Codex/Claude VoltAgent client continues to own native skills,
  workspace skill routing, paid orchestration, and deterministic Claude profile selection.

## Problem

The current vendored client requires a workspace-local `client-config.json` for
non-`local-only` runtime modes.

That blocks the desired operating model:

- VoltAgent should be active by default in every existing Codex workspace.
- VoltAgent should also be active by default in every new Codex workspace.
- Users should not have to bootstrap each workspace individually.

Current implementation points enforcing the workspace-local model include:

- `vendor/codex-claude-voltagent-client/src/config/schema.ts`
- `vendor/codex-claude-voltagent-client/plugins/codex-voltagent-default/scripts/lib/client-config.mjs`
- `vendor/codex-claude-voltagent-client/plugins/codex-voltagent-default/scripts/lib/init-client-config.mjs`
- the current Windows installer client-access path, which still writes a
  workspace-scoped config as part of onboarding

## Goals

- Make VoltAgent default-active in all Codex workspaces through a single
  home-global config.
- Preserve workspace-local `client-config.json` as an override surface.
- Keep the current Mimir versus VoltAgent ownership boundary intact.
- Keep current Claude role/profile determinism intact.
- Keep installation one-shot through the existing Mimir Windows installer.

## Non-goals

- No change to Mimir durable-memory authority.
- No change to Claude escalation profile semantics.
- No introduction of VoltAgent workflow state as authoritative memory.
- No requirement that Docker Desktop or toolbox setup become part of core activation.
- No removal of workspace-local config support.

## Current behavior

Current config discovery is effectively workspace-local:

1. installer or onboarding writes `<workspace>/client-config.json`
2. status/doctor/runtime commands expect an explicit config path
3. `runtime.trustedWorkspaceRoots` gates non-`local-only` modes

Current default bootstrap path therefore requires per-workspace setup.

## Target behavior

Config discovery order should become:

1. workspace override: `<workspace>/client-config.json`
2. home-global default: `~/.codex/voltagent/client-config.json`
3. fail only if neither exists

This makes VoltAgent default-active in any Codex workspace once the global
config exists.

Workspace-local config remains available for:

- repo-specific overrides
- temporary testing
- explicit constrained environments

## Design

### 1. Home-global config path

Canonical global config path:

- Windows: `%USERPROFILE%\\.codex\\voltagent\\client-config.json`

This file becomes the primary persistent activation source for VoltAgent.

### 2. Config discovery model

All vendored status, doctor, runtime, and bootstrap helpers should use a shared
discovery rule:

- if `--config` is supplied, use it
- else if `<workspace>/client-config.json` exists, use it
- else use `~/.codex/voltagent/client-config.json`

Commands should report which source was selected:

- `workspace-override`
- `home-global-default`

### 3. Trust model change

The current schema enforces non-empty `runtime.trustedWorkspaceRoots` for
non-`local-only` modes. That must change because it is the main reason
activation is still workspace-scoped.

Replace the effective activation gate with an explicit global trust mode:

- `runtime.workspaceTrustMode = "all-workspaces"`

Recommended compatibility model:

- keep `runtime.trustedWorkspaceRoots` as an optional legacy/override field
- add `runtime.workspaceTrustMode` with allowed values:
  - `"all-workspaces"`
  - `"explicit-roots"`

Behavior:

- `"all-workspaces"` means VoltAgent is active in every workspace by default
- `"explicit-roots"` preserves the old trust-root behavior for local overrides

Default for the home-global config should be:

- `mode = "voltagent-default"`
- `workspaceTrustMode = "all-workspaces"`

### 4. Workspace override semantics

Workspace config remains optional and higher precedence than the global config.

Use cases:

- local testing of different model chains
- repo-specific Claude profile sets
- constrained or disabled VoltAgent behavior in a specific repo

If a workspace-local config exists, it completely overrides the home-global
config for that workspace.

### 5. Installer changes

The single Windows installer should stop requiring a workspace path for the
core activation path.

The default install should write:

- native skill install under `~/.codex/skills/voltagent-default`
- home-global config under `~/.codex/voltagent/client-config.json`
- existing Codex `mimir` MCP wiring

Optional workspace-local bootstrap can remain available as a secondary path, but
it should not be required for normal activation.

### 6. Status and doctor behavior

Status and doctor should report:

- selected config source
- runtime mode
- workspace trust mode
- whether a workspace-local override is shadowing the home-global config
- Mimir connection state
- Claude readiness

With global default enabled:

- status in an arbitrary workspace should show VoltAgent active through
  `home-global-default` unless overridden locally

### 7. Backward compatibility

Existing setups must continue to work.

Compatibility rules:

- existing workspace `client-config.json` files remain valid
- old configs using only `trustedWorkspaceRoots` continue to parse
- new global config uses `workspaceTrustMode = "all-workspaces"`
- local configs may continue using explicit trust roots when desired

## File-level impact

Expected implementation surfaces:

- `vendor/codex-claude-voltagent-client/src/config/schema.ts`
- `vendor/codex-claude-voltagent-client/src/config/load-client-config.ts`
- `vendor/codex-claude-voltagent-client/plugins/codex-voltagent-default/scripts/lib/client-config.mjs`
- `vendor/codex-claude-voltagent-client/plugins/codex-voltagent-default/scripts/lib/init-client-config.mjs`
- `vendor/codex-claude-voltagent-client/scripts/codex-onboard.mjs`
- `vendor/codex-claude-voltagent-client/scripts/codex-doctor.mjs`
- `scripts/installers/windows/lib/adapters/codex-voltagent-access.ps1`
- `scripts/installers/windows/lib/client-access.ps1`
- installer docs and vendored client docs

## Testing

Required regression coverage:

1. schema accepts a home-global config with `workspaceTrustMode = "all-workspaces"`
2. old workspace-local explicit-root configs still parse
3. config resolution prefers workspace override over home-global default
4. status reports `home-global-default` when no local config exists
5. doctor succeeds in an arbitrary workspace with only the global config present
6. installer apply writes the home-global config and native skill install
7. fresh-home smoke proves VoltAgent is active in a workspace without a local
   `client-config.json`

## Risks

### 1. Over-broad activation

Global activation means VoltAgent is available in every workspace, including
unexpected repos or folders.

Mitigation:

- keep Mimir writes governed
- keep Claude escalation profile-driven
- preserve local override/disable capability

### 2. Confusing precedence

Users may forget that a local config is shadowing the global one.

Mitigation:

- status/doctor must always report config source clearly

### 3. Compatibility drift

Old local configs and new global configs must coexist.

Mitigation:

- additive schema evolution
- explicit tests for legacy config compatibility

## Rollout

Recommended sequence:

1. add schema and config discovery support
2. add status/doctor reporting for config source
3. change installer default path to write the home-global config
4. update onboarding smoke to prove global-default activation
5. update docs to make global-default the canonical path

## Acceptance criteria

This change is complete only when all of these are true:

- VoltAgent is active in a workspace with no local `client-config.json`
- a home-global config is sufficient for current and future Codex workspaces
- local `client-config.json` overrides still work
- installer writes the home-global config by default
- status/doctor show whether activation comes from a global config or a local override
- current Mimir versus VoltAgent runtime boundary is unchanged

## Decision

Adopt a **home-global VoltAgent config with optional local override** as the
canonical activation model.
