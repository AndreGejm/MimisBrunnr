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

`runtime-observe`, `core-dev+runtime-observe`, `runtime-admin`, and `full`
include the `kubernetes-read` peer band. V1 keeps that band read-only: cluster
inspection, namespace/workload listing, event reads, and log queries are
available, but no Kubernetes mutation or deploy tool is exposed.

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
- `clientPresetRef` (runtime alias emitted alongside `handoffPresetRef`)

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

This list now includes the predefined composite toolboxes, including
`core-dev+docs-research` and `core-dev+runtime-observe`, because they are
policy-backed activation targets rather than compile-only profiles.
```

Describe one toolbox:

```bash
pnpm cli describe-toolbox --json "{\"toolboxId\":\"docs-research\"}"
```

`describe-toolbox` now returns structured discovery metadata beyond the flat
intent record:

- `toolbox.summary`
- `toolbox.exampleTasks`
- `toolbox.workflow` with activation mode, session mode, approval requirement,
  and fallback profile
- `toolbox.trustClass`
- `toolbox.profile` with composition details such as `composite`,
  `baseProfiles`, `compositeReason`, and `profileRevision`
- overlay-filtered `toolbox.tools` for the current client

`list-toolboxes` now returns the same manifest-backed intent summaries so an
agent can pick a toolbox by purpose before it sees raw tool descriptors.

`describe-toolbox` now mirrors the active-session suppression diagnostics for
discovery. Alongside the overlay-filtered `toolbox.tools` list, it returns
`toolbox.suppressedTools` with the hidden descriptor ids, semantic
capabilities, suppression reasons, and the `client-overlay-reduction` boundary.
It also returns `toolbox.antiUseCases`, which currently pins denied-category
boundaries as machine-readable entries such as
`{ type: "denied_category", category: "docker-write" }`.
Discovery diagnostics and audit records also carry both `manifestRevision` and
`profileRevision`, so the reported toolbox metadata is tied to the exact
compiled profile revision in play.

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
  reconnect into the returned `downgradeTarget`

Approved activation responses now also surface:

- `downgradeTarget` as a top-level reconnect fallback
- `leaseExpiresAt` as the client-visible lease expiry timestamp
- `handoff.downgradeTarget` for the same reconnect target inside the handoff
- `handoff.handoffStrategy`, `handoff.handoffPresetRef`, and
  `handoff.clientPresetRef` as flattened client reconnect metadata
- `handoff.lease.expiresAt` when a lease was actually issued

When activation is requested through `requiredCategories` instead of an explicit
toolbox name, the resolver now picks the narrowest non-escalating matching
toolbox rather than the first broad match in manifest order.

Toolboxes whose manifest sets `requiresApproval: true`, including
`runtime-admin`, `delivery-admin`, and `full`, currently deny activation until
an explicit approval path exists. Those denials still return a structured
fallback handoff so the client can reconnect into the lower-risk target
profile.

That approval path now exists as an explicit activation input. For example:

```json
{
  "requestedToolbox": "runtime-admin",
  "taskSummary": "Need to restart a container",
  "approval": {
    "grantedBy": "operator",
    "grantedAt": "2026-04-19T22:30:00.000Z",
    "reason": "Approved runtime intervention"
  }
}
```

When a `requiresApproval` toolbox is activated with this input, the response
includes the approval metadata in `details.approval` and diagnostics/audit
records. Those diagnostics and audit events now include both the manifest and
profile revisions involved in the approval or denial path, and
`details.approval.trustClass` makes the approved trust boundary explicit to the
client.

The handoff now also includes client metadata:

- `handoff.handoffStrategy`
- `handoff.handoffPresetRef`
- `handoff.clientPresetRef`
- `client.id`
- `client.displayName`
- `client.handoffStrategy`
- `client.handoffPresetRef`
- `client.clientPresetRef`

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
- descriptor-only peers may also declare `unsafeCatalogServerIds`, the live raw
  catalog server names that correspond to curated descriptor-only wrappers

Dry-run still succeeds when descriptor-only peers are present. Live apply is
blocked before shelling out profile mutation commands if any selected profile
contains descriptor-only peers. This prevents read-filtered policy surfaces such
as `dockerhub-read` and `grafana-observe` from being replaced by broader raw
catalog servers.

The Windows installer Docker MCP audit compiles the checked-in toolbox policy
beside the live Docker state and adds governance drift diagnostics:

- `governedEnabledServers`: live enabled servers owned by repo policy or mapped
  through catalog-mode `catalogServerId`
- `unsafeEnabledServers`: live enabled raw catalog servers that match a
  descriptor-only wrapper's `unsafeCatalogServerIds`
- `unmanagedEnabledServers`: live enabled servers that match neither governed
  nor unsafe policy metadata
- `governanceStatus`: `clean`, `drift_detected`, or `unavailable`

If policy preparation fails, Docker state is still reported and governance is
marked `unavailable` with an explanation.

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

Inspect the current active toolbox session:

```bash
pnpm cli list-active-toolbox --json "{}"
```

`list-active-toolbox` now reports:

- active workflow state, including toolbox id when one maps cleanly to the
  current profile, activation mode, approval requirement, and fallback profile
- active profile fallback, category bounds, semantic capabilities, and profile revision
- current client handoff metadata
- active client overlay suppression lists, including suppressed semantic capabilities
  and machine-readable `suppressedTools` entries with tool id, semantic capability,
  suppression reasons, and the `client-overlay-reduction` boundary marker

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

## Grafana observe read-only peer band

`runtime-observe`, `core-dev+runtime-observe` (inherits from `runtime-observe`), `runtime-admin`, and `full` include the `grafana-observe` peer server.

Allowed categories for these profiles include `logs-read`, `metrics-read`, and `traces-read`.

The current Grafana observe tool ids are:

- `grafana.logs.query`
- `grafana.metrics.query`
- `grafana.traces.query`

All three are `mutationLevel: read`.

Grafana apply caveat: the live Docker catalog server is named `grafana` and currently includes mutating/destructive tools (for example `alerting_manage_rules`, `update_dashboard`, and `create_*`). The curated `grafana-observe` toolbox server is therefore `descriptor-only` until a read-filtered wrapper or catalog entry exists.

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
