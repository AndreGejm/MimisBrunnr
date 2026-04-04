# MCP Rollout And Go-Live Gates

This document defines the rollout path for using Multi Agent Brain as an MCP tool across workspaces.

It answers two questions:

- what should be implemented next before wider rollout
- when the system is ready for all-workspace default use

The guidance below is the recommended plan as of `2026-04-04`.

## Rollout Position

The repository is already strong enough for a controlled pilot:

- the core memory, retrieval, promotion, and audit flow exists
- the MCP adapter exists and is tested as a thin transport
- the local model stack is live on Docker Model Runner

The repository is not yet at "enable by default for every workspace" readiness.

The main remaining gaps are:

- auth boundaries are registry-backed with file-based loading, rotated credentials, validity windows, issued tokens, and protected operator auth-control surfaces for status, issuance, and introspection, but not yet fully hardened for shared rollout
- temporal-validity handling is stronger with runtime freshness reporting, operator-visible refresh candidates, governed refresh-draft creation, and retrieval warnings, but still limited beyond the new validity-window baseline
- shared rollout still needs continued operator hardening and freshness governance after the versioning contract work

## Next Backlog Order

These are the rollout-critical backlog items in the recommended implementation order.

### 1. Remaining `BK-001` shared-rollout hardening

Extend the current actor-registry auth model into a more operationally complete shared-rollout boundary.

Why first:

- broad multi-workspace rollout still needs a fuller central issuance, revocation, and lifecycle-management control plane than the current registry-plus-issued-token model

### 2. Remaining `BK-007` temporal validity refinement

Expand temporal-validity handling beyond current-state snapshots, validity windows, refresh-candidate reporting, and staleness heuristics.

Why second:

- all-workspace use will increase note volume
- freshness governance becomes more important as more workspaces depend on shared memory

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
- retrieval results are bounded and provenance-bearing
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

### Operational checklist

- clean committed worktree or tagged release candidate
- release metadata exposed and verified through CLI, HTTP, or health surfaces
- documented install and operator path for MCP usage
- documented workspace onboarding path
- documented recovery path for bad notes or bad promotions
- compose and local runtime reflect the same provider assumptions
- transport adapters expose the intended bounded surfaces
- regression suite is green on the rollout candidate

### Quality checklist

- MCP tool output remains bounded and machine-shaped
- retrieval packets are provenance-bearing
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
- if pilot reveals write-boundary or retrieval-boundary regressions, stop expansion and treat rollout as blocked
