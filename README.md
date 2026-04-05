# Multi Agent Brain

Local-first, service-oriented multi-agent runtime for governed memory, bounded retrieval, and safety-gated coding execution.

## Current Status

This repository is no longer just a foundation scaffold. The core local-first architecture is implemented.

Implemented today:

- a layered TypeScript monorepo with `domain`, `contracts`, `application`, `infrastructure`, and `orchestration` packages
- thin transport adapters for CLI, HTTP, and MCP
- direct context-packet assembly exposed through CLI, HTTP, and MCP
- canonical Markdown storage plus a separate staging write plane
- SQLite as the metadata and audit authority
- SQLite FTS lexical retrieval and Qdrant vector retrieval
- runtime freshness reporting plus operator-visible refresh candidates and retrieval warnings for expired, expiring, or not-yet-valid evidence
- governed refresh-draft creation that reuses an existing open refresh draft for the same stale canonical note
- Git-centric release metadata exposed through CLI, HTTP, MCP, and health surfaces
- bounded context packet assembly and decision-summary generation
- deterministic validation and promotion for staged notes
- actor-registry authn/authz with file-backed registry loading, rotated credentials, and validity windows
- centrally issued short-lived actor tokens for registered actors via an issuer secret
- protected operator auth-control surfaces in CLI and HTTP for status, token issuance, and token introspection
- model-role and provider abstractions for the local model stack
- an OpenAI-compatible paid escalation provider path behind the reserved `paid_escalation` role
- a vendored Python coding runtime integrated through the coding domain

Current local model stack:

- Docker Model Runner at `http://127.0.0.1:12434`
- `qwen3:4B-F16` for local reasoning and drafting
- `qwen3-coder` for coding tasks
- `qwen3-reranker` for reranking
- `docker.io/ai/qwen3-embedding:0.6B-F16` for embeddings
- `docker/compose.local.yml` aligned to the same Docker Model Runner + Qwen profile for containerized bring-up

Current local storage default:

- Windows host runs default the canonical brain root to `F:\Dev\AI Context Brain` when `MAB_VAULT_ROOT` is unset
- containerized runs still use `/data/vault/canonical` inside the container

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
- MCP rollout and go-live gates: [`docs/planning/go-live-gates.md`](./docs/planning/go-live-gates.md)
- Git-centric versioning and release contract: [`docs/planning/versioning-contract.md`](./docs/planning/versioning-contract.md)
- Original rollout plan: [`docs/planning/implementation-plan.md`](./docs/planning/implementation-plan.md)
