# Toolbox Operator Guide

This guide describes the current operator workflow for adding MCP servers,
creating toolbox targets, and understanding how agents see tools at runtime.

It describes the tracked repo as it exists today.

## The mental model

The toolbox is organized around four layers:

1. **server**: one MCP source and its declared tools
2. **band**: one narrow capability slice such as `docs-research`
3. **workflow**: one approved multi-band composition for a repeated task
4. **profile**: a compiled compatibility output used by the control surface,
   broker, and client materialization

Important rule:

- operators usually add or edit **servers**, **bands**, and **workflows**
- operators do **not** usually hand-author compiled profile behavior directly

If you want to expose a new MCP, the normal path is:

1. declare the server
2. attach it to a band or workflow
3. rebuild toolbox runtime outputs
4. let the broker expose it only when that band or workflow is active

## Runtime binding choices

When adding a new MCP, choose the runtime binding first.

### `local-stdio`

Use this first unless you have a strong reason not to.

Best for:

- your own MCPs
- downloaded MCPs that run through `node`, `npx`, `python`, or another local
  command
- tools that are not already part of the Docker MCP catalog

Current example:

- [voltagent-docs.yaml](F:/Dev/scripts/Mimir/mimir/docker/mcp/servers/voltagent-docs.yaml)

Why this is the preferred default:

- easiest to add
- does not depend on Docker profile support
- already supported by the broker runtime

### `docker-catalog`

Use this when the server already exists as a safe Docker MCP catalog target.

Current example:

- [brave-search.yaml](F:/Dev/scripts/Mimir/mimir/docker/mcp/servers/brave-search.yaml)

Best for:

- stable catalog-backed peers
- servers where Docker isolation is useful
- runtimes that are already shaped to work with the Docker gateway adapter

### `descriptor-only`

Use this when the policy should know about a server, but it is not safe to
apply or route directly yet.

Current example:

- [github-read.yaml](F:/Dev/scripts/Mimir/mimir/docker/mcp/servers/github-read.yaml)

Best for:

- unsafe upstream catalog servers that need a read-only wrapper
- catalog entries that are too broad
- future candidates you want visible in policy and diagnostics before they are
  live-routable

## Add a new MCP server

### Option 1: easiest current path

Use a `local-stdio` server manifest.

Create a file under:

- [docker/mcp/servers](F:/Dev/scripts/Mimir/mimir/docker/mcp/servers)

Minimum shape:

```yaml
server:
  id: my-docs
  displayName: My Docs
  source: peer
  kind: peer
  trustClass: external-read
  mutationLevel: read
  runtimeBinding:
    kind: local-stdio
    command: npx
    args:
      - -y
      - "@example/my-docs-mcp"
  tools:
    - toolId: my.docs.search
      displayName: Search My Docs
      category: docs-search
      trustClass: external-read
      mutationLevel: read
      semanticCapabilityId: docs.search.my-docs
```

Use existing manifests as style references:

- [voltagent-docs.yaml](F:/Dev/scripts/Mimir/mimir/docker/mcp/servers/voltagent-docs.yaml)
- [microsoft-learn.yaml](F:/Dev/scripts/Mimir/mimir/docker/mcp/servers/microsoft-learn.yaml)

### Option 2: Docker-backed peer

If the MCP exists as a safe catalog server, use:

```yaml
server:
  id: my-search
  displayName: My Search
  source: peer
  kind: peer
  trustClass: external-read
  mutationLevel: read
  dockerRuntime:
    applyMode: catalog
    catalogServerId: my-search
  tools:
    - toolId: my.search.query
      displayName: My Search Query
      category: web-search
      trustClass: external-read
      mutationLevel: read
      semanticCapabilityId: web.search.my-search
```

### What the server manifest needs

At minimum:

- `id`
- `displayName`
- `source`
- `kind`
- `trustClass`
- `mutationLevel`
- one runtime binding (`runtimeBinding` or `dockerRuntime`)
- declared `tools[]`
- stable `category`
- stable `semanticCapabilityId`

Those fields are what make the toolbox able to classify, suppress, and expose
the MCP correctly.

## Add the MCP to a toolbox target

This is the part that controls visibility.

You normally do one of these:

- add the server to an existing **band**
- create a new **band**
- create a new **workflow** that composes existing bands

### Add a server to an existing band

Edit the band file under:

- [docker/mcp/bands](F:/Dev/scripts/Mimir/mimir/docker/mcp/bands)

