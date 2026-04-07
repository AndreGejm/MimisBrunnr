# Docker MCP session mode

This profile runs the stdio MCP server as an on-demand Docker container for a
single client session.

Use this mode when:

- you want an MCP client to launch Multi Agent Brain intentionally for a session
- you want canonical, staging, state, and auth config mounted from the host
- you want explicit startup validation instead of silent fallback or hidden
  background behavior

Do not use this mode when:

- you want a long-running HTTP service; use `docker/compose.local.yml` instead
- you want the brain auto-started for every workspace by default
- you cannot provide explicit host mounts for canonical, staging, state, and
  config

## Process model

Container entrypoint:

- `node docker/brain-mcp-session-entrypoint.mjs`

What the entrypoint does:

- logs configuration and validation status to `stderr`
- validates env, mounts, auth registry, Qdrant reachability, model availability,
  and Python runtime readiness
- launches `apps/brain-mcp/dist/main.js` only if validation passes
- exits cleanly when the MCP client closes stdin

The MCP protocol itself still runs directly over stdio from
`apps/brain-mcp/dist/main.js`. The wrapper exists only to keep startup and
shutdown deterministic.

## Required prerequisites

- Docker Desktop with Linux containers enabled
- Node dependencies already built into the image through
  `docker/brain-mcp.Dockerfile`
- Docker Model Runner or another Docker/Ollama-compatible endpoint exposing the
  required Qwen-family models
- Qdrant reachable from the container
- host directories for canonical notes, staging drafts, SQLite state, and auth
  config
- a file-backed actor registry entry for the MCP session actor

Required model IDs for the tracked profile:

- `docker.io/ai/qwen3-embedding:0.6B-F16`
- `qwen3:4B-F16`
- `qwen3-coder`
- `qwen3-reranker`

Python runtime packages installed in the image:

- `fastmcp`
- `httpx`

## What stays outside the container

External dependencies:

- canonical vault contents
- staging vault contents
- SQLite state file and parent directory
- actor registry config
- Qdrant
- Docker Model Runner / local model endpoint

Inside the container image:

- compiled TypeScript apps and packages
- vendored `runtimes/local_experts` Python runtime
- Docker MCP startup wrapper

This keeps authoritative data on the host and prevents accidental container-only
authority state.

## Environment file

Start from:

- `docker/brain-mcp-session.env.example`

This profile is intentionally strict:

- `MAB_AUTH_MODE=enforced`
- `MAB_AUTH_ALLOW_ANONYMOUS_INTERNAL=false`
- `MAB_DISABLE_PROVIDER_FALLBACKS=true`
- `MAB_QDRANT_SOFT_FAIL=false`
- fixed MCP session actor env is required

Example actor registry source:

- `docker/brain-mcp-session.actor-registry.example.json`

## Host mounts

The Docker MCP session profile expects four host-backed mounts:

- canonical root -> `/data/vault/canonical`
- staging root -> `/data/vault/staging`
- state root -> `/data/state`
- config root -> `/config/auth`

Expected files inside those mounts:

- canonical notes under `/data/vault/canonical`
- staging drafts under `/data/vault/staging`
- SQLite database at `/data/state/multi-agent-brain.sqlite`
- actor registry at `/config/auth/actor-registry.json`

Windows host example paths:

- `F:/Dev/scripts/MultiagentBrain/multi-agent-brain/vault/canonical`
- `F:/Dev/scripts/MultiagentBrain/multi-agent-brain/vault/staging`
- `F:/Dev/scripts/MultiagentBrain/multi-agent-brain/state`
- `F:/Dev/scripts/MultiagentBrain/multi-agent-brain/config/auth`

Use forward slashes in `docker run` arguments on Windows.

## Build the image

```bash
pnpm docker:mcp:build
```

Equivalent direct command:

```bash
docker build -f docker/brain-mcp.Dockerfile -t multi-agent-brain-mcp-session:local .
```

## Validate before launching

Validation-only run:

```bash
docker run --rm \
  --env-file docker/brain-mcp-session.env \
  --mount type=bind,src=F:/Dev/scripts/MultiagentBrain/multi-agent-brain/vault/canonical,dst=/data/vault/canonical \
  --mount type=bind,src=F:/Dev/scripts/MultiagentBrain/multi-agent-brain/vault/staging,dst=/data/vault/staging \
  --mount type=bind,src=F:/Dev/scripts/MultiagentBrain/multi-agent-brain/state,dst=/data/state \
  --mount type=bind,src=F:/Dev/scripts/MultiagentBrain/multi-agent-brain/config/auth,dst=/config/auth,readonly \
  --add-host host.docker.internal:host-gateway \
  --add-host model-runner.docker.internal:host-gateway \
  multi-agent-brain-mcp-session:local \
  --validate-only
```

Successful validation means:

- env is explicit
- canonical, staging, state, and config are mount-backed
- actor registry matches the fixed session actor token
- Qdrant is reachable
- the model endpoint exposes all required models
- Python and the vendored coding runtime are present

