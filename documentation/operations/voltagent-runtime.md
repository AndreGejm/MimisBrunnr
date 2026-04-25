# VoltAgent runtime operations

This document covers the supported Mimir-owned VoltAgent integration:

- `paid_escalation` can use `voltagent_agent`
- `coding_advisory` can use `voltagent_agent`
- Claude fallback is configured inside the paid harness, not through a separate
  orchestration policy layer
- `voltagent-docs` is exposed as an optional development-only local-stdio docs
  peer for Codex

## Boundary

Mimir owns only the bounded paid-runtime roles and the durable context layer:

- memory and retrieval
- local models and local-agent execution
- audit and trace records for paid helper roles

Codex and Claude remain responsible for their own:

- skills
- subagents
- workspace skill roots
- paid-agent quality orchestration outside these bounded Mimir roles

`voltagent-docs` is a docs lookup convenience only. It is not the architectural
path for routing VoltAgent skills, workspace tools, or subagent behavior
through Mimir.

See [external-client-boundary.md](/F:/Dev/scripts/Mimir/mimir/documentation/reference/external-client-boundary.md)
for the supported split between Mimir-owned runtime responsibilities and
Codex/Claude-owned skills and subagents.

## Supported configuration

Primary plus Claude fallback:

```bash
set OPENAI_API_KEY=replace-me
set ANTHROPIC_API_KEY=replace-me
set MAB_ROLE_PAID_ESCALATION_PROVIDER=voltagent_agent
set MAB_ROLE_PAID_ESCALATION_MODEL=openai/gpt-4.1-mini
set MAB_ROLE_PAID_ESCALATION_FALLBACK_MODEL=anthropic/claude-sonnet-4
set MAB_ROLE_CODING_ADVISORY_PROVIDER=voltagent_agent
set MAB_ROLE_CODING_ADVISORY_MODEL=openai/gpt-4.1-mini
set MAB_ROLE_CODING_ADVISORY_FALLBACK_MODEL=anthropic/claude-sonnet-4
```

Use `MAB_ROLE_<ROLE>_FALLBACK_MODELS_JSON` when you need more than one ordered
fallback candidate.

## Upgrade-safety commands

Contract lane:

```bash
corepack pnpm test:voltagent-contracts
```

This verifies:

- role-binding parsing, including fallback model ids
- VoltAgent harness contract shape
- paid-path telemetry classification
- coding advisory adapter contract behavior

Smoke lane:

```bash
corepack pnpm test:voltagent-smoke
```

This verifies:

- CLI/API/MCP coding advisory parity
- toolbox manifest compilation for `voltagent-docs`
- local-stdio Codex materialization
- Docker profile sync omission behavior for client-materialized peers

## Toolbox activation for VoltAgent development

Activate the optional development-only VoltAgent docs toolbox:

```bash
corepack pnpm cli -- request-toolbox-activation --json "{\"requestedToolbox\":\"core-dev+voltagent-docs\",\"taskSummary\":\"Need VoltAgent docs while editing the current repository\"}"
```

Materialize the Codex MCP config:

```bash
corepack pnpm cli -- sync-toolbox-client --apply --json "{\"activeProfileId\":\"core-dev+voltagent-docs\",\"clientId\":\"codex\"}"
```

Expected file:

- `.mimir/toolbox/codex.mcp.json`

Expected peer:

- `voltagent-docs` via `npx -y @voltagent/docs-mcp`

Legacy compatibility note:

- `core-dev+voltagent-dev` remains accepted as a profile/id alias during the
  current compatibility window, but new docs and automation should use
  `core-dev+voltagent-docs`

## Failure modes

Stable errors you should expect:

- `voltagent_invalid_model_id`
- `voltagent_missing_openai_api_key`
- `voltagent_missing_anthropic_api_key`
- `voltagent_auth`
- `voltagent_timeout`

Operational rule:

- if the paid path is unavailable, Mimir remains authoritative and preserves the
  original local escalation semantics
- if a local-stdio peer is active, Docker MCP sync omits it instead of treating
  it as a Docker apply blocker

## Upgrade policy

- keep `@voltagent/core` as a normal dependency, never vendored
- use the CI `voltagent-contracts` workflow for package updates
- use the scheduled `voltagent-upstream-canary` workflow to detect upstream
  breakage before normal upgrade work lands
- review `pnpm-lock.yaml` changes together with the contract and smoke lanes
- keep `paid_openai_compat` available during the current compatibility window
