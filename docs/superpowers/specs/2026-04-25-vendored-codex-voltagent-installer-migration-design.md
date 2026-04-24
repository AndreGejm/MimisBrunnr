# Vendored Codex VoltAgent Installer Migration Design

## Goal

Fold `codex-claude-voltagent-client` into MimisBrunnr for release purposes so
the product ships with:

- one repository
- one canonical installer
- one canonical onboarding and smoke path

while preserving the existing architecture boundary:

- Mimir owns durable memory, retrieval, governed writes, and local execution
- the Codex/Claude VoltAgent client owns skills, workspace roots, Claude
  profile selection, and paid-agent quality

## Status

This is a release-oriented packaging and installer design.

It does **not** change the runtime ownership split already established in:

- [2026-04-24-codex-claude-voltagent-external-integration-design.md](/F:/Dev/scripts/Mimir/mimir/docs/superpowers/specs/2026-04-24-codex-claude-voltagent-external-integration-design.md)

The external integration design remains the architectural source of truth for
runtime boundaries. This spec defines how to package and install that client
surface as part of MimisBrunnr for a stable release.

## Problem statement

The current state is split across two repositories:

- `F:\Dev\scripts\Mimir\mimir`
- `F:\Dev\scripts\codex-claude-voltagent-client`

That split is workable for development, but it is the wrong shape for a release
that is supposed to feel like one product. Today, a complete install story
would require:

- separate repository management
- separate onboarding commands
- separate release coordination
- separate push/publish logistics

That creates avoidable release risk.

At the same time, a deeper runtime merge is not justified right before release.
The existing external client already has working:

- native Codex skill install
- workspace `client-config.json` bootstrap
- Codex-side doctor
- deterministic Claude profile routing
- fresh-home onboarding smoke

The release-safe move is therefore to vendor that client into MimisBrunnr and
make the Mimir installer provision it.

## Chosen approach

Use **Approach 2: vendored subtree inside MimisBrunnr**.

### Why this approach

- lower release risk than a full package rewrite
- preserves the existing external client's stable behavior
- allows a single installer immediately
- avoids maintaining two independent installers
- avoids an architectural collapse where Mimir starts owning client-local skill
  behavior

### Why not full internal repackaging right now

A deeper move into `packages/` would likely be cleaner long-term, but it would
also force unnecessary runtime/layout changes during release prep. This spec
optimizes for stability first.

## Design principles

1. The canonical release source becomes `MimisBrunnr`.
2. The Mimir installer becomes the only supported top-level installer.
3. The vendored client remains mostly source-identical for this release.
4. Only small path and packaging changes are allowed where installer
   integration requires them.
5. Docker Desktop and toolbox apply remain optional, not part of the core
   Codex+VoltAgent install.
6. The runtime ownership boundary between Mimir and the Codex/Claude VoltAgent
   client does not change.

## Repository shape

Vendor the external repository under:

- `vendor/codex-claude-voltagent-client/`

inside:

- `F:\Dev\scripts\Mimir\mimir`

### Expected retained surfaces

Keep these surfaces largely intact on first import:

- `src/`
- `skills/`
- `.codex/`
- `plugins/codex-voltagent-default/`
- `scripts/`
- `tests/`
- `docs/`

### Allowed subtree-local changes

Only these classes of changes are in scope during vendoring:

- repo-root resolution updates
- package script cwd assumptions
- docs links that must point into the monorepo
- smoke test path assumptions
- installer handoff and reporting integration

### Out of scope during vendoring

Do not do these during the release migration:

- runtime architecture refactors
- moving the vendored `src/` into Mimir packages
- reworking the Claude profile model
- replacing the vendored onboarding logic with a fresh PowerShell
  implementation
- changing public client behavior except where path/layout integration requires
  it

## Vendored provenance tracking

Add a small metadata record at:

- `vendor/codex-claude-voltagent-client/VENDORED_FROM.md`

It should record:

- original repository path or URL
- imported branch
- imported commit hash
- local monorepo patch notes
- transition plan for the external repository

This keeps the temporary vendored state explicit and auditable.

## Installer contract

The Mimir installer becomes the top-level orchestrator for both:

1. existing Mimir access
2. vendored Codex/VoltAgent access

### Existing Mimir access that remains in scope

The installer already manages:

- Codex MCP `mimir` server entry in `~/.codex/config.toml`
- launcher shims
- installation manifest
- repo preparation and build checks
- optional Docker and toolbox audits

That behavior remains intact.

### New vendored Codex/VoltAgent access to add

The installer must also provision:

- native Codex skill install:
  - `~/.codex/skills/voltagent-default -> <repo>\vendor\codex-claude-voltagent-client\skills`
- workspace `client-config.json` bootstrap
- optional plugin-shell install
- Codex-side doctor
- Codex-side onboarding smoke

### Required top-level installer behavior

The current installer operations:

- `plan-client-access`
- `apply-client-access`

must expand to cover both:

- `mimir_access`
- `codex_voltagent_access`

