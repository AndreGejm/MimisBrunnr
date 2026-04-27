# MCP Toolbox V1 Implementation Specification

> **Status note (2026-04-27):** This is the original reconnect-first v1
> implementation spec. Its baseline requirements remain useful for leases,
> compiled policy, Docker planning, installer audits, and control-surface
> authority. The live repo now also includes the dynamic broker in
> `apps/mimir-toolbox-mcp` plus band/workflow authoring. For current runtime
> behavior, prefer `documentation/operations/docker-toolbox-v1.md`,
> `documentation/architecture/session-semantics.md`, and
> `documentation/planning/current-implementation.md`. Treat the "current
> baseline", "remaining backlog", and acceptance language below as phase-scoped
> to this 2026-04-18 design slice, not as the live runtime checklist.

Status: historical implementation spec retained for toolbox phase context
Date: 2026-04-18
Scope: `docker/mcp/**`, toolbox compiler/runtime/control surfaces, lease enforcement, Docker sync, installer readiness, and client activation flows

## Purpose

This document defined the implementation requirements for the Mimir Docker Toolbox v1 change using the 2026-04-18 repo state as the source of truth for that phase. It is retained to show the original authority boundaries and acceptance criteria that shaped the reconnect-first rollout.

This is not a greenfield design. The repo already contains a substantial toolbox foundation:

- manifest contracts in [`packages/contracts/src/toolbox/policy.contract.ts`](F:\Dev\scripts\Mimir\mimir\packages\contracts\src\toolbox\policy.contract.ts)
- audit contracts in [`packages/contracts/src/toolbox/audit.contract.ts`](F:\Dev\scripts\Mimir\mimir\packages\contracts\src\toolbox\audit.contract.ts)
- compiler and runtime planning in [`packages/infrastructure/src/toolbox/policy-compiler.ts`](F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\toolbox\policy-compiler.ts) and [`packages/infrastructure/src/toolbox/docker-runtime-plan.ts`](F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\toolbox\docker-runtime-plan.ts)
- control surface in [`packages/infrastructure/src/toolbox/control-surface.ts`](F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\toolbox\control-surface.ts)
- lease issuance and enforcement in [`packages/infrastructure/src/toolbox/session-lease.ts`](F:\Dev\scripts\Mimir\mimir\packages\infrastructure\src\toolbox\session-lease.ts)
- CLI and MCP entrypoints in [`apps/mimir-cli/src/main.ts`](F:\Dev\scripts\Mimir\mimir\apps\mimir-cli\src\main.ts) and [`apps/mimir-control-mcp/src/main.ts`](F:\Dev\scripts\Mimir\mimir\apps\mimir-control-mcp\src\main.ts)
- Windows installer preparation and planning surfaces in [`scripts/installers/windows/cli.ps1`](F:\Dev\scripts\Mimir\mimir\scripts\installers\windows\cli.ps1)

The goal of this spec is to define the remaining authority boundaries, implementation requirements, and acceptance criteria so the toolbox change can be completed correctly.

## Historical Baseline On 2026-04-18

The following is already implemented and must be treated as the starting point, not as planned work.

### Policy and manifest layer

- Toolbox manifests already live under [`docker/mcp`](F:\Dev\scripts\Mimir\mimir\docker\mcp).
- The repo already defines manifest families for categories, trust classes, intents, servers, profiles, and client overlays.
- The compiler already produces a normalized policy with deterministic `manifestRevision` and per-profile `profileRevision`.
- Duplicate semantic capability detection already exists at compile time.
- Client overlays are already restricted to suppression-only behavior in v1. Widening by overlay is not allowed.

### Runtime and control layer

- `mimir-control` already exposes:
  - `list_toolboxes`
  - `describe_toolbox`
  - `request_toolbox_activation`
  - `list_active_toolbox`
  - `list_active_tools`
  - `deactivate_toolbox`
