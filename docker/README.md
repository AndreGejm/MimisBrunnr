# docker

Tracked container assets for the local Mimir runtime live here.

## Files

- `docker/mimir-api.Dockerfile`
- `docker/mimir-mcp.Dockerfile`
- `docker/mcp/*`
- `docker/compose.local.yml`
- `docker/compose.mcp-session.yml`
- `docker/compose.tools.yml`
- `docker/tool-registry/*.json` and `docker/tool-registry.schema.json`

## Current runtime behavior

`docker/mimir-api.Dockerfile`:

- builds the workspace with Node 22
- runs `pnpm install --frozen-lockfile`
- runs `pnpm build`
- starts the app with `pnpm api`

`docker/compose.local.yml`:

- runs `mimir-api`
- runs `qdrant`
- maps the API to `8080:8080`
- binds persistent named volumes for canonical vault, staging vault, SQLite state, and Qdrant storage
- points model-backed providers at `http://model-runner.docker.internal:12434`
- sets embedding, reasoning, drafting, and reranking selectors to the Ollama-compatible stack

## AI tool profiles

`docker/compose.tools.yml` defines starter Docker Desktop profiles for local AI tools that should operate around Mimir without becoming uncontrolled memory writers:

- `rtk` for command rewriting and repo inspection
- `codesight` for repository maps and code insight generation
- `aider` for coding-agent workflows

The tool metadata source of truth is `docker/tool-registry/*.json`; the manifest contract is documented in `docker/tool-registry.schema.json` and enforced by `packages/infrastructure/src/tools/tool-registry.ts`. The same metadata can be exposed with `includeRuntime: true` so Docker Desktop profiles, MCP clients, and future installers can discover compose files, profile names, service names, image names, mount contracts, and required environment keys from one registry instead of duplicating that wiring.

The registry intentionally separates tool access from mimisbrunnr authority:

- tools may mount the target workspace as read-only or read-write depending on the manifest
- tools may use a cache volume when needed
- tools must not mount mimisbrunnr directly
- tools that need durable memory must use governed Mimir commands such as `create-session-archive` or `draft-note`

This slice defines the registry and Docker profiles only. It does not add a general-purpose `execute-tool` gateway.

## Docker toolbox v1

The repo now also contains an intent-driven Docker MCP toolbox surface under `docker/mcp`.

Key rules:

- manifests in `docker/mcp` are the source of truth
- Docker runtime state is compiled from those manifests
- agents discover toolboxes first through `mimir-control`
- v1 activation is reconnect or fork into an approved profile, not hot tool injection

Useful commands:

```bash
pnpm cli check-mcp-profiles --json "{}"
pnpm cli list-toolboxes --json "{}"
pnpm docker:mcp:sync
pnpm docker:mcp:sync:json
pnpm mcp:control
```

The operator runbook lives in [`documentation/operations/docker-toolbox-v1.md`](/F:/Dev/scripts/Mimir/mimir/documentation/operations/docker-toolbox-v1.md).

## Discover and validate configured AI tools

Mimir exposes the tool registry as read-only metadata. Discovery, package planning, and validation do not execute tools, build images, or grant direct access to mimisbrunnr.

CLI:

```bash
mimir list-ai-tools --json "{}"
mimir list-ai-tools --json '{"ids":["rtk"],"includeEnvironment":true}'
mimir list-ai-tools --json '{"ids":["aider"],"includeRuntime":true}'
mimir check-ai-tools --json "{}"
mimir check-ai-tools --json '{"ids":["rtk"]}'
mimir tools-package-plan --json '{"ids":["aider","rtk"]}'
```

HTTP:

```bash
curl -s http://127.0.0.1:8080/v1/tools/ai \
  -H "content-type: application/json" \
  -d '{"ids":["rtk"]}'

curl -s http://127.0.0.1:8080/v1/tools/ai/check \
  -H "content-type: application/json" \
  -d '{"ids":["rtk"]}'

curl -s http://127.0.0.1:8080/v1/tools/ai/package-plan \
  -H "content-type: application/json" \
  -d '{"ids":["rtk"]}'
```

