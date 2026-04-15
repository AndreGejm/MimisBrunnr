# Read-Path Alignment RFC

This document defines the next architectural evolution of mimir after the source-level review against OpenViking.

The goal is to align the read path with the strongest OpenViking ideas without weakening the existing authority plane.

## Scope

This RFC covers:

- namespace semantics
- authority-state invariants
- context node schema
- layered representations
- retrieval success criteria
- rollout and rollback criteria
- import and session constraints

This RFC does not authorize:

- a storage rewrite
- removal of staged vs canonical separation
- hidden canonical mutation
- removal of freshness or validity semantics
- weakening actor-scoped authn/authz

## Core Judgment

The architectural review stands:

- OpenViking is the correct inspiration for read-path evolution.
- mimisbrunnr remains the stronger authority and governance core.
- The right move is additive convergence over the current authority plane, not replacement.

## Inspiration Classification

| Idea From OpenViking | Classification | Interpretation For mimir |
| --- | --- | --- |
| Filesystem-native context namespace | adapt carefully | Add a namespace projection over existing authority stores; do not replace them |
| L0/L1/L2 context layers | adapt carefully | Add derived representations tied to authoritative sources and promotion events |
| Hierarchical retrieval | adapt carefully | Add an optional retrieval strategy that remains bounded, traceable, and freshness-aware |
| Retrieval plans and traces | adopt directly | Add read-only trace surfaces and operator debugging support |
| Rich browse/tree/read/grep/glob semantics | adopt directly | Add read-side ergonomics on top of namespace projection |
| Session archives | adapt carefully | Add immutable archives as artifacts, not authority |
| Automatic session-to-memory extraction | reject | Allow extraction drafts only through staged review paths |
| Direct writable memory filesystem | reject | Preserve explicit staging and promotion control |
| MCP tool ingestion into skills | unclear, needs deeper verification | Revisit only after skills, tools, and imports are decomposed more precisely |

## Architectural Invariants

The following invariants must not be violated:

- No hidden canonical mutations.
- No derived artifact may become authoritative.
- No retrieval strategy may bypass freshness or validity filtering.
- No namespace projection may obscure authority state.
- No import pipeline may write directly to canonical memory.
- No session-derived artifact may bypass staged promotion.
- No new transport surface may weaken actor-scope enforcement.
- Flat retrieval remains available until hierarchical retrieval is proven against fixed fixtures.
- SQLite remains the metadata, freshness, and audit authority.
- Canonical Markdown remains the authoritative human-readable memory source.
- Staging remains the only mutable write plane for promotable memory.

## Authority-State Model

Every context node must carry an explicit authority state.

### Authority States

| State | Meaning | Authority | Mutability | Directly Promotable |
| --- | --- | --- | --- | --- |
| `canonical` | Human-approved memory in the canonical plane | authoritative | immutable except through superseding promotion | no |
| `staging` | Mutable draft or candidate note | non-authoritative | mutable | yes |
| `derived` | Regenerable representation of another node | non-authoritative | regenerable only | no |
| `imported` | Externally sourced artifact before note promotion | non-authoritative | append-only or replace-through-import | no |
| `session` | Immutable archive or briefing artifact from runtime work | non-authoritative | immutable after creation | no |
| `extracted` | Proposal derived from sessions or imports | non-authoritative | mutable in staging/review flow | yes, but only after becoming staging content |

### Hard Contracts Per State

- `canonical` nodes are authoritative and human-promoted.
- `staging` nodes are mutable and promotable.
- `derived` nodes are regenerable and never authoritative.
- `imported` nodes are externally sourced and never implicitly canonical.
- `session` nodes are archival artifacts and never direct authority.
- `extracted` nodes are proposals only until promoted through the normal path.

### Allowed State Transitions

Only these transitions are allowed:

1. `imported` -> normalized parsed artifact -> `staging` candidate
2. `session` -> `extracted` proposal
3. `extracted` -> `staging` draft
4. `staging` -> `canonical` through deterministic validation and promotion
5. any authoritative or non-authoritative source -> `derived` representation regeneration
6. `canonical(active)` -> `canonical(superseded)` only through superseding promotion

