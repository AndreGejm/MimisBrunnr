# Docker Toolbox v1

This document describes the current toolbox runtime. It is not a future-state
spec.

## Source of truth

The toolbox policy source of truth is the checked-in manifest tree under
`docker/mcp`.

Current manifest families:

- `bands/*.yaml`
- `workflows/*.yaml`
- `profiles/*.yaml`
- `servers/*.yaml`
- `clients/*.yaml`
- `intents.yaml`
- `categories.yaml`
- `trust-classes.yaml`
- `candidates/*.yaml`

Compilation is:

`YAML -> validated AST -> normalized policy -> runtime outputs`

The runtime control surface consumes compiled policy. Docker is an execution and
sync backend, not the policy authority.

## Current authored policy inventory

### Bands

Checked-in bands:

- `bootstrap`
- `core-dev`
- `delivery-admin`
- `docs-research`
- `full`
- `heavy-rag`
- `runtime-admin`
- `runtime-observe`
- `security-audit`
- `voltagent-docs`

Selected band behavior:

| Band | Auto-expand | Approval | Idle timeout |
| --- | --- | --- | --- |
| `bootstrap` | no | no | none |
| `core-dev` | yes | no | 1800s |
| `docs-research` | yes | no | 1200s |
| `runtime-observe` | yes | no | 900s |
| `runtime-admin` | no | yes | 600s |
| `delivery-admin` | no | yes | 600s |
| `security-audit` | yes | no | 1200s |
| `heavy-rag` | no | no | 900s |
| `full` | no | yes | 300s |
| `voltagent-docs` | yes | no | 1200s |

### Workflows

Checked-in workflows:

- `core-dev+docs-research`
- `core-dev+runtime-observe`
- `core-dev+security-audit`
- `core-dev+voltagent-dev`
- `core-dev+voltagent-docs`

Workflow files compile into additional profile ids. They are not all checked in
under `profiles/`.

### Base profiles

Checked-in base profiles:

- `bootstrap`
- `core-dev`
- `delivery-admin`
- `docs-research`
- `full`
- `heavy-rag`
- `runtime-admin`
- `runtime-observe`
- `security-audit`

### Client overlays

Checked-in clients:

- `codex`: `env-reconnect`, suppresses `github.search` and
  `github.pull-request.read`
- `claude`: `env-reconnect`
- `antigravity`: `manual-env-reconnect`

## Current runtime layers

### 1. Control surface

`apps/mimir-control-mcp` and the matching CLI commands expose the stable
toolbox lifecycle tools:

- `list_toolboxes`
- `describe_toolbox`
- `request_toolbox_activation`
- `list_active_toolbox`
- `list_active_tools`
- `deactivate_toolbox`

This is the discovery, approval, lease, and reconnect path.

### 2. Dynamic broker

`apps/mimir-toolbox-mcp` is the same-session broker.

Current behavior:

- starts in `bootstrap`
- keeps one stable MCP connection
- advertises `tools.listChanged = true`
- recomputes visible tools from the active compiled profile
- emits `notifications/tools/list_changed`
- contracts on explicit deactivation, idle timeout, or lease expiry

### 3. Docker sync and audit layer

Docker-facing sync still exists, but it is downstream of compiled policy.

Current operator surfaces:

- `check-mcp-profiles`
- `list-toolbox-servers`
- `sync-mcp-profiles`
- `sync-toolbox-runtime`
- `sync-toolbox-client`
- `docker:mcp:audit`
- `docker:mcp:sync`

Important current behavior:

- `sync-toolbox-runtime --apply` writes the client artifact only
- `sync-toolbox-client --apply` writes the client artifact only
- `sync-mcp-profiles --apply` is the Docker mutation path

## Current server classes

The compiled policy currently produces four practical server classes:

- owned in-process: `mimir-control`, `mimir-core`
- `docker-catalog`: `brave-search`, `deepwiki-read`, `docker-docs`,
  `microsoft-learn`, `semgrep-audit`
- `descriptor-only`: `docker-admin`, `docker-read`, `dockerhub-read`,
  `github-read`, `github-write`, `grafana-observe`, `kubernetes-read`
- `local-stdio`: `voltagent-docs`

Current consequences:

- `local-stdio` peers can be materialized into Codex client config when marked
  `configTarget: codex-mcp-json`
- `docker-catalog` peers are routable in the broker only when the Docker
  gateway adapter is enabled
- `descriptor-only` peers stay visible in policy and diagnostics, but they are
  not safe Docker apply targets and are not routable in the broker

## Current toolbox choices

The current compiled toolbox ids include:

- `bootstrap`
- `core-dev`
- `core-dev+docs-research`
- `core-dev+runtime-observe`
- `core-dev+security-audit`
- `core-dev+voltagent-dev`
- `core-dev+voltagent-docs`
- `delivery-admin`
- `docs-research`
- `full`
- `heavy-rag`
- `runtime-admin`
- `runtime-observe`
- `security-audit`

The active default state is still `bootstrap`.

In the current bootstrap state:

- allowed categories are limited to `internal-memory`, `local-docs`, and
  `repo-read`
- denied categories include `deployment`, `docker-write`, `github-write`,
  `internal-memory-write`, and `repo-write`

## Current operator commands

Validate and inspect policy:

```bash
corepack pnpm cli -- check-mcp-profiles --json "{}"
corepack pnpm cli -- list-toolbox-servers --json "{}"
corepack pnpm cli -- list-toolboxes --json "{}"
```

Inspect one toolbox:

```bash
corepack pnpm cli -- describe-toolbox --json "{\"toolboxId\":\"core-dev+voltagent-docs\"}"
```

Request activation:

```bash
corepack pnpm cli -- request-toolbox-activation --json "{\"requestedToolbox\":\"docs-research\",\"taskSummary\":\"Need external docs and repo read access\"}"
```

Compile Docker sync output:

```bash
corepack pnpm cli -- sync-mcp-profiles --json "{}"
corepack pnpm docker:mcp:sync
```

Render the current Codex materialization:

```bash
corepack pnpm cli -- sync-toolbox-client --json "{\"activeProfileId\":\"core-dev+voltagent-docs\",\"clientId\":\"codex\"}"
```

For `core-dev+voltagent-docs`, the current rendered peer is:

- `voltagent-docs`
- command: `npx -y @voltagent/docs-mcp`
- output path: `.mimir/toolbox/codex.mcp.json`

## Current rollout blockers

The toolbox runtime is implemented, but broad Docker-backed rollout is still
blocked on this machine.

Current doctor-level blocker names:

- `docker_mcp_governance_drift`
- `docker_mcp_apply_blocked`

Current reasons:

- the installed Docker MCP toolkit does not expose `docker mcp profile`
- Docker gateway help does not expose `--profile`
- several selected peers are still `descriptor-only`
- live Docker-enabled servers can be broader than the repo-governed contract

`sync-mcp-profiles` already reports these blockers. The docs now match that
behavior.

Current rollout diagnostics also emit a structured remediation plan:

- keep: live servers already aligned with repo policy
- disable: live servers that are unmanaged or too broad for the governed
  toolbox surface
- replace: policy server ids that still need safe catalog entries or wrappers

The repo-level doctor surfaces these as `toolboxKeep`, `toolboxDisable`, and
`toolboxReplace` so rollout work can be taken from one report instead of
reconstructing it manually from drift details.