MCP tool names: `list_ai_tools` for discovery, `check_ai_tools` for manifest validation, and `tools_package_plan` for reusable Docker package plans.

Set `MAB_TOOL_REGISTRY_DIR` when the registry manifests live outside `docker/tool-registry`. Use `check-ai-tools` before packaging or editing profiles; it reports malformed manifests and policy violations per file without starting containers. New manifests should follow `docker/tool-registry.schema.json`.

When `includeRuntime` is true, each listed tool can include a `runtime` descriptor with:

- `compose.files`: the compose file stack required for the profile
- `compose.profile` and `compose.service`: the Docker profile and service to invoke
- `container.image`, `container.entrypoint`, and `container.workingDir`: the expected container launch surface
- `container.workspaceMount`: the `MIMIR_TOOL_WORKSPACE` host path contract mapped into `/workspace`
- optional `container.cacheMount`: the named cache volume contract when the tool manifest allows cache writes
- `container.mimisbrunnrMountAllowed`: currently always `false`
- `environmentKeys`: sorted environment variable names the tool expects

The descriptor is intentionally descriptive. It does not start containers and it does not bypass Mimir governance.

`tools-package-plan` returns the installer-facing plan shape: compose files, profile/service, `docker compose ... run --rm <service>` arguments, workspace/cache mounts, expected environment keys, build recipe presence, and caveats such as missing local images or writable workspace mounts. Treat `packageReady: false` as a packaging blocker for the requested tool set.

## Important profile note

The compose runtime profile is more model-backed than the generic defaults in `packages/infrastructure/src/config/env.ts`.

For example:

- generic defaults use `hash` embeddings and `heuristic` reasoning unless overridden
- compose forces the main provider selectors to `ollama`

## Run the local runtime

```bash
docker compose -f docker/compose.local.yml up --build
```

## Inspect a tool profile

Tool images are expected to exist locally under the names declared in `docker/tool-registry/*.json`. The manifest contract is documented by `docker/tool-registry.schema.json`, and the registry/profile contract can be inspected before the images exist.

```bash
docker compose -f docker/compose.local.yml -f docker/compose.tools.yml --profile rtk config
```

When a local tool image exists, run it through its profile, for example:

```bash
docker compose -f docker/compose.local.yml -f docker/compose.tools.yml --profile rtk run --rm rtk --version
```

Set `MIMIR_TOOL_WORKSPACE` when the tool should inspect or edit a workspace other than the parent of this repo. This is the same host-path variable reported by the `includeRuntime` descriptor.

`mimir doctor --json` also reports a `dockerTools` section. For release packaging, treat `dockerTools.reusable: true` as the preflight signal that `docker/compose.tools.yml` exists, the registry exists, at least one `docker/tool-registry/*.json` manifest is present, and every manifest passes the standalone packaging summary check.

The doctor output includes `dockerTools.registry.invalidManifestCount`, `dockerTools.registry.manifests`, and `dockerTools.registry.tools`. `manifests` reports per-file validity/errors. `tools` is a compact valid-tool package summary with id, kind, image, profile, entrypoint, workspace/cache mount policy, memory write policy, allowed Mimir commands, and operator-review requirement.

## Evidence status

### Verified facts

- This README is based on `docker/mimir-api.Dockerfile`, `docker/compose.local.yml`, `docker/compose.tools.yml`, `docker/tool-registry/*.json`, and `docker/tool-registry.schema.json`
- Tool manifests are validated by `tests/e2e/tool-registry.test.mjs`

### Assumptions

- Tool images such as `mimir-tool-rtk:local` are built or installed separately

### TODO gaps

- Add image build definitions after choosing the official packaging strategy for each tool
- Add a governed execution gateway only after its auth, review, and audit boundaries are specified