Disallowed transitions:

- `imported` -> `canonical`
- `session` -> `canonical`
- `derived` -> `canonical`
- `derived` -> `staging`
- `extracted` -> `canonical`

## Context Node Schema

Every node in the namespace must expose the following fields.

| Field | Required | Description |
| --- | --- | --- |
| `uri` | yes | Stable namespace URI used across CLI, HTTP, MCP, and audit traces |
| `ownerScope` | yes | Namespace owner scope such as `mimisbrunnr`, `general_notes`, `imports`, `sessions`, or `system` |
| `contextKind` | yes | Node kind such as `directory`, `note`, `resource`, `instruction`, `skill_artifact`, `session_archive`, or `extraction_draft` |
| `authorityState` | yes | One of the six authority states defined in this RFC |
| `sourceType` | yes | Backing source such as `canonical_note`, `staging_draft`, `import_artifact`, `session_archive`, `derived_projection`, or `external_reference` |
| `sourceRef` | yes | Stable reference back to the authoritative source record or upstream artifact id |
| `freshness` | yes | Freshness class and validity payload used by retrieval and operator views |
| `representationAvailability` | yes | Whether `L0`, `L1`, and `L2` are available for this node |
| `promotionStatus` | yes | `not_applicable`, `pending_review`, `promotable`, `promoted`, or `rejected` |
| `supersessionStatus` | yes | `active`, `superseded`, `snapshot`, `archived`, or `not_applicable` |
| `createdAt` | yes | Creation time of the node descriptor |
| `updatedAt` | yes | Last update time of the descriptor or source |

### Freshness Payload

The freshness payload must include:

- `validFrom`
- `validUntil`
- `freshnessClass`
- `freshnessReason`

`freshnessClass` must remain compatible with current mimisbrunnr validity semantics and must not be replaced by generic recency or hotness.

### Namespace URI Shape

The namespace URI format is:

- `mimir://<owner-scope>/<context-kind>/<stable-id>`

Examples:

- `mimir://mimisbrunnr/note/<note-id>`
- `mimir://general_notes/note/<note-id>`
- `mimir://imports/resource/<import-id>`
- `mimir://sessions/session_archive/<archive-id>`
- `mimir://system/instruction/<instruction-id>`

Representation layers are not separate authority roots. They are addressed as representations of a base node, for example:

- base node: `mimir://mimisbrunnr/note/<note-id>`
- requested layer: `L0`, `L1`, or `L2`

This prevents derived layers from masquerading as independent authorities.

## Namespace Semantics

The namespace is a control surface, not a cosmetic filesystem view.

It must make the following visible at read time:

- what the node is
- where it came from
- whether it is authoritative
- whether it is fresh enough to trust
- whether it is promotable
- whether it has been superseded

Namespace projection rules:

- canonical and staging nodes may coexist for the same conceptual topic but must never be visually collapsed
- derived nodes must always point back to their source authority
- imported nodes must always be visibly labeled as imported
- session nodes must always be visibly labeled as session artifacts
- extracted nodes must always be visibly labeled as proposals

## Layered Representation Model

Each eligible node may expose:

- `L0`: shortest abstract used for coarse recall and directory-level selection
- `L1`: overview used for scope confirmation and reranking
- `L2`: full content or chunk-addressable authoritative payload

Representation rules:

- `L0` and `L1` are always `derived`
- `L2` may map to canonical content, staging content, imported normalized content, or immutable session archive content
- derived representations must be regenerated through explicit background jobs or promotion/outbox hooks
- derived representations inherit freshness and supersession from their source node

## Retrieval Strategy Contract

mimisbrunnr keeps two retrieval strategies during the transition:

- `flat`: the current reference baseline
- `hierarchical`: the new opt-in strategy

### Retrieval Rules

