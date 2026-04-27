# Repository map

This is the current tracked repo map.

## Top level

Tracked top-level directories:

| Path | Role |
| --- | --- |
| `.github/` | targeted CI workflows |
| `apps/` | transport entrypoints |
| `docker/` | Dockerfiles, compose profiles, tool registry, and toolbox policy manifests |
| `docs/` | older planning and spec material |
| `documentation/` | canonical current-state docs |
| `packages/` | layered TypeScript runtime code |
| `runtimes/` | vendored Python coding runtime |
| `scripts/` | diagnostics, sync helpers, installer backend, launch wrappers |
| `tests/` | Node end-to-end coverage |
| `vendor/` | vendored external client subtree |

Tracked top-level files that matter most operationally:

- `README.md`
- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `tsconfig.base.json`
- `.env.example`

## Apps

Current app entrypoints:

| Path | Role |
| --- | --- |
| `apps/mimir-api` | HTTP adapter |
| `apps/mimir-cli` | CLI adapter plus toolbox authoring and sync commands |
| `apps/mimir-mcp` | direct MCP adapter for the stable command catalog |
| `apps/mimir-control-mcp` | toolbox discovery, approval, lease, reconnect |
| `apps/mimir-toolbox-mcp` | dynamic toolbox broker |

## Packages

Current package layering:

| Path | Role |
| --- | --- |
| `packages/domain` | shared domain vocabulary and invariants |
| `packages/contracts` | transport contracts and toolbox policy types |
| `packages/application` | retrieval, drafting, promotion, refresh, namespace, and history services |
| `packages/orchestration` | root orchestration, auth policy, coding domain, Mimir controllers |
| `packages/infrastructure` | adapters, bootstrap, providers, toolbox control surface, client materialization |

Read these first for live runtime behavior:

1. `packages/infrastructure/src/bootstrap/build-service-container.ts`
2. `packages/infrastructure/src/transport/runtime-command-dispatcher.ts`
3. `packages/infrastructure/src/toolbox/control-surface.ts`
4. `apps/mimir-toolbox-mcp/src/main.ts`
5. `apps/mimir-cli/src/main.ts`

## Toolbox policy tree

The toolbox policy source of truth is `docker/mcp`.

Current subtrees:

| Path | Role |
| --- | --- |
| `docker/mcp/bands` | reusable capability slices |
| `docker/mcp/workflows` | approved multi-band compositions |
| `docker/mcp/profiles` | checked-in base profiles |
| `docker/mcp/servers` | owned and peer server descriptors |
| `docker/mcp/clients` | client overlays and reconnect strategy |
| `docker/mcp/candidates` | curated candidate catalog |

Current checked-in workflows include:

- `core-dev+docs-research`
- `core-dev+runtime-observe`
- `core-dev+security-audit`
- `core-dev+voltagent-dev`
- `core-dev+voltagent-docs`

## Current peer split

The compiled toolbox policy currently describes:

- owned servers: `mimir-control`, `mimir-core`
- `docker-catalog` peers: `brave-search`, `deepwiki-read`, `docker-docs`,
  `microsoft-learn`, `semgrep-audit`
- `descriptor-only` peers: `docker-admin`, `docker-read`, `dockerhub-read`,
  `github-read`, `github-write`, `grafana-observe`, `kubernetes-read`
- `local-stdio` peer: `voltagent-docs`

## External client subtree

`vendor/codex-claude-voltagent-client` is intentionally separate from the Mimir
runtime packages.

That subtree is the installer-managed external client surface. Mimir itself
still owns:

- memory
- retrieval
- governed writes
- local execution
- toolbox policy

## Docker and scripts

Most important Docker-facing files:

- `docker/compose.local.yml`
- `docker/compose.mcp-session.yml`
- `docker/mimir-api.Dockerfile`
- `docker/mimir-mcp.Dockerfile`
- `docker/mimir-mcp-session-entrypoint.mjs`
- `docker/tool-registry/*.json`

Most important script surfaces:

- `scripts/docker/audit-toolbox-assets.mjs`
- `scripts/docker/sync-mcp-profiles.mjs`
- `scripts/installers/windows/**`

## Tests

Current high-signal tests for the toolbox and transport surfaces:

- `tests/e2e/mcp-adapter.test.mjs`
- `tests/e2e/mimir-control-mcp.test.mjs`
- `tests/e2e/toolbox-manifest-contracts.test.mjs`
- `tests/e2e/toolbox-session-lease.test.mjs`
- `tests/e2e/toolbox-cli.test.mjs`
- `tests/e2e/docker-toolbox-sync.test.mjs`
- `tests/e2e/config-boundaries.test.mjs`
- `tests/e2e/local-model-providers.test.mjs`

The Python runtime has its own tests under `runtimes/local_experts/tests`.
