# Module Map

This map is the current repo shape, not a historical plan.

## Core modules

| Area | Role | Key files |
| --- | --- | --- |
| `packages/domain` | Shared domain vocabulary, note lifecycle types, context packet primitives, audit types | `packages/domain/src/index.ts` |
| `packages/contracts` | Runtime command catalog, transport request and response contracts, toolbox policy types | `packages/contracts/src/index.ts` |
| `packages/application` | Retrieval, packet assembly, drafting, validation, promotion, history, namespace, and refresh services | `packages/application/src/index.ts` |
| `packages/orchestration` | Root orchestrator, auth policy, token inspection, coding domain, mimisbrunnr controllers | `packages/orchestration/src/index.ts` |
| `packages/infrastructure` | Runtime bootstrap, storage adapters, providers, transport validation, toolbox control surface, client materialization | `packages/infrastructure/src/index.ts` |
| `apps/mimir-api` | HTTP adapter for the runtime command catalog | `apps/mimir-api/src/server.ts` |
| `apps/mimir-cli` | CLI adapter for the runtime command catalog and toolbox authoring commands | `apps/mimir-cli/src/main.ts` |
| `apps/mimir-mcp` | Direct MCP adapter for the stable command catalog | `apps/mimir-mcp/src/main.ts`, `apps/mimir-mcp/src/tool-definitions.ts` |
| `apps/mimir-control-mcp` | Toolbox discovery, approval, lease, and reconnect surface | `apps/mimir-control-mcp/src/main.ts`, `apps/mimir-control-mcp/src/tool-definitions.ts` |
| `apps/mimir-toolbox-mcp` | Dynamic broker that changes visible tools inside one session | `apps/mimir-toolbox-mcp/src/main.ts`, `apps/mimir-toolbox-mcp/src/session-state.ts`, `apps/mimir-toolbox-mcp/src/adapters/*` |
| `docker/mcp` | Checked-in toolbox policy source of truth: servers, bands, workflows, base profiles, intents, clients | `docker/mcp/**` |
| `vendor/codex-claude-voltagent-client` | Installer-managed external client subtree kept outside Mimir runtime ownership | `vendor/codex-claude-voltagent-client/**` |
| `runtimes/local_experts` | Vendored Python coding runtime launched through the infrastructure bridge | `runtimes/local_experts/bridge.py` |
| `scripts` | Launchers, diagnostics, Docker audit helpers, installer backend, review GUI | `scripts/**` |

## Runtime files to read first

If you need to understand live behavior quickly, start here:

1. `packages/infrastructure/src/bootstrap/build-service-container.ts`
2. `packages/infrastructure/src/transport/runtime-command-dispatcher.ts`
3. `packages/infrastructure/src/toolbox/control-surface.ts`
4. `apps/mimir-toolbox-mcp/src/main.ts`
5. `apps/mimir-toolbox-mcp/src/session-state.ts`
6. `docker/mcp/bands/*.yaml`
7. `docker/mcp/workflows/*.yaml`

## Toolbox-specific module split

The toolbox runtime is spread across four layers:

- policy types in `packages/contracts/src/toolbox/policy.contract.ts`
- compilation and control logic in `packages/infrastructure/src/toolbox/*`
- compatibility control transport in `apps/mimir-control-mcp`
- dynamic broker transport in `apps/mimir-toolbox-mcp`

The checked-in `profiles/*.yaml` files are only the base profiles. Workflow
compositions under `workflows/*.yaml` compile into additional profile ids such
as `core-dev+docs-research` and `core-dev+voltagent-docs`.

## Current peer runtime classes

The compiled toolbox policy currently produces four practical server classes:

- owned in-process servers: `mimir-control`, `mimir-core`
- docker-catalog peers: `brave-search`, `deepwiki-read`, `docker-docs`,
  `microsoft-learn`, `semgrep-audit`
- descriptor-only peers: `docker-admin`, `docker-read`, `dockerhub-read`,
  `github-read`, `github-write`, `grafana-observe`, `kubernetes-read`
- local-stdio client-materialized peer: `voltagent-docs`

Descriptor-only peers stay in policy and diagnostics, but they do not become
safe Docker profile references until read-filtered or audited catalog entries
exist.

## Current hot spots

These files or directories carry the most current architecture-specific weight:

- `packages/infrastructure/src/bootstrap/build-service-container.ts`
- `packages/infrastructure/src/toolbox/control-surface.ts`
- `packages/infrastructure/src/toolbox/client-materialization.ts`
- `apps/mimir-toolbox-mcp/src/main.ts`
- `apps/mimir-toolbox-mcp/src/adapters/docker-gateway-adapter.ts`
- `apps/mimir-toolbox-mcp/src/adapters/local-stdio-adapter.ts`
- `docker/mcp/servers/*.yaml`
- `docker/mcp/bands/*.yaml`
- `docker/mcp/workflows/*.yaml`

## Test surfaces that exercise this map

The most relevant current tests for the module split above are:

- `tests/e2e/toolbox-manifest-contracts.test.mjs`
- `tests/e2e/mimir-control-mcp.test.mjs`
- `tests/e2e/toolbox-session-lease.test.mjs`
- `tests/e2e/toolbox-cli.test.mjs`
- `tests/e2e/docker-toolbox-sync.test.mjs`
- `tests/e2e/mimir-toolbox-mcp-local-stdio.test.mjs`
- `tests/e2e/mimir-toolbox-mcp-docker-catalog.test.mjs`
- `tests/e2e/mimir-toolbox-mcp-peer-diagnostics.test.mjs`
