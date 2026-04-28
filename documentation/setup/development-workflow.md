# Development workflow

This repository is easiest to work on when you treat the transports as thin
shells over shared services and keep docs aligned with the code in the same
change.

Two runtime layers are easy to blur together:

- the stable Mimir command catalog exposed through CLI, HTTP, and `apps/mimir-mcp`
- the repo-governed toolbox control and broker surfaces exposed through
  `apps/mimir-control-mcp` and `apps/mimir-toolbox-mcp`

When you edit docs or code around those areas, name the layer explicitly.

## Baseline local loop

```bash
corepack enable
corepack pnpm install
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
```

Use the narrower scripts when they fit the slice you changed:

```bash
corepack pnpm test:interface-docs
corepack pnpm test:transport
corepack pnpm test:command-surface
corepack pnpm test:security-audit
corepack pnpm security:audit
corepack pnpm test:installer-codex-smoke
corepack pnpm test:voltagent-contracts
corepack pnpm test:voltagent-smoke
```

If you touch `runtimes/local_experts`, also run:

```bash
python -m pytest runtimes/local_experts/tests/test_safety_gate.py -v
```

## Use repo-local entrypoints first

The verified repo-local command forms come from the root workspace scripts:

- `corepack pnpm cli -- <command>`
- `corepack pnpm api`
- `corepack pnpm mcp`
- `corepack pnpm mcp:control`
- `corepack pnpm docker:mcp:audit:json`
- `corepack pnpm docker:mcp:sync:json`

Global launchers and client config are optional convenience setup, not the
source of truth for contributor workflows.

## Change by layer

### Domain and contracts

If the concept is new or a payload shape changes:

- start in `packages/domain`
- then update `packages/contracts`
- then update `documentation/reference/interfaces.md`

### Application services

If behavior changes but transports should stay the same:

- start in `packages/application/src/services`
- keep transport-specific parsing, status mapping, and ingress validation out of
  the service layer

### Orchestration and auth

If a command becomes routable or authorization changes:

- update `packages/orchestration/src/routing/task-family-router.ts`
- update `packages/orchestration/src/root/actor-authorization-policy.ts`
- update the transport adapters and docs in the same change

### Infrastructure

If persistence, providers, or bootstrap wiring changes:

- update `packages/infrastructure/src/bootstrap/build-service-container.ts`
- update the specific adapter under `packages/infrastructure/src/**`
- update the current-state docs for any new env, health, or degraded-mode behavior

### Transports

If a capability becomes externally reachable:

- update the contract first
- wire the orchestrator or shared service
- add or extend transport tests
- update the matching docs under `documentation/apps/*` and
  `documentation/reference/interfaces.md`
- run `corepack pnpm test:interface-docs` so the tracked HTTP interface docs
  stay aligned with the route definitions exported from `apps/mimir-api/src/server.ts`

### Codesight and interface maps

`.codesight/` is a local generated artifact and is ignored by git. Do not edit
its route map by hand. When the HTTP route surface changes, update the tracked
interface docs and regenerate the local Codesight route artifacts from source:

```bash
corepack pnpm codesight:routes
corepack pnpm codesight:routes:check
corepack pnpm test:interface-docs
```

`codesight:routes` builds the workspace, reads the route definitions exported by
`apps/mimir-api/src/server.ts`, and rewrites `.codesight/routes.md` plus the
route section in `.codesight/CODESIGHT.md` when those local files exist.

### Dependency advisories

Run `corepack pnpm security:audit` after dependency changes. The script parses
`pnpm audit --audit-level moderate --json` and fails on any advisory that is not
explicitly allowed in `scripts/audit-security.mjs`.

The current allowlist is intentionally narrow: it permits only the known
transitive `GHSA-w5hq-g745-h8pq` advisory for `@voltagent/core 2.7.x` resolving
to `uuid 9.0.1` along the documented workspace paths. Do not replace this with a
blanket `pnpm audit` ignore. Remove the exception when VoltAgent publishes a
compatible patched dependency.

### Toolbox policy and broker work

If the change affects toolbox visibility, approval, session mode, or authoring:

- start in `docker/mcp/**`, `packages/contracts/src/toolbox/**`, and
  `packages/infrastructure/src/toolbox/**`
- keep `apps/mimir-control-mcp` and `apps/mimir-toolbox-mcp` aligned with the
  same compiler and runtime semantics
- update these docs in the same change:
  - `documentation/operations/docker-toolbox-v1.md`
  - `documentation/architecture/session-semantics.md`
  - `documentation/reference/interfaces.md`

## Documentation rules

- prefer current-state docs over planning docs when you describe live behavior
- if a planning file is still useful but no longer current, label it as phase or
  historical context instead of copying its wording into setup docs
- do not document `.env` auto-loading unless the code actually gains a loader
- do not document a `mimir-mcp` global launcher; the tracked install surface
  configures clients against `scripts/launch-mimir-mcp.mjs`

Useful current-state references:

- `documentation/planning/current-implementation.md`
- `documentation/reference/interfaces.md`
- `documentation/operations/docker-toolbox-v1.md`
- `documentation/reference/repo-map.md`

## Constraints to remember

- the tracked CI workflow is focused on core quality; it is not a full release
  publication pipeline
- there is no tracked migration runner for SQLite changes
- there is no cross-platform one-shot bootstrap script
- the Windows installer `prepare-repo-workspace` path requires a clean worktree
- Docker MCP profile apply remains optional and may still be blocked by the
  local Toolkit contract or descriptor-only peer policies