- The control surface already emits audit events for discovery, approval, denial, lease issuance, lease rejection, reconnect generation, deactivation, and expired-lease deactivation handling.
- Compiled tool descriptors already distinguish profile, server, category, trust class, mutation level, and source.
- `list_active_tools` already distinguishes declared tools, active runtime descriptors, and overlay-suppressed tools.

### Lease and enforcement layer

- A signed toolbox session lease contract already exists.
- Runtime command toolbox policy already exists in [`packages/contracts/src/orchestration/command-catalog.ts`](F:\Dev\scripts\Mimir\mimir\packages\contracts\src\orchestration\command-catalog.ts).
- Runtime enforcement is already wired through the service container and runtime command dispatcher.
- Legacy-direct remains supported and is already treated separately from toolbox-scoped sessions.

### Docker and installer layer

- Docker runtime sync planning already exists and compiles runtime output from the normalized policy.
- The Windows installer already includes toolbox-aware operations:
  - `audit-toolbox-assets`
  - `prepare-toolbox-runtime`
  - `audit-docker-mcp-toolkit`
  - `plan-docker-mcp-toolkit-apply`
  - `prepare-repo-workspace`
- The installer already treats Docker Toolkit profile apply as a reviewed planning step rather than a blind mutation path.

## Remaining Backlog Relevant To Toolbox Work At The Time

The repo backlog still contains broader items that remain open outside the immediate toolbox slice. The toolbox change must not weaken them or hide them.

### Repo-wide partial backlog still open

- `BK-001`: shared-rollout auth hardening is baseline complete for the current stack, including central issuer lifecycle controls, registry-bounded no-widening issuer policy, and bulk issued-token revocation. Toolbox work must preserve that control plane rather than bypass it.
- `BK-007`: freshness lifecycle governance is still partial. Remaining gap: broader lifecycle governance and stronger automated refresh policy.
- `BK-008`: hierarchical retrieval rollout is still partial. Remaining gap: default enablement must stay gated behind packet-diff review and explicit rollback-to-flat.
- `RV-006`: authority-state invariants and namespace semantics are marked ready and should be used as a guardrail for toolbox-related namespace or mode semantics.

### Toolbox-specific work still effectively open

- Docker Toolkit apply is not yet a trusted default path because local Docker support for `docker mcp profile` can still be absent.
- Client reconnect and fork behavior must be treated as an explicit compatibility surface, not an informal operator convention.
- Lease issuance must behave deterministically when issuer secrets are missing, invalid, or rotated.
- Peer curation still needs to remain category-owned and manifest-driven.
- Diagnostics must be strong enough that an operator can explain any denial, rejection, or downgrade from the reported data alone.

## Source Of Truth And Authority

The toolbox system must preserve a strict authority model.

### Authoritative layers

1. Repo manifests under [`docker/mcp`](F:\Dev\scripts\Mimir\mimir\docker\mcp) are the only declarative source of toolbox policy.
2. The normalized compiled policy is the only runtime-consumable policy representation.
3. Control, runtime, lease, and Docker subsystems must consume compiled policy, not raw YAML.
4. Docker Desktop or Docker Gateway state is generated runtime state, not policy authority.
5. Client overlays may reduce or suppress capability exposure, but may not widen trust, mutation, or denied boundaries.

### Non-authoritative layers

- Docker profile state
- client-local presets
- handwritten operator notes
- ad hoc runtime flags that attempt to bypass compiled policy
- UI or installer defaults that diverge from manifest policy

## V1 Scope

V1 is intentionally limited.

### In scope

- manifest-driven toolbox definitions
- normalized compiler IR
- `mimir-control` discovery and approval flow
- signed session leases bound to audience, client, profile, and revision
- reconnect and fork activation flow
- Docker runtime planning and sync from compiled policy
- manifest-based peer curation
- client overlay suppression for Codex and Claude first
- Antigravity support as contract-compatible but operationally thinner

### Out of scope for v1

- in-session hot-add or hot-remove of peer tools
- silent fallback to another profile during an active session
- external memory peers as first-class toolbox servers
- planner, orchestrator, or meta-router peer promotion
- promoting internal helpers like RTK, Aider, or Codesight into peer-server authority
- making Docker runtime state the editable policy source