## Launch for an MCP session

Official direct-launch shape:

```bash
docker run --rm -i \
  --env-file docker/brain-mcp-session.env \
  --mount type=bind,src=F:/Dev/scripts/MultiagentBrain/multi-agent-brain/vault/canonical,dst=/data/vault/canonical \
  --mount type=bind,src=F:/Dev/scripts/MultiagentBrain/multi-agent-brain/vault/staging,dst=/data/vault/staging \
  --mount type=bind,src=F:/Dev/scripts/MultiagentBrain/multi-agent-brain/state,dst=/data/state \
  --mount type=bind,src=F:/Dev/scripts/MultiagentBrain/multi-agent-brain/config/auth,dst=/config/auth,readonly \
  --add-host host.docker.internal:host-gateway \
  --add-host model-runner.docker.internal:host-gateway \
  multi-agent-brain-mcp-session:local
```

Why this is the preferred client path:

- stdio is direct and unwrapped once startup succeeds
- `--rm` keeps the container session-scoped
- no long-running background MCP container is left behind

## Optional compose-run wrapper

Tracked compose asset:

- `docker/compose.mcp-session.yml`

This is mainly for operator convenience. It still expects:

- `docker/brain-mcp-session.env`
- host path env vars for the four mounts

Example:

```bash
docker compose -f docker/compose.mcp-session.yml run --rm -T brain-mcp-session
```

Direct `docker run` remains the safer default for MCP clients because it keeps
the stdio path simpler and easier to reason about.

## MCP client snippet

Example generic client config:

```json
{
  "mcpServers": {
    "multi-agent-brain": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "--env-file",
        "F:/Dev/scripts/MultiagentBrain/multi-agent-brain/docker/brain-mcp-session.env",
        "--mount",
        "type=bind,src=F:/Dev/scripts/MultiagentBrain/multi-agent-brain/vault/canonical,dst=/data/vault/canonical",
        "--mount",
        "type=bind,src=F:/Dev/scripts/MultiagentBrain/multi-agent-brain/vault/staging,dst=/data/vault/staging",
        "--mount",
        "type=bind,src=F:/Dev/scripts/MultiagentBrain/multi-agent-brain/state,dst=/data/state",
        "--mount",
        "type=bind,src=F:/Dev/scripts/MultiagentBrain/multi-agent-brain/config/auth,dst=/config/auth,readonly",
        "--add-host",
        "host.docker.internal:host-gateway",
        "--add-host",
        "model-runner.docker.internal:host-gateway",
        "multi-agent-brain-mcp-session:local"
      ]
    }
  }
}
```

## Readiness and health semantics

This profile does not expose an HTTP health endpoint.

Readiness model:

- preflight validation is the readiness gate
- MCP readiness begins only after the wrapper launches the stdio server
- container startup failure is explicit and non-degraded

Runtime behavior remains bounded:

- no automatic downgrade to hash or heuristic fallback behind remote providers
- no Qdrant soft-fail in Docker MCP session mode
- no hidden canonical writes
- normal auth and promotion rules still apply

## Common failure cases

Missing mount-backed authority paths:

- validation fails with `storage_mounts` or `storage_layout`

Actor registry mismatch:

- validation fails with `session_actor_binding`
- fix the mounted `actor-registry.json` and the `MAB_MCP_DEFAULT_*` values

Qdrant unavailable:

- validation fails with `qdrant_dependency`
- ensure Qdrant is listening on the configured host/port from inside Docker

Models missing from Docker Model Runner:

- validation fails with `model_endpoint_dependency`
- load the required Qwen models before launching the MCP session

Python runtime unavailable:

- validation fails with `coding_runtime_dependency`

## Shutdown behavior

Expected shutdown path:

- MCP client closes stdin
- `apps/brain-mcp` disposes the shared container
- container process exits
- Docker removes the container because `--rm` was used

If the client or operator sends `SIGINT` or `SIGTERM`, the wrapper forwards the
signal to the MCP process and exits when the child exits.

## Security and authority caveats

- This mode is for opt-in session use, not default always-on rollout
- auth is still enforced; the session actor must be explicit and file-backed
- mounting canonical, staging, state, or config to container-local ephemeral
  paths defeats the purpose of this profile
- Qdrant and model endpoints remain external trust dependencies and should be
  managed intentionally

## Deterministic verification flow

1. Build the image.
2. Copy `docker/brain-mcp-session.env.example` to `docker/brain-mcp-session.env`
   and fill in the token.
3. Copy `docker/brain-mcp-session.actor-registry.example.json` into the host
   config mount as `actor-registry.json` and replace the token.
4. Run the `--validate-only` command.
5. Launch the session with `docker run --rm -i ...`.
6. From the client, call `tools/list`.
7. Call a bounded read tool such as `search_context`.
8. Confirm auth failures still occur if you deliberately mismatch the actor
   token in the env file and rerun validation.
