# Docker Toolbox v1

This repo now treats Docker MCP toolboxes as compiled runtime state, not hand-edited configuration.

## Source of truth

The checked-in manifests under [`docker/mcp`](/F:/Dev/scripts/Mimir/mimir/docker/mcp) define:

- capability categories
- trust classes
- intent policy objects
- server descriptors
- profile composition
- client overlays
- client handoff strategy metadata

The compiler pipeline is:

`YAML -> validated AST -> normalized IR -> runtime outputs`

No runtime surface should read raw YAML directly after compilation.

## Runtime model

V1 uses profile-bound sessions only.

1. Start in `bootstrap`
2. Discover toolboxes through `mimir-control`
3. Request toolbox activation
4. Receive a reconnect or fork handoff
5. Reconnect into the approved profile
6. Keep `mimir-control` visible and use `list_active_tools` to inspect the active surface, declared profile tools, and any overlay-suppressed tools

Mimir stays the primary semantic/internal MCP surface we own, but it is not the transport path to peer servers.

Client stance in v1:

- Codex and Claude are first-class overlay targets
- Antigravity stays contract-compatible, but operationally thinner and reconnect-driven

## Repo layout

- [`docker/mcp/categories.yaml`](/F:/Dev/scripts/Mimir/mimir/docker/mcp/categories.yaml)
- [`docker/mcp/trust-classes.yaml`](/F:/Dev/scripts/Mimir/mimir/docker/mcp/trust-classes.yaml)
- [`docker/mcp/intents.yaml`](/F:/Dev/scripts/Mimir/mimir/docker/mcp/intents.yaml)
- [`docker/mcp/servers`](/F:/Dev/scripts/Mimir/mimir/docker/mcp/servers)
- [`docker/mcp/profiles`](/F:/Dev/scripts/Mimir/mimir/docker/mcp/profiles)
- [`docker/mcp/clients`](/F:/Dev/scripts/Mimir/mimir/docker/mcp/clients)

Client manifests may now declare:

- `handoffStrategy`
- `handoffPresetRef`

These fields are advisory runtime metadata owned by the repo policy layer. They
do not execute reconnects themselves. They tell `mimir-control` how to describe
the next-session handoff for each client.

## Operator commands

Validate the checked-in manifests:

```bash
pnpm cli check-mcp-profiles --json "{}"
```

List toolboxes from the compiled policy:

```bash
pnpm cli list-toolboxes --json "{}"
```

Describe one toolbox:

```bash
pnpm cli describe-toolbox --json "{\"toolboxId\":\"docs-research\"}"
```

Request activation and emit a lease when configured:

```bash
pnpm cli request-toolbox-activation --json "{\"requestedToolbox\":\"docs-research\",\"taskSummary\":\"Need external docs and repo read access\"}"
```

Activation returns a structured `handoff` object. For reconnect-driven clients,
map that handoff into the next session instead of improvising local state:

- set `MAB_TOOLBOX_ACTIVE_PROFILE` to the approved profile
- set `MAB_TOOLBOX_CLIENT_ID` to the approved client
- set `MAB_TOOLBOX_SESSION_MODE` to the target session mode
- when `lease.issued` is true, copy `leaseToken` into
  `MAB_TOOLBOX_SESSION_POLICY_TOKEN`
- on denial or deactivation, clear `MAB_TOOLBOX_SESSION_POLICY_TOKEN` and
  reconnect into the returned bootstrap downgrade target

The handoff now also includes client metadata:

- `client.id`
- `client.displayName`
- `client.handoffStrategy`
- `client.handoffPresetRef`

V1 meaning:

- `env-reconnect`: restart the client with the returned environment mapping
- `manual-env-reconnect`: the same env mapping applies, but the operator flow is
  intentionally more manual

Generate the Docker MCP runtime plan from compiled policy:

```bash
pnpm docker:mcp:sync
pnpm docker:mcp:sync:json
```

`sync-mcp-profiles` emits Docker apply metadata for each server:

- `catalog` peers can be emitted as Docker MCP catalog references and may use a
  different live catalog id than the repo policy id, for example
  `brave-search` maps to Docker catalog server `brave`
- `descriptor-only` peers describe a governed toolbox surface but are not safe
  raw Docker catalog targets yet

Dry-run still succeeds when descriptor-only peers are present. Live apply is
blocked before shelling out profile mutation commands if any selected profile
contains descriptor-only peers. This prevents read-filtered policy surfaces such
as `dockerhub-read` from being replaced by broader raw catalog servers.

