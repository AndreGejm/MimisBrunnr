# MultiagentBrain 1.0.1 Release Candidate

Target tag: `v1.0.1`

## Summary

This release candidate prepares MultiagentBrain for installer packaging with
RTK, Superpowers, Aider, Docker Desktop, Docker Model Runner, and the local
agent runtime. It keeps MultiagentBrain's governed memory model intact while
adding practical local-agent ergonomics inspired by Hermes.

## What Changed

- Local agents can request fenced memory context through
  `assemble-agent-context`.
- Coding tasks can receive bounded memory context without gaining direct memory
  write authority.
- Session archives are searchable as non-authoritative recall.
- Local-agent traces are persisted and inspectable by operator/system actors.
- Oversized tool outputs spill to storage and stay available through
  `show-tool-output`.
- Provider errors are classified into actionable categories.
- `qwen3-coder` is represented as an explicit deterministic local coding lane.
- Retrieval eval fixtures provide a small regression harness for recall quality.
- Installer-facing docs no longer depend on local workstation paths.

## Verification

Run these from a clean checkout before tagging:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm test:eval:retrieval
corepack pnpm docker:mcp:build
```

Expected test state:

- e2e suite passes.
- retrieval eval reports all fixtures passed.
- `node:sqlite` may emit an experimental warning; that is expected.

## Installer Defaults

Host state defaults under:

- Windows: `%USERPROFILE%\.multiagentbrain`
- non-Windows: `$HOME/.multiagentbrain`

Override with `MAB_DATA_ROOT`, or override each path directly with:

- `MAB_VAULT_ROOT`
- `MAB_STAGING_ROOT`
- `MAB_SQLITE_PATH`

Docker MCP session mounts should use explicit host paths and must not rely on
developer workstation paths.

## Known Release Gate

No project license has been selected in this branch. Do not publish a public
installer until the repository owner chooses and adds a license.
