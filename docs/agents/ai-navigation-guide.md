# AI navigation guide

This guide is for automated reviewers, coding agents, and future maintainers who need to navigate the repo without guessing.

## Safe starting order

Read in this order:

1. `README.md`
2. `docs/reference/repo-map.md`
3. `docs/architecture/overview.md`
4. `docs/architecture/invariants-and-boundaries.md`
5. `docs/reference/interfaces.md`
6. `docs/reference/env-vars.md`
7. `CONTRIBUTING.md`

Then open the specific files for the task area.

## Source-of-truth rules

- trust runtime entrypoint code over planning docs
- trust `packages/infrastructure/src/config/env.ts` over assumptions about `.env`
- trust `apps/brain-api/src/server.ts`, `apps/brain-cli/src/main.ts`, and `apps/brain-mcp/src/tool-definitions.ts` for transport surfaces
- trust `packages/infrastructure/src/bootstrap/build-service-container.ts` for runtime wiring
- trust `tests/e2e/*.test.mjs` when docs and planning material disagree

## Canonical edit zones by task

### Add or change an HTTP route

Start with:

- `packages/contracts/src/**`
- `apps/brain-api/src/server.ts`
- whichever orchestrator or service file handles the command
- `docs/reference/interfaces.md`

### Add or change a CLI command

Start with:

- `packages/contracts/src/**`
- `apps/brain-cli/src/main.ts`
- target orchestrator/service file
- `docs/reference/interfaces.md`

### Add or change an MCP tool

Start with:

- `apps/brain-mcp/src/tool-definitions.ts`
- `apps/brain-mcp/src/main.ts`
- target orchestrator/service file
- `docs/reference/interfaces.md`

Also check `packages/contracts/src/mcp/index.ts` for export consistency.

### Change memory or promotion behavior

Start with:

- `packages/application/src/services/staging-draft-service.ts`
- `packages/application/src/services/note-validation-service.ts`
- `packages/application/src/services/promotion-orchestrator-service.ts`
- `packages/application/src/services/temporal-refresh-service.ts`
- `packages/infrastructure/src/sqlite/sqlite-metadata-control-store.ts`

### Change retrieval behavior

Start with:

- `packages/application/src/services/retrieve-context-service.ts`
- `packages/application/src/services/hierarchical-retrieval-service.ts`
- `packages/application/src/services/context-packet-service.ts`
- `packages/infrastructure/src/fts/sqlite-fts-index.ts`
- `packages/infrastructure/src/vector/qdrant-vector-index.ts`

### Change coding behavior

Start with:

- `packages/orchestration/src/coding/coding-domain-controller.ts`
- `packages/infrastructure/src/coding/python-coding-controller-bridge.ts`
- `runtimes/local_experts/bridge.py`
- `runtimes/local_experts/server.py`

## Dangerous edit zones

Be especially careful in these files because they affect multiple runtime surfaces:

- `packages/infrastructure/src/bootstrap/build-service-container.ts`
- `packages/orchestration/src/root/actor-authorization-policy.ts`
- `packages/application/src/services/promotion-orchestrator-service.ts`
- `packages/infrastructure/src/config/env.ts`
- `packages/infrastructure/src/sqlite/sqlite-metadata-control-store.ts`
- `apps/brain-mcp/src/tool-definitions.ts`

## Low-guess invariants to preserve

- transports stay thin
- canonical, staging, imported, session, and derived states stay distinct
- retrieval stays bounded
- refresh flows create staging drafts instead of editing canonical notes directly
- promotion remains replayable through the outbox path
- missing Qdrant degrades vector behavior instead of always crashing the runtime
- Node apps do not auto-load `.env`

## Known doc/code mismatch to keep in mind

- some planning docs still describe older rollout assumptions

If you change the MCP surface, update the runtime, the docs, and
`packages/contracts/src/mcp/index.ts` in the same pass.

## Practical onboarding path for agents

### If the task is documentation-only

Read:

- `README.md`
- `docs/reference/repo-map.md`
- `docs/reference/interfaces.md`
- adapter READMEs in `apps/*/README.md`

### If the task is runtime behavior

Read:

- `packages/infrastructure/src/bootstrap/build-service-container.ts`
- `packages/orchestration/src/root/multi-agent-orchestrator.ts`
- the target service file
- the relevant tests

### If the task is debugging a contradiction

Use this order:

1. runtime code
2. tests
3. canonical docs
4. planning docs last

## Evidence status

### Verified facts

- This guide is based on tracked entrypoints, runtime wiring, tests, and the current doc discovery pass

### Assumptions

- None

### TODO gaps

- If the repo adds new apps, packages, or deployment surfaces, extend the task-to-file map
