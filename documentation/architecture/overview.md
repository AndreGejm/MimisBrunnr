# Architecture Overview

mimir is the application and orchestrator. mimisbrunnr is the AI context well inside mimir: the governed memory, retrieval, and context assembly layer. The code paths show a clear dependency direction and a shared runtime container, even though some older planning docs still describe parts of that runtime as future work.

See `documentation/reference/terminology.md` before renaming product or memory surfaces.

## Layered package map

```text
packages/domain
  foundational types and invariants

packages/contracts
  transport and service request/response shapes

packages/application
  business services and port interfaces

packages/orchestration
  mimir orchestration, mimisbrunnr domain controllers, auth policy, model-role resolution

packages/infrastructure
  env loading, storage adapters, providers, runtime container, health, transport validation

apps/mimir-api
apps/mimir-cli
apps/mimir-mcp
  thin transport entrypoints over the shared mimir runtime

runtimes/local_experts
  vendored Python coding runtime invoked through a subprocess bridge
```

## Dependency direction

The tracked `package.json` files implement this dependency direction:

```text
domain
  ^
contracts
  ^
application
  ^
orchestration
  ^
infrastructure
  ^
apps/*
```

`apps/*` depend on `@mimir/contracts` and `@mimir/infrastructure`, then enter the runtime through `buildServiceContainer()`.

## Runtime composition

The main runtime wiring lives in `packages/infrastructure/src/bootstrap/build-service-container.ts`.

It constructs:

- repositories for canonical and staging note files
- SQLite-backed stores for metadata, audit, imports, session archives, issued tokens, revocations, namespace nodes, and context representations
- SQLite FTS lexical index
- Qdrant vector index
- local/pseudo-local model providers
- auth policy
- application services
- mimisbrunnr domain controllers
- the root MimirOrchestrator

## Major subsystems

### mimisbrunnr Memory and Authority

- canonical filesystem repository: `packages/infrastructure/src/vault/file-system-canonical-note-repository.ts`
- staging filesystem repository: `packages/infrastructure/src/vault/file-system-staging-note-repository.ts`
- canonical note service: `packages/application/src/services/canonical-note-service.ts`
- staging draft service: `packages/application/src/services/staging-draft-service.ts`
- promotion orchestrator: `packages/application/src/services/promotion-orchestrator-service.ts`
- temporal refresh: `packages/application/src/services/temporal-refresh-service.ts`

### mimisbrunnr Retrieval and Context Assembly

- retrieve context: `packages/application/src/services/retrieve-context-service.ts`
- hierarchical retrieval: `packages/application/src/services/hierarchical-retrieval-service.ts`
- packet assembly: `packages/application/src/services/context-packet-service.ts`
- decision summary: `packages/application/src/services/decision-summary-service.ts`
- namespace browse/read: `packages/application/src/services/context-namespace-service.ts`
- derived L0/L1 representations: `packages/application/src/services/context-representation-service.ts`

### Auth and governance

- policy: `packages/orchestration/src/root/actor-authorization-policy.ts`
- issued token creation/verification: `packages/orchestration/src/root/issued-actor-token.ts`
- transport-level auth request validation: `packages/infrastructure/src/transport/auth-control-validation.ts`

### Coding domain

- orchestrator/controller entry: `packages/orchestration/src/coding/coding-domain-controller.ts`
- Node bridge: `packages/infrastructure/src/coding/python-coding-controller-bridge.ts`
- vendored runtime: `runtimes/local_experts/bridge.py` and related modules

## Persistence model

The repository uses multiple persistence surfaces:

- filesystem for canonical and staging note bodies
- SQLite for metadata, audit, issued tokens, revocations, session archives, import jobs, namespace projections, and derived representations
- SQLite FTS for lexical retrieval
- Qdrant for vector search

There is no tracked standalone migration system. Table creation happens inside adapter code with `CREATE TABLE IF NOT EXISTS` and selective `ALTER TABLE` logic.

## Operational profile

The repository currently provides:

- a direct-process CLI
- an HTTP server
- a stdio MCP server
- a Docker compose profile for the HTTP server plus Qdrant

The repository does not currently contain:

- a standalone worker
- a tracked background scheduler
- tracked queue infrastructure
- tracked CI/CD configuration

## Evidence status

### Verified facts

- This overview is based on tracked workspace manifests and the runtime container wiring in `packages/infrastructure/src/bootstrap/build-service-container.ts`

### Assumptions

- None

### TODO gaps

- If the repository adds background workers, deployment descriptors, or new transport adapters, extend this document and `documentation/reference/repo-map.md`
