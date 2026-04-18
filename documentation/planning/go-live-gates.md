# MCP Rollout And Go-Live Gates

This document defines the rollout path for using mimir as an MCP tool across workspaces.

It answers two questions:

- what should be implemented next before wider rollout
- when the system is ready for all-workspace default use

The guidance below is the recommended plan as of `2026-04-07`.

## Rollout Position

The repository is already strong enough for a controlled pilot:

- the core memory, retrieval, promotion, and audit flow exists
- the MCP adapter exists and is tested as a thin transport
- the local model stack is live on Docker Model Runner

The repository is not yet at "enable by default for every workspace" readiness.

The main remaining gaps are:

- auth boundaries are registry-backed with file-based loading, rotated credentials, validity windows, issued tokens, persisted issued-token lifecycle reporting, issuer- and revoker-attributed token lifecycle operations, queryable issuer/revoker/lifecycle filtering on the token ledger, filtered issue/revoke audit-history queries, and protected CLI plus HTTP operator auth-control surfaces for status and token lifecycle operations, but not yet fully hardened for shared rollout
- temporal-validity handling is stronger with runtime freshness reporting, operator-visible refresh candidates, governed refresh-draft creation, bounded batch refresh-draft creation, idempotent refresh-draft reuse, and retrieval warnings, but still limited beyond the new validity-window baseline
- shared rollout still needs continued operator hardening and freshness governance after the versioning contract work
- hierarchical retrieval is implemented, but default enablement remains intentionally gated behind side-by-side packet diff review and an explicit rollback path to `flat`

## Retrieval Strategy Guardrails

Use these guardrails for every rollout candidate:

- `flat` retrieval remains the default baseline
- `hierarchical` retrieval is opt-in only through explicit actor or transport strategy selection
- packet diff tooling and regression coverage are required before any default change
- rollback is a configuration switch back to `flat`

## Next Backlog Order

These are the rollout-critical backlog items in the recommended implementation order.

### 1. Remaining `BK-001` shared-rollout hardening

Extend the current actor-registry auth model into a more operationally complete shared-rollout boundary.

Why first:

- broad multi-workspace rollout still needs a fuller central issuance and multi-operator lifecycle-management control plane than the current registry-plus-issued-token-plus-ledger-plus-audit model, even after the CLI and HTTP auth-control surfaces are guarded in enforced mode, issuance plus revocation are attributed in the ledger, operators can query lifecycle state by issuer or revoker, and token lifecycle actions land in bounded, filterable audit history

### 2. Remaining `BK-007` temporal validity refinement

Expand temporal-validity handling beyond current-state snapshots, validity windows, refresh-candidate reporting, bounded batch refresh workflows, and staleness heuristics.

Why second:

- all-workspace use will increase note volume
- freshness governance becomes more important as more workspaces depend on shared memory

### 3. Remaining `BK-008` hierarchical rollout gating

Keep hierarchical retrieval behind explicit rollout review until packet diff checks are part of release sign-off.

Why third:

- flat retrieval is still the operational baseline
- side-by-side flat versus hierarchical diffs are required before changing the default
- rollback must stay as a low-risk switch back to `flat`

## Pilot Gate

The system may be piloted now, beginning `2026-04-04`, if the pilot remains intentionally constrained.

### Allowed pilot scope

- one user
- one machine or tightly controlled local setup
- one to three workspaces
- opt-in usage only
- no assumption that canonical promotion is fully hands-off

### Pilot checklist

- local Docker Model Runner stack is healthy
- MCP adapter launches cleanly
- canonical and staging roots are explicitly known
- flat and hierarchical retrieval can be compared side-by-side for the same fixture
- retrieval results are bounded and provenance-bearing
- packet diff metadata is reviewed for any hierarchical pilot runs
- promotion flow is reviewed rather than assumed
- audit history remains queryable
- no unresolved canonical contradictions exist before pilot start

### Pilot success criteria

Pilot is considered successful if, over at least 7 consecutive calendar days:

- no accidental direct-canonical write paths are discovered
- no cross-workspace write surprises occur
- no retrieval-budget regressions are observed
- no unresolved contradiction enters canonical memory
- users can consistently retrieve high-signal context without manual reassembly

## All-Workspace Go-Live Gate

The system should become the default MCP tool across all workspaces only after the following gate is satisfied.

### Required backlog closure

These items should be closed or materially complete before all-workspace default rollout:

- the remaining shared-rollout hardening under `BK-001`
- the remaining freshness-governance work under `BK-007`
- the remaining hierarchical rollout gating under `BK-008`

### Operational checklist

- clean committed worktree or tagged release candidate
- release metadata exposed and verified through CLI, HTTP, or health surfaces
- documented install and operator path for MCP usage
- documented workspace onboarding path
- documented recovery path for bad notes or bad promotions
- documented retrieval strategy switch that restores `flat`
- compose and local runtime reflect the same provider assumptions
- transport adapters expose the intended bounded surfaces
- regression suite is green on the rollout candidate

### Quality checklist

- MCP tool output remains bounded and machine-shaped
- retrieval packets are provenance-bearing
- flat and hierarchical packet diffs stay within reviewed bounds for pilot fixtures
- promotion remains deterministic
- duplicate and conflict handling remain stable under pilot load
- stale notes do not dominate retrieval for active workspaces

## Recommended Go-Live Date

Recommended earliest target for all-workspace default rollout:

- `2026-04-18`

This date assumes:

- the required rollout-critical backlog items above are completed
- the pilot runs cleanly for at least one week
- no new boundary regressions appear during pilot use

If those conditions are not met, rollout should remain opt-in rather than default.

## Decision Rule

Use this decision rule for rollout:

- if pilot is clean and required backlog items are closed, go live broadly
- if pilot is clean but shared-rollout auth hardening is still incomplete, keep rollout opt-in
- if packet diff checks are missing or the rollback switch to `flat` is unclear, keep flat as the default
- if pilot reveals write-boundary or retrieval-boundary regressions, stop expansion and treat rollout as blocked