## Functional Requirements

### 1. Manifest And Compiler Requirements

1. Every subsystem must read only compiled toolbox policy after the compiler boundary.
2. The compiler must remain deterministic for the same manifest set.
3. The compiler must fail before any runtime side effect when:
   - a category is unknown
   - a trust class is unknown
   - a profile references a missing server
   - a composite profile lacks explicit justification
   - a client overlay attempts to widen access
   - semantic capability duplication is unresolved
4. Duplicate semantic capability handling must stay deterministic and explicit. "Best effort" overlap resolution is not allowed.
5. Profile inheritance and composition must be explicit and test-backed. Composite profiles are only allowed when backed by a repeated workflow and fixture coverage.
6. Profile, server, and client IDs must stay stable and canonicalized for Docker sync, audit, and reconnect flows.

### 2. Session Mode Requirements

The runtime must preserve the following explicit modes:

- `legacy-direct`
- `toolbox-bootstrap`
- `toolbox-activated`

Requirements:

1. Session mode must be logged and diagnosable.
2. Legacy-direct must remain explicit rather than silently treated as toolbox-activated.
3. Bootstrap sessions must expose only:
   - `mimir-control`
   - any explicitly allowed `mimir-core` bootstrap-safe commands
4. Approved toolbox sessions must not be represented as direct mode.
5. Any transport or actor path that cannot supply the needed session policy context must remain in legacy-direct or bootstrap mode and must not fake activation.

### 3. Control Surface Requirements

The authoritative discovery and approval surface for v1 is `mimir-control`.

Requirements:

1. `list_toolboxes` must return only policy-backed toolboxes or intents, not raw profiles.
2. `describe_toolbox` must explain:
   - intended workflow
   - categories
   - trust class bounds
   - anti-use cases
   - inheritance or composition, where applicable
3. `request_toolbox_activation` must produce a result that clearly distinguishes:
   - approval or denial
   - reason codes
   - whether a lease was issued
   - reconnect or fork target data
   - what profile was approved
4. `list_active_tools` must distinguish:
   - declared tools in the approved profile
   - runtime descriptors currently exposed to the session
   - tools suppressed by overlay or availability state
5. `deactivate_toolbox` must revoke the active lease and make subsequent scoped calls fail in enforced mode.
6. No peer tool may leak into bootstrap mode before activation.

### 4. Lease And Enforcement Requirements

The current lease model is correct in direction and must be completed rather than replaced.

The lease must remain bound to:

- `leaseId`
- `sessionId`
- `issuer`
- `audience`
- `clientId`
- `approvedProfile`
- approved and denied categories
- trust class
- `manifestRevision`
- `profileRevision`
- issuance and expiry timestamps
- nonce
- signature

Requirements:

1. Lease validation must be independent from actor authentication, but both must pass for an authorized scoped command.
2. Lease enforcement must validate:
   - signature
   - issuer
   - audience
   - client binding
   - session binding
   - profile binding
   - manifest revision
   - profile revision
   - expiry and not-before window
   - revocation state
   - command category, trust, and mutation requirements
3. Missing issuer secret must not produce ambiguous success. If approval occurs without lease issuance, that outcome must be explicit and machine-readable.
4. Replay after deactivation must fail.
5. Expired lease behavior must return a reconnect or downgrade path, not silent continued access.
6. Fallback profiles may only be used for:
   - denied-request alternatives
   - reconnect after expiry
   - operator-guided downgrade
7. Silent in-session downgrade is forbidden in v1.

### 5. Command Policy Requirements

Each Mimir command that is reachable from a toolbox-activated session must declare explicit toolbox policy.

Requirements:

1. Command requirement semantics must use:
   - required categories (`allOf`)
   - optional categories (`anyOf`) where needed
   - minimum trust class
   - mutation level