- Both strategies must obey the existing bounded packet contract.
- Both strategies must obey freshness and validity filtering before packet delivery.
- Hierarchical retrieval must emit enough trace data to explain scope targeting, expansion, reranking, and exclusions.
- Flat retrieval remains the rollback-safe reference implementation.

### Success Metrics

Hierarchical retrieval is not considered ready for default use until all of the following are true on fixed repository fixtures:

1. **Answerability:** no worse than flat retrieval on the mixed fixture set, with no more than a 2 percentage-point regression overall.
2. **Scoped-query precision:** better than flat retrieval on the scoped-query fixture set, with a target improvement of at least 10 percentage points.
3. **Token efficiency:** at equal or better answerability, median packet tokens decrease by at least 20 percent on the scoped-query fixture set.
4. **Freshness discipline:** stale or superseded evidence inclusion rate is no worse than flat retrieval and should improve by at least 25 percent on freshness fixtures.
5. **Boundedness:** zero packet budget violations across regression fixtures.
6. **Trace determinism:** trace structure for deterministic fixtures is stable enough for snapshot comparison.
7. **Diffability:** every hierarchical run can be compared against a flat run through packet diff tooling and side-by-side traces.

## Rollout, Coexistence, And Rollback

The rollout model must be explicit:

- flat retrieval remains the default until the hierarchical strategy passes the success metrics above
- hierarchical retrieval must be actor-selectable or transport-selectable during rollout
- shadow mode must exist so hierarchical retrieval can run without becoming the returned packet
- packet diff tooling must exist before any default enablement
- retrieval traces must support side-by-side explanation between flat and hierarchical runs
- rollback must be a configuration switch, not a migration exercise

Minimum rollout stages:

1. internal shadow mode only
2. operator opt-in by actor or transport
3. limited default enablement for selected surfaces
4. broader default enablement only after metrics stay stable

## Import Pipeline Contract

Imports are valuable but high-risk.

Every import flow must be staged through these phases:

1. raw import artifact
2. normalized parsed artifact
3. derived `L0` and `L1`
4. candidate notes or drafts
5. optional promotion outputs

Import rules:

- raw and normalized import artifacts are never canonical
- imported browse paths must visibly surface authority state
- import parsing failures must remain inspectable and non-destructive
- no import path may bypass validation and promotion

## Session And Extraction Contract

Session work is split deliberately:

- `session archive`: near-term and low-risk
- `session briefing`: optional and secondary
- `extraction drafts`: later, only after namespace, traces, and retrieval evaluation are solid

Session rules:

- session archives are immutable artifacts
- session archives are searchable but never authoritative
- extraction products start as proposals only
- automatic extraction heuristics are deferred until the proposal quality is measurable and reviewable

## Skills, Instructions, And Tools

These concepts must remain separate.

### Instructions

- human-authored policy or procedural guidance
- may exist in canonical or staging state
- are part of the governed memory model

### Skill Artifacts

- imported or locally authored procedural packages
- are not automatically canonical memory
- should usually begin as `imported` or `staging`

### Tool Capabilities

- executable runtime declarations from CLI, HTTP, MCP, or coding runtime
- are not stored as authoritative memory objects by default

### Skill Projections

- searchable summaries or derived metadata of a skill artifact
- are always `derived`

This decomposition avoids collapsing “skills” into one overloaded concept.

## Phase Order

The implementation order after this RFC is:

1. define authority-state invariants and namespace semantics in code and contracts
2. project current canonical and staging notes into a read-only namespace
3. add retrieval traces and packet diff tooling
4. add `L0` and `L1` derived representations
5. add hierarchical retrieval behind coexistence gates
6. add controlled imports
7. add session archives
8. revisit extraction drafts only if the earlier layers are stable

## Why This RFC Exists

The main risk in the next stage is no longer choosing the wrong ideas.

The main risk is implementing the right ideas without explicit authority-state semantics, explicit invariants, explicit evaluation gates, or explicit rollback criteria.

This RFC exists to remove that ambiguity before the read-path expansion begins.
