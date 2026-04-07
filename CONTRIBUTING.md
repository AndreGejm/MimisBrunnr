# Contributing

This repository already contains runtime code, transport adapters, and end-to-end tests. Contributing safely means keeping the documented architecture aligned with the actual package wiring.

## Start here

Read these documents before changing behavior:

1. `README.md`
2. `docs/setup/installation.md`
3. `docs/setup/configuration.md`
4. `docs/architecture/overview.md`
5. `docs/architecture/invariants-and-boundaries.md`
6. `docs/reference/interfaces.md`
7. `docs/agents/ai-navigation-guide.md`

Treat `docs/planning/` as historical context unless a file explicitly describes a still-current contract and matches the code.

## Local workflow

```bash
corepack enable
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

If you touch the vendored Python runtime in `runtimes/local_experts`, also run:

```bash
python -m pytest runtimes/local_experts/tests/test_safety_gate.py -v
```

## Source-of-truth rules

- runtime configuration comes from `packages/infrastructure/src/config/env.ts`
- transport surface definitions live in code, not in the planning docs:
  - HTTP: `apps/brain-api/src/server.ts`
  - CLI: `apps/brain-cli/src/main.ts`
  - MCP: `apps/brain-mcp/src/tool-definitions.ts` and `apps/brain-mcp/src/main.ts`
- request/response contracts live in `packages/contracts/src/**`
- package dependency direction is:
  - `domain` -> no workspace dependencies
  - `contracts` -> `domain`
  - `application` -> `contracts`, `domain`
  - `orchestration` -> `application`, `contracts`, `domain`
  - `infrastructure` -> `application`, `contracts`, `domain`, `orchestration`
- SQLite schema creation currently lives inside adapter code under `packages/infrastructure/src/sqlite/**` and `packages/infrastructure/src/fts/**`

## Contribution boundaries

### Keep transports thin

`apps/brain-api`, `apps/brain-cli`, and `apps/brain-mcp` should stay responsible for:

- payload parsing and ingress validation
- actor-context injection
- transport-specific error/status mapping
- delegation into the shared orchestrator or shared services

Do not duplicate business logic in transport adapters.

### Preserve authority-state separation

The code distinguishes between:

- canonical notes
- staging drafts
- imported jobs
- session archives
- derived representations

Do not collapse those states into a single storage or namespace concept without also updating validation, promotion, retrieval, and docs.

### Promotion is multi-store and replayable

Promotion touches:

- staging draft state
- canonical filesystem state
- SQLite note/chunk metadata
- SQLite promotion outbox
- SQLite audit history
- lexical index state
- vector index state
- derived representations

The replay/outbox behavior lives in `packages/application/src/services/promotion-orchestrator-service.ts`. Changes here require careful regression testing.

### Retrieval is intentionally bounded

`packages/application/src/services/retrieve-context-service.ts` enforces bounded retrieval packet assembly and warning generation. Keep those bounds explicit when adding new retrieval strategies or packet types.

### Auth rules are central, not adapter-local

Authorization rules live in `packages/orchestration/src/root/actor-authorization-policy.ts`. If you add a new routed command or administrative action:

1. update the policy
2. update routing if needed
3. update contracts
4. update transport adapters
5. update `docs/reference/interfaces.md`

### The Node apps do not auto-load `.env`

If you change setup instructions or launcher behavior, remember that the code currently reads `process.env` directly. Do not document `.env` loading unless the code actually gains a loader.

## When adding a new capability

Typical order:

1. add or update domain types if the concept is new
2. add or update contracts in `packages/contracts`
3. implement or adjust application services
4. update orchestration or controllers if the capability becomes routable
5. wire infrastructure adapters if new persistence or providers are needed
6. expose the capability in one or more transport adapters
7. add or extend tests
8. update docs in the same change

## Documentation expectations

If your change affects behavior, update the canonical docs, not just comments:

- user/operator-facing behavior: `README.md`, `docs/operations/*`, `docs/reference/interfaces.md`
- setup or env vars: `docs/setup/*`, `docs/reference/env-vars.md`
- architectural boundaries: `docs/architecture/*`
- repository navigation or edit safety: `docs/reference/repo-map.md`, `docs/agents/ai-navigation-guide.md`

## Evidence status

### Verified facts

- This workflow is grounded in the tracked package dependency graph and entrypoints
- The current test and build commands come from `package.json`
- The current auth, promotion, and transport boundaries are implemented in tracked code under `packages/` and `apps/`

### Assumptions

- None

### TODO gaps

- If the repo adds tracked CI or a formal PR workflow, extend this file with that process
