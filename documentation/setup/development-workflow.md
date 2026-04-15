# Development workflow

This repository is easiest to work on when you treat the transport adapters as thin shells over shared services and keep doc updates in the same change as behavior updates.

## Recommended workflow

1. install dependencies with `pnpm install`
2. build the workspace with `pnpm build`
3. run focused tests for the area you changed
4. run `pnpm test` before claiming the change is complete
5. update the canonical docs if any runtime behavior, command surface, or env var changed

## Common verification commands

```bash
pnpm build
pnpm typecheck
pnpm test:transport
pnpm test
python -m pytest runtimes/local_experts/tests/test_safety_gate.py -v
```

## Change-by-layer guidance

### Domain and contracts

If the concept is new or the request/response shape changes:

- update `packages/domain`
- update `packages/contracts`
- update the docs in `documentation/reference/interfaces.md` and `documentation/reference/glossary.md`

### Application services

If behavior changes but the transport surface should not:

- start in `packages/application/src/services`
- keep filesystem, SQLite, vector, or provider wiring out of the service layer unless the port contract changes

### Orchestration and auth

If a new command becomes routable or an existing command changes authorization:

- update `packages/orchestration/src/routing/task-family-router.ts`
- update `packages/orchestration/src/root/actor-authorization-policy.ts`
- update transport adapters and docs together

### Infrastructure

If persistence, providers, or runtime bootstrapping changes:

- update `packages/infrastructure/src/bootstrap/build-service-container.ts`
- update the specific adapter under `packages/infrastructure/src/**`
- document new persistence, health, or env behavior

### Transport adapters

If a capability becomes externally reachable:

- add/update the contract
- wire the orchestrator or shared service in the transport
- add or extend transport tests
- update adapter README files and `documentation/reference/interfaces.md`

## What to watch carefully

- promotion logic in `packages/application/src/services/promotion-orchestrator-service.ts`
- note validation policy in `packages/application/src/services/note-validation-service.ts`
- auth rules in `packages/orchestration/src/root/actor-authorization-policy.ts`
- env loading defaults in `packages/infrastructure/src/config/env.ts`
- MCP tool exposure in both `apps/mimir-mcp/src/tool-definitions.ts` and `apps/mimir-mcp/src/main.ts`
- the vendored Python runtime under `runtimes/local_experts`

## Documentation discipline

When changing the repo:

- prefer `documentation/architecture/*`, `documentation/setup/*`, `documentation/operations/*`, and `documentation/reference/*` over planning docs
- treat `documentation/planning/*` as historical unless you also rewrite them for current-state accuracy
- keep leaf adapter documentation (`documentation/apps/mimir-api.md`, `documentation/apps/mimir-cli.md`, `documentation/apps/mimir-mcp.md`) consistent with the current code surface

## Current repository constraints

- no tracked CI workflow runs these checks for you
- no tracked migration runner exists for SQLite changes
- no one-shot shell bootstrap script exists; `scripts/` contains scoped launcher, access, review, and cleanup helpers

## Evidence status

### Verified facts

- The commands above come from `package.json`
- The layer boundaries described here come from the workspace package dependency graph and the wiring in `packages/infrastructure/src/bootstrap/build-service-container.ts`

### Assumptions

- None

### TODO gaps

- If the repo adds tracked lint, format, CI, or release automation, extend this workflow