Add the server id to `includeServers`.

This is the usual path when the new MCP belongs inside an existing narrow
capability slice such as:

- `docs-research`
- `runtime-observe`
- `security-audit`

### Create a new band

Use the guided authoring flow:

```bash
corepack pnpm cli -- scaffold-toolbox --wizard
```

Choose the toolbox/band path and provide:

- band id
- display name
- server ids
- trust/mutation behavior
- approval and auto-expand flags

This creates a new reusable capability slice.

### Create a repeated workflow

Use the same command:

```bash
corepack pnpm cli -- scaffold-toolbox --wizard
```

Choose the workflow path and provide:

- workflow id
- display name
- included bands
- summary/example tasks

This is the right choice when you want a repeated approved combination like:

- `core-dev+docs-research`
- `core-dev+runtime-observe`

## Add a new profile

In the current toolbox model, you usually do **not** create a profile first.

Instead:

- create a **band** if you need one reusable capability slice
- create a **workflow** if you need an approved multi-band composition

The compiler then produces the profile id used by:

- `mimir-control`
- `mimir-toolbox-mcp`
- client materialization
- Docker runtime planning

So the practical rule is:

- **new band** => new base toolbox target
- **new workflow** => new compiled composite profile

## Inspect before applying

Useful inspection commands:

```bash
corepack pnpm cli -- list-toolbox-servers --json "{}"
corepack pnpm cli -- list-toolboxes --json "{}"
corepack pnpm cli -- describe-toolbox --json "{\"toolboxId\":\"docs-research\"}"
```

For authoring preview:

```bash
corepack pnpm cli -- preview-toolbox --input <payload.json>
```

For broader rebuild:

```bash
corepack pnpm cli -- sync-toolbox-runtime --json "{}"
```

Current behavior:

- `sync-toolbox-runtime --apply` writes client artifacts only
- `sync-mcp-profiles --apply` is the Docker mutation path
- current Docker MCP profile listing can be audited, but Docker apply still
  stays blocked when descriptor-only peers are selected

## How agents interact with tools

Agents should not start by seeing every raw MCP tool.

Current runtime behavior is:

1. agent starts in `bootstrap`
2. agent sees the toolbox control surface
3. agent asks what toolboxes exist
4. agent requests activation based on task need
5. broker exposes only the active tool surface
6. tools expand or contract as session state changes

### What is visible at first

The current default is `bootstrap`.

That means the agent starts narrow and sees:

- `mimir-control` tools such as:
  - `list_toolboxes`
  - `describe_toolbox`
  - `request_toolbox_activation`
  - `list_active_toolbox`
  - `list_active_tools`
  - `deactivate_toolbox`
- safe `mimir-core` read-style tools

### How the agent asks for more

The normal control flow is:

1. `list_toolboxes`
2. `describe_toolbox`
3. `request_toolbox_activation`
4. `list_active_tools`

The request should be task-driven, not vendor-driven.

Good:

- “need docs search and repo read”
- “need runtime observation only”

Bad:

- “activate Grafana”
- “show me every tool”

### How the broker chooses

Current selection rules:

- task need is primary
- role is only a tie-breaker
- the narrowest safe satisfying target should win
- denied categories and mutation ceilings must still hold

### How tools appear

The broker:

- keeps one stable MCP session
- changes the visible tool surface
- emits `tools/list_changed`
- can contract back down on idle timeout or lease expiry

The important operator effect is:

- the tool exists in policy all the time
- the agent sees it only when the active band or workflow allows it

## Recommended default operating rule

When adding future MCPs:

- prefer `local-stdio` first
- keep `bootstrap` small
- put new tools into the narrowest sensible band
- use a workflow only for repeated real combinations
- keep unsafe upstream servers as `descriptor-only` until they have a safe
  wrapper or catalog entry
- treat `docker-read`, `dockerhub-read`, `grafana-observe`, and
  `kubernetes-read` as wrapper-required, `github-read` as catalog-entry-required,
  and `docker-admin`/`github-write` as vetting-required before Docker apply

## Recommended release-safe workflow

For day-to-day use:

1. add or edit a server manifest
2. attach it to a band or workflow
3. preview and sync
4. inspect toolbox shape
5. let the agent activate that toolbox when needed

That gives you the behavior you asked for:

- all useful MCPs can live in the platform
- agents do not carry all of them in mind at once
- the active surface expands only when the task justifies it