from one command path.

### Required result semantics

The installer should report:

- `healthy`
  - Mimir access configured
  - VoltAgent native skills installed
  - workspace `client-config.json` valid
  - doctor passes
- `degraded`
  - Mimir access works
  - VoltAgent client partially installed or blocked on config/provider gaps
- `blocked`
  - repo not prepared
  - required Codex config path unavailable
  - workspace path not provided for bootstrap
  - required Codex-side doctor checks failed

### What remains optional

These should not become release-critical installer steps:

- Docker Desktop mutation
- Docker MCP Toolkit apply
- toolbox runtime apply
- plugin shell install
- hidden startup/session automation

They may be audited or offered separately, but not required for the core
install to succeed.

## Integration mechanics

### Preferred integration model

Use a thin Mimir-side installer adapter over the vendored Node entrypoints.

Do **not** rewrite the vendored Codex onboarding logic into PowerShell during
this release cycle.

### Why

The vendored client already has working Node entrypoints for:

- onboarding
- doctor
- plugin bootstrap helpers
- smoke verification

Rewriting those paths into a second implementation language during release prep
would add drift and risk without improving the final product.

### Concrete installer behavior

The Mimir Windows installer backend remains the top-level orchestrator.

It should call vendored client entrypoints for the client-specific work, for
example:

- vendored `codex:onboard`
- vendored `codex:doctor`
- optional vendored plugin install/bootstrap helpers

The user still experiences one installer. Internally, the installer delegates
Codex/VoltAgent provisioning to the already-working vendored client scripts.

## Canonical ownership after migration

After vendoring:

- `MimisBrunnr` becomes the canonical release source
- `documentation/setup/` inside `mimir` becomes the canonical operator-facing
  install documentation
- the vendored subtree remains internally separable for the release cycle
- the external repository becomes transitional only

This is a packaging decision, not a runtime-boundary rewrite.

## Verification and release gating

### Gate 1: vendored client still works in place

After vendoring, the subtree must still pass its own core checks from inside
the monorepo.

Minimum required:

- build
- typecheck
- onboarding tests
- doctor tests
- profile routing and handoff tests
- fresh-home onboarding smoke

This proves the move did not break the vendored client just by relocating it.

### Gate 2: combined installer path works

Installer verification must prove:

- `plan-client-access` previews both Mimir and vendored Codex/VoltAgent writes
- `apply-client-access` executes both layers
- post-apply reporting shows both sub-results
- failures identify which sub-layer failed

This becomes the primary product-level release gate for installation.

### Gate 3: monorepo-owned fresh-machine smoke

Add one monorepo-owned smoke path that simulates:

- clean temp home
- clean temp workspace
- installer-driven access apply
- native Codex skills installed from the vendored subtree
- workspace `client-config.json` written
- doctor passes
- runtime probe passes
- Mimir MCP reachable

Without this gate, the "single installer" claim is still unverified.

## Release acceptance criteria

This vendored-installer migration is release-ready only if all of the
following are true:

1. one installer path configures both Mimir and Codex VoltAgent access
2. native Codex skills are installed from the vendored subtree
3. workspace `client-config.json` is bootstrapped correctly
4. doctor passes after installer apply
5. fresh-home and fresh-workspace smoke passes from the monorepo
6. Mimir versus VoltAgent runtime ownership is unchanged
7. Docker/Desktop remains optional and clearly documented as optional
8. the vendored source provenance is recorded explicitly

## Rollout order

Implement in this order:

1. vendor the subtree
2. make vendored client tests pass in the monorepo
3. add the installer adapter for vendored client access
4. extend `plan-client-access`
5. extend `apply-client-access`
6. add monorepo onboarding smoke
7. update installer documentation
8. mark the external repository transitional

## External repository transition plan

The external repository should remain a temporary mirror for one release cycle.

During that period:

- MimisBrunnr is the canonical release source
- the external repository README should point users to MimisBrunnr as the
  canonical install path
- deeper refactoring stays out of scope

After the release stabilizes and the combined installer smoke is proven, the
external repository can be archived or retired.

## Non-goals

This migration does not include:

- moving vendored runtime code into Mimir packages before release
- changing the runtime boundary between Mimir and the Codex/Claude VoltAgent
  client
- making Docker Desktop required for the core install
- introducing hidden startup hooks as the baseline activation path
- replacing the vendored onboarding implementation with a fresh installer
  stack before the release ships

## References

- [2026-04-24-codex-claude-voltagent-external-integration-design.md](/F:/Dev/scripts/Mimir/mimir/docs/superpowers/specs/2026-04-24-codex-claude-voltagent-external-integration-design.md)
- [installation.md](/F:/Dev/scripts/Mimir/mimir/documentation/setup/installation.md)
- [windows-installer.md](/F:/Dev/scripts/Mimir/mimir/documentation/setup/windows-installer.md)
- [external-client-boundary.md](/F:/Dev/scripts/Mimir/mimir/documentation/reference/external-client-boundary.md)