2. Enforcement must be minimum-scope and deny by default.
3. Commands that mutate memory, governance state, or control-plane state must require categories that are not present in read-only or research profiles.
4. New runtime commands added later must fail CI if toolbox policy metadata is missing where the command is toolbox-reachable.

### 6. Peer Curation Requirements

Peer onboarding must stay category-driven and manifest-driven.

Initial approved peer bands for v1:

- docs and web research
- GitHub read and write split
- monitoring or read-only ops
- Docker read and admin split

Explicit v1 exclusions:

- external memory servers
- planner or orchestrator peers
- aggregator or meta-router peers
- internal helper promotion into first-class peer servers

Requirements:

1. Peer manifests must compile cleanly into policy and runtime plan outputs.
2. Duplicate semantic capability overlap must be rejected unless an explicit ranking or ownership rule exists.
3. Peer approval must not introduce a second semantic authority for memory, orchestration, or routing.

### 7. Client Overlay Requirements

Client overlays exist to reduce or shape the visible tool surface by client, not to widen authority.

Requirements:

1. Codex and Claude overlays are first-class v1 targets.
2. Antigravity may consume the same approval contract, but can remain operationally thinner in v1.
3. Overlay diagnostics must explain:
   - which tools were suppressed
   - why they were suppressed
   - which boundary prevented widening
4. Overlay suppression must never widen trust or mutation levels.
5. Overlays must not reintroduce raw peer tools into bootstrap sessions.

### 8. Docker Runtime And Installer Requirements

The Docker runtime must remain generated state derived from compiled policy.

Requirements:

1. `sync-mcp-profiles` must consume compiled policy only.
2. It must emit:
   - machine-readable runtime JSON
   - human-readable sync summary
3. Profile names, server IDs, tool IDs, and ordering must be deterministic.
4. Invalid manifests must fail before any Docker mutation.
5. Docker apply must remain blocked or planning-only when the local Docker Toolkit does not support the required `docker mcp profile` surface.
6. The Windows installer must stay aligned with this authority model:
   - `audit-toolbox-assets` validates repo-managed toolbox manifests
   - `prepare-toolbox-runtime` prepares repo and runtime prerequisites only
   - `audit-docker-mcp-toolkit` reports compatibility and blockers
   - `plan-docker-mcp-toolkit-apply` produces reviewed plan output, not implicit Docker mutation
7. The installer must never become a second policy system for profiles or peer composition.

### 9. Client Activation And Reconnect Requirements

V1 activation is reconnect and fork only.

Requirements:

1. No implementation may assume in-session hot mutation of the tool surface.
2. Activation output must contain enough information for a client or operator to reconnect cleanly:
   - approved profile
   - lease token or lease reference
   - expiry
   - reconnect command or preset reference
   - downgrade target
   - resulting session mode
3. Secret-bearing lease data must not be printed as a casual operator string when a safer transport exists.
4. Conversation continuity is client-managed. Toolbox activation changes capability surface, not conversation semantics.

### 10. Audit And Diagnostics Requirements

Toolbox rollout will fail operationally if denials and mismatches are not explainable.

Requirements:

1. Audit events must remain stable-schema and queryable.
2. Diagnostics must be sufficient for an operator to answer:
   - why a toolbox was denied
   - whether approval happened without lease issuance
   - why a lease failed
   - which overlay suppressed a tool
   - which session mode handled the request
   - which manifest and profile revisions were involved
3. Legacy-direct caveats must be documented and surfaced in diagnostics, not hidden.
4. Expired lease detection in control or runtime flows must emit an explicit `toolbox_expired` audit event or an equally specific stable-schema successor event.
5. Docker compatibility blockers must report the exact missing capability rather than generic "toolbox not ready" messaging.

## Non-Functional Requirements

1. Determinism: the same manifest set must produce the same compiled outputs and revisions.
2. Idempotency: repeated audit, compile, and plan operations must be safe to rerun.
3. Separation of concerns: compiler, control surface, enforcement, Docker sync, and installer adapters must remain distinct.
4. Backward compatibility: legacy-direct workflows must continue until toolbox activation is intentionally selected.
5. Reviewability: Docker mutation remains behind an explicit reviewed step even after compatibility improves.

