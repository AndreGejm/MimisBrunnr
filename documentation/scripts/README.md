# scripts

This directory contains narrow operator and launcher helpers. These scripts are tracked release surfaces, but they are intentionally scoped: use the root `package.json` scripts for normal install, build, and test workflows.

## Current tracked helpers

- `launch-mimir-cli.mjs`: stable Node wrapper for the built mimir CLI entrypoint.
- `launch-mimir-mcp.mjs`: stable Node wrapper for the built mimir MCP entrypoint.
- `install-mimir-launchers.mjs`: installs the canonical `mimir` launcher plus backwards-compatible aliases such as `brain-cli`, `multiagentbrain`, and `mimirsbrunnr`.
- `install-default-codex-mcp.mjs`: writes the default Codex MCP server configuration for `mimir`.
- `install-default-access.mjs`: installs both launcher and Codex MCP access using the shared default-access helper.
- `doctor-default-access.mjs`: diagnoses wrapper paths, built entrypoints, Codex MCP config, launcher files, PATH state, and the local install manifest.
- `docker/audit-toolbox-assets.mjs`: machine-readable audit for the tracked `docker/mcp` toolbox manifests and compiled Docker runtime plan.
- `docker/sync-mcp-profiles.mjs`: deterministic compiler-to-runtime-plan bridge for Docker MCP profiles.
- `installers/windows/cli.ps1`: experimental headless Windows installer backend contract for `detect-environment`, `audit-install-surface`, `prepare-repo-workspace`, `audit-toolbox-assets`, `prepare-toolbox-runtime`, `audit-docker-mcp-toolkit`, `plan-docker-mcp-toolkit-apply`, `plan-client-access`, `apply-client-access`, and `show-state`.
- `installers/windows/installer.ps1`: thin wrapper over `installers/windows/cli.ps1` reserved for later GUI work.
- `review-note-gui.py`: local GUI helper for reviewing staged notes.
- `run-mimir-maintenance.mjs`: governed maintenance wrapper that inspects the review queue and freshness status, and can create refresh drafts through mimir without editing memory files directly.

## What these scripts are not

- They are not a replacement for `corepack pnpm install`, `corepack pnpm build`, or `corepack pnpm test`.
- They are not a migration system for SQLite state.
- They are not allowed to bypass governed mimisbrunnr staging, validation, review, or promotion rules.

## Evidence status

### Verified facts

- This statement is based on the tracked contents of `scripts/`.
- Launcher aliases are centralized through `scripts/lib/default-access.mjs`.
- The Windows installer backend currently wraps `scripts/doctor-default-access.mjs` through `scripts/installers/windows/lib/adapters/default-access.ps1`.
- The Windows installer backend now has separate modules for environment detection, repo bootstrap, toolbox asset audit, toolbox runtime preparation, Docker MCP Toolkit audit, write-target planning, apply orchestration, and client definition resolution.
- The Windows installer backend now also includes a Docker Toolkit apply-plan boundary that compares compiled runtime commands with the live Toolkit capability surface without mutating Docker.

### Assumptions

- None

### TODO gaps

- Expand this file when the Windows installer grows beyond the current headless backend and adds guided bootstrap or GUI flows.
