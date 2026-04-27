# mimir 1.0.1 Release Candidate

> **Status note (2026-04-27):** This release-candidate note is historical. The
> repo has moved beyond this checkpoint and now includes the toolbox control
> plane, the dynamic toolbox broker, guided toolbox authoring, and the newer
> installer/toolbox rollout docs. Use
> [`../planning/current-implementation.md`](../planning/current-implementation.md)
> for live behavior and [`../planning/backlog.md`](../planning/backlog.md) for
> remaining work. Treat the present-tense statements below as scoped to the
> `v1.0.1` release-candidate checkpoint, not as the live runtime inventory.

Target tag: `v1.0.1`

## Summary

This release candidate prepared mimir for installer packaging with
RTK, Superpowers, Aider, Docker Desktop, Docker Model Runner, and the local
agent runtime. It kept mimisbrunnr's governed memory model intact while
adding practical local-agent ergonomics inspired by Hermes.

## What Changed

- Local agents gained fenced memory context through
  `assemble-agent-context`.
- Coding tasks gained bounded memory context without gaining direct memory
  write authority.
- Docker AI tool registry surfaces exposed read-only manifest discovery,
  validation, and package-plan output through CLI, HTTP, and MCP.
- Session archives became searchable as non-authoritative recall.
- Local-agent traces were persisted and inspectable by operator/system actors.
- Oversized tool outputs spilled to storage and stayed available through
  `show-tool-output`.
- The thin staging-review workflow gained CLI, HTTP, and MCP parity through
  `list-review-queue`, `read-review-note`, `accept-note`, and `reject-note`,
  plus `/v1/review/*` routes and matching MCP tools.
- Provider errors were classified into actionable categories.
- `qwen3-coder` was represented as an explicit deterministic local coding lane.
- Retrieval eval fixtures provided a small regression harness for recall quality.
- Installer-facing docs no longer depended on local workstation paths.

## Verification

The pre-tag verification lane for this candidate was:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm test:eval:retrieval
corepack pnpm docker:mcp:build
```

Expected test state at that checkpoint:

- e2e suite passes.
- retrieval eval reports all fixtures passed.
- `node:sqlite` may emit an experimental warning; that is expected.

## Installer Defaults At This Checkpoint

Host state defaults under:

- Windows: `%USERPROFILE%\.mimir`
- non-Windows: `$HOME/.mimir`

Override with `MAB_DATA_ROOT`, or override each path directly with:

- `MAB_VAULT_ROOT`
- `MAB_STAGING_ROOT`
- `MAB_SQLITE_PATH`

Docker MCP session mounts should use explicit host paths and must not rely on
developer workstation paths.

## Known Release Gate At This Checkpoint

No project license has been selected in this branch. Do not publish a public
installer until the repository owner chooses and adds a license.