## Acceptance Criteria

The toolbox implementation should not be considered correct until the following are true.

### Policy and compiler

- `node --test tests/e2e/toolbox-manifest-contracts.test.mjs`
- Compiler output is deterministic across repeated runs against the same manifests.
- No subsystem requires raw YAML parsing outside the compiler boundary.

### CLI and control surface

- `node --test tests/e2e/toolbox-cli.test.mjs`
- `node --test tests/e2e/mimir-control-mcp.test.mjs`
- Bootstrap sessions expose only expected bootstrap-safe surfaces.
- Approved sessions report correct active tool descriptors.
- `list_active_tools` distinguishes declared tools, currently exposed runtime descriptors, and tools suppressed by overlay or availability state.

### Lease and runtime enforcement

- `node --test tests/e2e/toolbox-session-lease.test.mjs`
- Enforced-mode scoped requests fail for:
  - missing lease
  - expired lease
  - wrong audience
  - manifest revision mismatch
  - wrong client binding
  - revoked lease
  - category or trust mismatch
- Scoped requests succeed only when both actor auth and lease scope pass.

### Docker runtime planning

- `node --test tests/e2e/docker-toolbox-sync.test.mjs`
- `corepack pnpm docker:mcp:sync:json`
- Repeated dry runs remain stable.
- Invalid manifests fail before Docker mutation.

### Installer readiness

- `node --test tests/e2e/windows-installer-cli.test.mjs`
- `scripts/installers/windows/cli.ps1 -Operation audit-toolbox-assets -Json`
- `scripts/installers/windows/cli.ps1 -Operation audit-docker-mcp-toolkit -Json`
- `scripts/installers/windows/cli.ps1 -Operation plan-docker-mcp-toolkit-apply -Json`
- If Docker profile support is unavailable locally, installer output must explicitly report that the apply step is blocked rather than silently succeeding.

## Recommended Implementation Order

1. Finish policy and compiler invariants before widening peer or client support.
2. Treat `mimir-control` as the only discovery and approval surface.
3. Harden lease issuance and failure semantics before enabling broader client handoff flows.
4. Keep Docker mutation behind plan-first review until compatibility is proven on target installations.
5. Add peer bands by category and fixture, not by one-off vendor wiring.
6. Finalize client reconnect presets only after approval and lease payloads are stable.
7. Expand diagnostics before broad rollout.

## Explicit Non-Goals For This Slice

This slice is not responsible for:

- solving the broader `BK-001`, `BK-007`, or `BK-008` backlog items beyond preserving their constraints
- making hierarchical retrieval default
- replacing legacy-direct flows immediately
- making Docker Desktop state editable by hand as a supported policy authoring surface
- turning the installer into the source of truth for toolbox policy

## Implementation Notes For The Original Change

If you are actively implementing the toolbox change now, the safest interpretation is:

1. Treat the current repo manifests and compiled policy as the authority.
2. Preserve bootstrap -> approval -> reconnect or fork -> activated flow.
3. Do not add hot-swap semantics.
4. Do not let overlays widen scope.
5. Do not bypass `mimir-control` for discovery or approval.
6. Keep Docker apply behind an explicit compatibility gate.
7. Keep the installer aligned with toolbox planning and diagnostics, not as a second runtime policy layer.

## Related Documents

- [`documentation/operations/docker-toolbox-v1.md`](F:\Dev\scripts\Mimir\mimir\documentation\operations\docker-toolbox-v1.md)
- [`documentation/architecture/session-semantics.md`](F:\Dev\scripts\Mimir\mimir\documentation\architecture\session-semantics.md)
- [`documentation/planning/backlog.md`](F:\Dev\scripts\Mimir\mimir\documentation\planning\backlog.md)
- [`documentation/setup/windows-installer-contracts.md`](F:\Dev\scripts\Mimir\mimir\documentation\setup\windows-installer-contracts.md)
