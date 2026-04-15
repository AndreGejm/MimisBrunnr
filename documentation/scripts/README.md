# scripts

This directory contains narrow operator and launcher helpers. These scripts are tracked release surfaces, but they are intentionally scoped: use the root `package.json` scripts for normal install, build, and test workflows.

## Current tracked helpers

- `launch-mimir-cli.mjs`: stable Node wrapper for the built mimir CLI entrypoint.
- `launch-mimir-mcp.mjs`: stable Node wrapper for the built mimir MCP entrypoint.
- `install-mimir-launchers.mjs`: installs the canonical `mimir` launcher plus backwards-compatible aliases such as `brain-cli`, `multiagentbrain`, and `mimirsbrunnr`.
- `install-default-codex-mcp.mjs`: writes the default Codex MCP server configuration for `mimir`.
- `install-default-access.mjs`: installs both launcher and Codex MCP access using the shared default-access helper.
- `doctor-default-access.mjs`: diagnoses wrapper paths, built entrypoints, Codex MCP config, launcher files, PATH state, and the local install manifest.
- `review-note-gui.py`: local GUI helper for reviewing staged notes.
- `run-mimisbrunnr-cleanup.ps1`: governed cleanup wrapper that calls mimir surfaces instead of editing memory files directly.

## What these scripts are not

- They are not a replacement for `corepack pnpm install`, `corepack pnpm build`, or `corepack pnpm test`.
- They are not a migration system for SQLite state.
- They are not allowed to bypass governed mimisbrunnr staging, validation, review, or promotion rules.

## Evidence status

### Verified facts

- This statement is based on the tracked contents of `scripts/`.
- Launcher aliases are centralized through `scripts/lib/default-access.mjs`.

### Assumptions

- None

### TODO gaps

- If release packaging adds a true installer or migration script, document its inputs, mutation surface, and rollback behavior here.