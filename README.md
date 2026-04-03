# Multi Agent Brain

Local-first, service-oriented scaffold for a governed context brain.

## Current Status

This repository currently contains the Wave 1 foundation:

- TypeScript workspace configuration
- typed service contracts
- core domain primitives
- first application ports
- infrastructure bootstrap stubs
- implementation planning documents

The canonical architecture target is:

- Obsidian Markdown as canonical knowledge store
- SQLite as authoritative control store
- FTS5 lexical retrieval
- vector retrieval as an additive index
- strict retrieval/writer/orchestrator separation
- bounded context packets for downstream paid models

## Repository Layout

```text
apps/
  brain-api/
  brain-cli/
packages/
  application/
  contracts/
  domain/
  infrastructure/
docs/
  planning/
docker/
scripts/
tests/
```

## Next Step

Start with the roadmap in [`docs/planning/implementation-plan.md`](./docs/planning/implementation-plan.md), then execute the ready-now items in [`docs/planning/backlog.md`](./docs/planning/backlog.md).
