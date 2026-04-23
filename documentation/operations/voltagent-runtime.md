# VoltAgent runtime operations

This document covers the supported Mimir-owned VoltAgent integration:

- `paid_escalation` can use `voltagent_agent`
- `coding_advisory` can use `voltagent_agent`
- Claude fallback is configured inside the paid harness, not through a separate
  orchestration policy layer
- `voltagent-docs` is exposed as a checked-in local-stdio toolbox peer for Codex

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

Activate the checked-in VoltAgent development toolbox:

```bash
corepack pnpm cli -- request-toolbox-activation --json "{\"requestedToolbox\":\"core-dev+voltagent-dev\",\"taskSummary\":\"Need VoltAgent docs while editing the current repository\"}"
```

Materialize the Codex MCP config:

```bash
corepack pnpm cli -- sync-toolbox-client --apply --json "{\"activeProfileId\":\"core-dev+voltagent-dev\",\"clientId\":\"codex\"}"
```

Expected file:

- `.mimir/toolbox/codex.mcp.json`

Expected peer:

- `voltagent-docs` via `npx -y @voltagent/docs-mcp`

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
