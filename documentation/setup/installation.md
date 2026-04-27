# Installation

This repository is a pnpm workspace. The repo-supported setup path is still:

1. install workspace dependencies
2. build the workspace
3. opt into only the extra access or runtime layers you actually need

This file covers the current repo state. For environment variables, see
[`configuration.md`](./configuration.md). For the Windows-only access installer,
see [`windows-installer.md`](./windows-installer.md).

## Prerequisites

Required:

- Node `>=22.0.0`
- `pnpm@10.7.0` through Corepack

Optional, depending on what you need to run:

- Python 3 for the vendored coding runtime tests and the coding-domain bridge
- Docker for `docker/compose.local.yml`
- Docker MCP Toolkit if you are working on toolbox runtime planning or client handoff
- Qdrant if you want vector retrieval available instead of degraded-mode fallback

## Canonical repo setup

```bash
corepack enable
corepack pnpm install
corepack pnpm build
```

That gives you the built workspace entrypoints and the root scripts declared in
[`package.json`](../../package.json). The normal repo-local run forms are:

```bash
corepack pnpm cli -- version
corepack pnpm api
corepack pnpm mcp
corepack pnpm mcp:control
```

The repo build path is the primary setup path on every platform. The Windows
installer is an additional Windows-only access and audit surface; it is not the
only supported way to get the repo working.

## Optional access setup

Nothing in the base install writes global launchers or client MCP config.

If you want machine-level convenience access after the repo builds, use one of
these paths:

- `node scripts/install-mimir-launchers.mjs`
- `node scripts/install-default-codex-mcp.mjs`
- `node scripts/install-default-access.mjs`
- the Windows-only `apply-client-access` backend described in
  [`windows-installer.md`](./windows-installer.md)

Current access behavior to keep straight:

- the convenience CLI launcher is `mimir`
- the installer also writes backwards-compatible CLI aliases such as `mimis`,
  `brain`, and `multiagentbrain`
- Codex MCP access points at the built MCP wrapper under
  `scripts/launch-mimir-mcp.mjs`
- there is no separate tracked global `mimir-mcp` launcher contract in this repo

## Optional Windows installer path

The Windows installer backend under `scripts/installers/windows/` is useful
when you want:

- environment detection
- repo preparation on a clean checkout
- client-access planning or apply
- toolbox audit and rollout-readiness reports

It is still a headless backend. It does not clone the repo, repair a dirty
worktree, or provide a GUI flow. Docker/toolbox apply also remains optional and
may still be blocked by the local Docker MCP Toolkit contract or by
descriptor-only peer policies. See [`windows-installer.md`](./windows-installer.md)
and [`../operations/docker-toolbox-v1.md`](../operations/docker-toolbox-v1.md).

## Optional runtime profiles

### Repo-local development profile

The Node apps read `process.env` directly. They do not auto-load `.env` files.

If you want repo-local state instead of the home-global defaults, set the
storage paths explicitly before starting the app. The current defaults otherwise
land under `%USERPROFILE%\\.mimir` on Windows or `$HOME/.mimir` elsewhere when
`MAB_DATA_ROOT` and the explicit storage-path variables are unset.

The verified source of truth for runtime defaults is
`packages/infrastructure/src/config/env.ts`, not this file.

### Docker runtime profile

The tracked container profile is:

```bash
corepack pnpm docker:up
```

That profile builds the repo image, starts the HTTP adapter, starts Qdrant, and
points the model-facing roles at the configured Docker/Ollama-compatible stack.
It is an optional runtime profile, not a prerequisite for local development.

## Verification

Common verification commands:

```bash
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test:transport
corepack pnpm test
```

If you change the vendored coding runtime, also run:

```bash
python -m pytest runtimes/local_experts/tests/test_safety_gate.py -v
```

## What the base install does not do

- it does not auto-load `.env`
- it does not write global launchers unless you run an access installer
- it does not write Codex MCP config unless you run an access installer
- it does not clone or update the repo for you
- it does not apply Docker MCP profiles for you
- it does not provide a cross-platform one-shot bootstrap script
- it does not ship a tracked Python lockfile or Python packaging manifest for
  the vendored runtime

## Canonical docs

- [`configuration.md`](./configuration.md)
- [`development-workflow.md`](./development-workflow.md)
- [`../apps/mimir-cli.md`](../apps/mimir-cli.md)
- [`../reference/interfaces.md`](../reference/interfaces.md)
- [`../operations/docker-toolbox-v1.md`](../operations/docker-toolbox-v1.md)
