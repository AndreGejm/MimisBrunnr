# scripts

This directory contains scoped operator and support helpers. These scripts are
tracked release surfaces, but they are not a replacement for the root workspace
scripts in `package.json`.

Use this file as an inventory of what the tracked helpers do today. For normal
setup and contributor workflow, start with:

- [`../setup/installation.md`](../setup/installation.md)
- [`../setup/development-workflow.md`](../setup/development-workflow.md)

## Access and launcher helpers

- `launch-mimir-cli.mjs`: stable Node wrapper for the built CLI entrypoint
- `launch-mimir-mcp.mjs`: stable Node wrapper for the built MCP entrypoint used
  by client config
- `install-mimir-launchers.mjs`: installs the `mimir` launcher plus the
  backwards-compatible CLI aliases declared by `scripts/lib/default-access.mjs`
- `install-default-codex-mcp.mjs`: writes the default Codex MCP config for
  server name `mimir`
- `install-default-access.mjs`: installs both launcher access and Codex MCP access
- `doctor-default-access.mjs`: audits wrapper paths, built entrypoints, launchers,
  PATH state, Codex MCP config, install manifest, Docker tool assets, Docker
  MCP support probes, and toolbox rollout-readiness diagnostics
- `lib/default-access.mjs`: shared reporting and install metadata layer used by
  the doctor, access installers, and Windows installer backend

Current access caveat:

- the tracked install surface configures MCP clients against
  `scripts/launch-mimir-mcp.mjs`
- it does not establish a separate `mimir-mcp` global launcher contract

## Docker and toolbox helpers

- `docker/audit-toolbox-assets.mjs`: audits the checked-in `docker/mcp` policy
  and compiled runtime plan
- `docker/sync-mcp-profiles.mjs`: compiles the deterministic Docker runtime
  plan and optional Docker apply commands
- `report-command-surface.mjs`: generates the repo command-surface report used
  by the matching root scripts
- `run-mimir-maintenance.mjs`: governed maintenance wrapper around review queue,
  freshness, and refresh-draft flows

Important boundary:

- toolbox authoring and control commands such as `scaffold-toolbox`,
  `preview-toolbox`, `sync-toolbox-runtime`, and `list-toolboxes` are CLI
  surfaces exposed through `mimir-cli`, not standalone `scripts/` entrypoints

## Windows installer backend

- `installers/windows/cli.ps1`: headless Windows backend for environment
  detection, repo preparation, access planning/apply, toolbox audits, Docker
  MCP Toolkit inspection, rollout-readiness reporting, and persisted installer state
- `installers/windows/installer.ps1`: thin wrapper over `cli.ps1`

The Windows backend is contract-driven and read-heavy. Docker/toolbox apply is
still a separate concern and may remain blocked on the local Docker Toolkit or
descriptor-only peer policies.

## Review and local utilities

- `review-note-gui.py`: local GUI helper for reviewing staged notes

## What these scripts are not

- they are not a replacement for `corepack pnpm install`, `corepack pnpm build`,
  `corepack pnpm typecheck`, or `corepack pnpm test`
- they are not a tracked database migration system
- they are not a bypass around governed mimisbrunnr staging, review, or promotion
- they are not a one-shot cross-platform bootstrap system

## Canonical docs

- [`../setup/installation.md`](../setup/installation.md)
- [`../setup/windows-installer.md`](../setup/windows-installer.md)
- [`../operations/docker-toolbox-v1.md`](../operations/docker-toolbox-v1.md)
- [`../reference/interfaces.md`](../reference/interfaces.md)
