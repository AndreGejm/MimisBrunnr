# Contributing

This repository already contains runtime code, transport adapters, toolbox
policy, and end-to-end tests. Contributing safely means keeping the documented
current state aligned with the actual package wiring and transport surfaces.

## Start here

Read these documents before changing behavior:

1. `README.md`
2. `documentation/setup/installation.md`
3. `documentation/setup/development-workflow.md`
4. `documentation/setup/configuration.md`
5. `documentation/architecture/overview.md`
6. `documentation/architecture/invariants-and-boundaries.md`
7. `documentation/reference/interfaces.md`
8. `documentation/planning/current-implementation.md`
9. `documentation/reference/repo-map.md`

Treat `documentation/planning/*` as planning or phase history unless a file
explicitly matches the current code and says it describes the current runtime.

## Local workflow

```bash
corepack enable
corepack pnpm install
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
```

Run narrower checks when they match the slice you changed:

```bash
corepack pnpm test:transport
corepack pnpm test:command-surface
corepack pnpm test:installer-codex-smoke
corepack pnpm test:voltagent-contracts
corepack pnpm test:voltagent-smoke
```

If you touch `runtimes/local_experts`, also run:

```bash
python -m pytest runtimes/local_experts/tests/test_safety_gate.py -v
```

## Source-of-truth rules

- runtime configuration comes from `packages/infrastructure/src/config/env.ts`
- transport surface definitions live in code, not in planning docs:
  - HTTP: `apps/mimir-api/src/server.ts`
  - CLI: `apps/mimir-cli/src/main.ts`
  - core MCP: `apps/mimir-mcp/src/tool-definitions.ts` and `apps/mimir-mcp/src/main.ts`
  - toolbox control MCP: `apps/mimir-control-mcp/src/main.ts`
  - toolbox broker MCP: `apps/mimir-toolbox-mcp/src/main.ts`
- request and response contracts live in `packages/contracts/src/**`
- package dependency direction is:
  - `domain` -> no workspace dependencies
  - `contracts` -> `domain`
  - `application` -> `contracts`, `domain`
  - `orchestration` -> `application`, `contracts`, `domain`
  - `infrastructure` -> `application`, `contracts`, `domain`, `orchestration`
- SQLite schema creation still lives inside adapter code under
  `packages/infrastructure/src/sqlite/**` and `packages/infrastructure/src/fts/**`

Documentation-specific rule:

- do not document a separate `mimir-mcp` global launcher unless the code grows
  one; the tracked install surface configures clients against
  `scripts/launch-mimir-mcp.mjs`

## Contribution boundaries

### Keep transports thin

`apps/mimir-api`, `apps/mimir-cli`, `apps/mimir-mcp`,
`apps/mimir-control-mcp`, and `apps/mimir-toolbox-mcp` should stay responsible
for:

- payload parsing and ingress validation
- actor-context injection
- transport-specific error and status mapping
- delegation into the shared orchestrator or shared services

Do not duplicate business logic in transport adapters.

### Preserve authority-state separation

The code distinguishes between:

- canonical notes
- staging drafts
- imported jobs
- session archives
- derived representations

Do not collapse those into one storage or namespace concept without also
updating validation, promotion, retrieval, and docs.

### Promotion is multi-store and replayable

Promotion touches:

- staging draft state
- canonical filesystem state
- SQLite note and chunk metadata
- SQLite promotion outbox
- SQLite audit history
- lexical index state
- vector index state
- derived representations

The replay and outbox behavior lives in
`packages/application/src/services/promotion-orchestrator-service.ts`. Changes
here need careful regression coverage.

### Retrieval is intentionally bounded

`packages/application/src/services/retrieve-context-service.ts` enforces bounded
retrieval packet assembly and warning generation. Keep those bounds explicit
when adding retrieval strategies or packet types.

### Auth rules are central

Authorization rules live in
`packages/orchestration/src/root/actor-authorization-policy.ts`.

If you add a new routed command or administrative action:

1. update the policy
2. update routing if needed
3. update contracts
4. update transport adapters
5. update `documentation/reference/interfaces.md`
6. if toolbox activation, dynamic visibility, or guided authoring changes too,
   update `documentation/operations/docker-toolbox-v1.md` and
   `documentation/architecture/session-semantics.md`

### The Node apps do not auto-load `.env`

If you change setup instructions or launcher behavior, remember that the apps
currently read `process.env` directly.

## When adding a capability

Typical order:

1. add or update domain types if the concept is new
2. add or update contracts in `packages/contracts`
3. implement or adjust application services
4. update orchestration if the capability becomes routable
5. wire infrastructure adapters if new persistence or providers are needed
6. expose the capability in one or more transport adapters
7. add or extend tests
8. update the current-state docs in the same change

## Documentation expectations

Docs in this repo should be descriptive, not aspirational.

If your change affects behavior, update the canonical docs, not just comments:

- user and operator behavior: `README.md`, `documentation/reference/interfaces.md`,
  `documentation/operations/*`
- setup or env vars: `documentation/setup/*`, `documentation/reference/env-vars.md`
- architecture or boundary changes: `documentation/architecture/*`
- repo navigation or edit safety: `documentation/reference/repo-map.md`,
  `documentation/agents/ai-navigation-guide.md`
- toolbox policy, rollout, or broker behavior:
  `documentation/operations/docker-toolbox-v1.md`,
  `documentation/architecture/session-semantics.md`, and any current-state
  setup doc that names the changed behavior

If a planning doc no longer matches the code, either update the current-state
docs instead or rewrite the planning file so it is clearly historical context.

## Current constraints

- there is no tracked CI workflow doing this verification for you
- there is no tracked migration runner for SQLite changes
- there is no cross-platform one-shot bootstrap script
- the Windows installer backend is still headless
- Docker MCP apply remains optional and may still be blocked by the local
  Toolkit contract or descriptor-only peer policies
