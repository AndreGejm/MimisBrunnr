# Glossary

## Authority state

High-level ownership category for a context artifact. Current code uses at least:

- `canonical`
- `staging`
- `imported`
- `session`

## Canonical note

A promoted note stored in the canonical filesystem repository and mirrored into SQLite metadata.

## Staging draft

A draft note stored in the staging filesystem repository pending validation or promotion.

## Current-state note

A canonical note with `currentState: true` in frontmatter. Promotion logic can supersede earlier current-state notes.

## Current-state snapshot

A deterministic snapshot note created during current-state promotion. Snapshot paths are detected by `/current-state/` in namespace projection.

## Context packet

A bounded retrieval result assembled from ranked candidates with provenance and optional raw excerpts.

## Decision packet

A context packet specialized for decision-oriented retrieval.

## Context node

A namespace projection record exposed through tree and node-read surfaces. Current namespace projection is note-backed.

## Owner scope

The current namespace owner scope is the corpus, such as `context_brain` or `general_notes`.

## Corpus

A top-level note grouping. Tracked corpus values used throughout the contracts are:

- `context_brain`
- `general_notes`

## Promotion outbox

A SQLite-backed queue of promotion work used to make multi-store promotion processing replayable.

## Imported job

A recorded import artifact with authority state `imported`. It stores source metadata but does not directly create canonical outputs.

## Session archive

An immutable non-authoritative session transcript artifact with authority state `session`.

## Freshness class

Namespace freshness classification derived from validity windows:

- `current`
- `future_dated`
- `expired`
- `expiring_soon`

## Staleness class

Retrieval/chunk staleness classification:

- `current`
- `stale`
- `superseded`

## Model role

Named runtime role that resolves to a provider/model binding, such as `coding_primary` or `brain_primary`.

## Paid escalation

An optional OpenAI-compatible reasoning path used to enrich uncertainty when local evidence is not sufficient.

## Soft fail

Adapter behavior that records degraded state and continues operating where possible instead of crashing the runtime. The Qdrant vector index uses this pattern.

## Actor registry

The configured set of actors, roles, credentials, transport allowlists, command allowlists, and validity windows used by the auth policy.

## Issued token

A centrally created actor token signed with `MAB_AUTH_ISSUER_SECRET` and optionally constrained by transport, command, admin action, and validity window.

## Evidence status

### Verified facts

- Terms here come from tracked domain types, contracts, services, and auth code

### Assumptions

- None

### TODO gaps

- If the domain layer adds new authority states or packet types, update this glossary