When the local toolkit does not expose `docker mcp profile`, the compiled apply
plan also emits deterministic diagnostic fallback commands:
`docker mcp gateway run --servers <catalog-server-ids>`. These fallback entries
include only catalog-mode peer servers and explicitly list omitted owned servers
and descriptor-only peers. They are for operator diagnostics and handoff
planning, not complete profile sessions.

Run the control MCP server directly:

```bash
pnpm mcp:control
```

## Current profile set

- `bootstrap`
- `core-dev`
- `docs-research`
- `core-dev+docs-research`
- `runtime-observe`
- `core-dev+runtime-observe`
- `runtime-admin`
- `heavy-rag`
- `security-audit`
- `core-dev+security-audit`
- `delivery-admin`
- `full`

Composite profiles are only allowed for repeated workflows with explicit fixtures and tests.

## Kubernetes read-only peer band

`runtime-observe`, `core-dev+runtime-observe` (inherits from `runtime-observe`), `runtime-admin`, and `full` include the `kubernetes-read` peer server.

Allowed categories for these profiles include `k8s-read`, `k8s-logs-read`, and `k8s-events-read`.

v1 is **read-only** for Kubernetes. No Kubernetes mutation, deployment, or admin tool is exposed by any v1 profile. Future approval-gated Kubernetes mutation is tracked in the backlog but is not part of the current implementation.

## DockerHub read-only peer band

`docs-research`, `core-dev+docs-research` (inherits from `docs-research`), and `full` include the `dockerhub-read` peer server.

Allowed categories for these profiles include `container-registry-read`.

The current DockerHub tool ids are:

- `dockerhub.image.search`
- `dockerhub.image.tags.list`
- `dockerhub.image.inspect`

All three are `mutationLevel: read`. This band is for image discovery and metadata inspection only; it does not pull, push, publish, sign, delete, or deploy images.

DockerHub apply caveat: the live Docker catalog server is named `dockerhub` and
also exposes repository creation and metadata update tools. The curated
`dockerhub-read` toolbox server is therefore `descriptor-only` until a
read-filtered wrapper or catalog entry exists.

## DeepWiki read-only repo knowledge band

`docs-research`, `core-dev+docs-research` (inherits from `docs-research`), and `full` include the `deepwiki-read` peer server.

Allowed categories for these profiles include `repo-knowledge-read`.

The current DeepWiki tool ids are:

- `read_wiki_structure`
- `read_wiki_contents`
- `ask_question`

All three are `mutationLevel: read`. This band is for generated GitHub repository documentation and repository Q&A only; it does not write GitHub state or mutate local files.

DeepWiki apply note: the live Docker catalog server is named `deepwiki`, so the
repo policy id `deepwiki-read` maps to catalog server `deepwiki`.

## Semgrep read-only security audit band

`security-audit`, `core-dev+security-audit` (inherits from `security-audit`), and `full` include the `semgrep-audit` peer server.

Allowed categories for these profiles include `security-scan-read`.

The current Semgrep tool ids are:

- `semgrep.rule.schema`
- `semgrep.languages.list`
- `semgrep.findings.list`
- `semgrep.scan.content`
- `semgrep.scan.custom_rule`
- `semgrep.scan.local`
- `semgrep.security.check`
- `semgrep.ast.get`

All Semgrep tools are `mutationLevel: read`. This band is for static analysis, existing finding lookup, and security review support only. It does not publish findings, change repository files, or deploy workloads.

Semgrep apply note: the live Docker catalog server is named `semgrep`, so the
repo policy id `semgrep-audit` maps to catalog server `semgrep`.

## Enforcement notes

- overlays may suppress or reduce capabilities
- overlays may not widen trust class or mutation level
- `legacy-direct`, `toolbox-bootstrap`, and `toolbox-activated` remain explicit session modes
- scoped requests require a revision-bound, audience-bound session lease
- deactivation with an expired lease now emits an explicit `toolbox_expired` audit event before the normal deactivation event
- `fallbackProfile` is only for denied requests, reconnect-after-expiry, or operator-guided downgrade
- activation, denial, and deactivation now return structured reconnect handoff data instead of only an implicit reconnect flag

## Expansion rule

Future additions should usually be:

1. manifest additions
2. compiler or control-surface tests
3. peer curation updates

New policy code should only appear when a new trust boundary or enforcement semantic is genuinely introduced.
