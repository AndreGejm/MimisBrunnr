# Multi Agent Brain

Local-first, service-oriented multi-agent runtime for governed memory, bounded retrieval, and safety-gated coding execution.

## Current Status

This repository is no longer just a foundation scaffold. The core local-first architecture is implemented.

Implemented today:

- a layered TypeScript monorepo with `domain`, `contracts`, `application`, `infrastructure`, and `orchestration` packages
- thin transport adapters for CLI, HTTP, and MCP
- canonical Markdown storage plus a separate staging write plane
- SQLite as the metadata and audit authority
- SQLite FTS lexical retrieval and Qdrant vector retrieval
- bounded context packet assembly and decision-summary generation
- deterministic validation and promotion for staged notes
- model-role and provider abstractions for the local model stack
- a vendored Python coding runtime integrated through the coding domain

Current local model stack:

- Docker Model Runner at `http://127.0.0.1:12434`
- `qwen3:4B-F16` for local reasoning and drafting
- `qwen3-coder` for coding tasks
- `qwen3-reranker` for reranking
- `docker.io/ai/qwen3-embedding:0.6B-F16` for embeddings

Not everything described in the planning docs is fully implemented yet. Remaining and out-of-stack items are tracked in [`docs/planning/backlog.md`](./docs/planning/backlog.md).

## Repository Layout

```text
apps/
  brain-api/
  brain-cli/
  brain-mcp/
packages/
  application/
  contracts/
  domain/
  infrastructure/
  orchestration/
docs/
  planning/
docker/
runtimes/
tests/
```

## Docs

- Current implementation overview: [`docs/planning/current-implementation.md`](./docs/planning/current-implementation.md)
- Backlog and not-yet-implemented items: [`docs/planning/backlog.md`](./docs/planning/backlog.md)
- Original rollout plan: [`docs/planning/implementation-plan.md`](./docs/planning/implementation-plan.md)
