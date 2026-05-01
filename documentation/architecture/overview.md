# Architecture Overview

mimir is a local-first TypeScript monorepo with one shared runtime and several
thin adapters. mimisbrunnr is the governed memory layer inside that runtime,
not a separate deployable in this workspace.

## Main runtime surfaces

- `apps/mimir-api`: HTTP adapter over the runtime command catalog
- `apps/mimir-cli`: JSON CLI over the same command catalog
- `apps/mimir-mcp`: direct MCP adapter for the stable command catalog
- `apps/mimir-control-mcp`: toolbox discovery, approval, lease, and reconnect
  surface
- `apps/mimir-toolbox-mcp`: dynamic toolbox broker that changes visible tools
  inside one session

The direct MCP adapter and the toolbox adapters are different products:

- `mimir-mcp` exposes the broad stable command catalog
- the toolbox surfaces expose a curated policy-driven subset built from
  `docker/mcp`

## Layered codebase

```text
packages/domain
  shared domain types and invariants

packages/contracts
  runtime command contracts, transport request shapes, toolbox policy types

packages/application
  retrieval, drafting, validation, promotion, history, namespace, and packet services

packages/orchestration
  root orchestration, auth policy, coding domain, mimisbrunnr controllers

packages/infrastructure
  environment loading, storage adapters, providers, transport validation,
  toolbox control surface, runtime bootstrap

apps/*
  thin transport adapters and toolbox broker endpoints

docker/mcp
  checked-in toolbox policy source of truth

vendor/codex-claude-voltagent-client
  installer-managed external client subtree kept separate from Mimir orchestration

runtimes/local_experts
  vendored Python coding runtime invoked through a subprocess bridge
```

Dependency direction is still one way through the packages:

`domain -> contracts -> application -> orchestration -> infrastructure -> apps`

## Shared runtime container

`packages/infrastructure/src/bootstrap/build-service-container.ts` is the main
assembly point.

It wires:

- filesystem-backed canonical and staging note repositories
- SQLite-backed metadata, audit, token, revocation, import, session-archive,
  context-namespace, context-representation, local-agent-trace, and tool-output
  stores
- SQLite FTS lexical retrieval
- Qdrant vector retrieval
- local and paid provider adapters
- auth policy and runtime command dispatch
- application services
- mimisbrunnr and coding domain controllers
- the root orchestrator

## Current toolbox architecture

The toolbox runtime is policy-driven. The checked-in source of truth is
`docker/mcp`, not the live Docker toolkit state.

Authoring layers:

- `bands/*.yaml`: reusable capability slices
- `workflows/*.yaml`: repeated multi-band compositions
- `profiles/*.yaml`: checked-in base profiles
- `intents.yaml`: user-facing toolbox choices
- `clients/*.yaml`: client overlays and reconnect strategy
- `servers/*.yaml`: owned and peer server descriptors

Compiled runtime behavior:

- workflow files compile into additional profile ids such as
  `core-dev+docs-research` and `core-dev+voltagent-docs`
- `packages/infrastructure/src/toolbox/control-surface.ts` resolves toolbox
  requests, issues leases, and returns reconnect handoffs
- `apps/mimir-toolbox-mcp/src/session-state.ts` tracks active bands, lease
  expiry, idle timeout, and activation cause for brokered sessions
- `packages/infrastructure/src/toolbox/client-materialization.ts` only
  materializes local-stdio peers marked `configTarget: codex-mcp-json`; the
  current live example is `voltagent-docs`

## Persistence model

Current persistence surfaces are:

- Markdown note bodies on disk
- SQLite for metadata, audit, token lifecycle, imports, session archives,
  namespace nodes, derived representations, local-agent traces, and tool-output
  metadata
- SQLite FTS for lexical retrieval
- Qdrant for vector retrieval

There is still no tracked migration directory. Schema creation and upgrades live
inside the adapters.

## External client boundary

The repo also vendors `vendor/codex-claude-voltagent-client`, but that subtree
stays logically separate from Mimir runtime ownership.

Mimir owns:

- durable memory
- retrieval and context assembly
- governed review and promotion
- local execution
- bounded paid helper roles

External clients still own:

- skills
- subagents
- workspace skill roots
- client-local paid-agent quality

See `documentation/reference/external-client-boundary.md` for the current
boundary contract.

## Current constraints

These constraints are active in the current repo state:

- Docker MCP profile server listing is inspectable through the current CLI, with
  older CLI fallback retained in the audits
- Docker apply safety still depends on governance cleanliness and safe
  materialization for every selected peer
- several peer servers remain descriptor-only wrappers because the live catalog
  surfaces are broader than the governed policy contract
- the broker can route owned tools and local-stdio peers today, while
  docker-catalog peer routing remains opt-in and still depends on gateway
  configuration
- the repo includes targeted GitHub Actions for VoltAgent contract and canary
  coverage, but no broader tracked release or deployment pipeline
