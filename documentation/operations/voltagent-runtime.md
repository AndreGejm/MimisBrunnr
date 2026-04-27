# VoltAgent runtime

This document covers the bounded VoltAgent-related surfaces that Mimir owns
today.

## Current scope

Mimir currently owns two paid helper roles that can use the VoltAgent-backed
provider path:

- `paid_escalation`
- `coding_advisory`

Mimir also exposes one optional VoltAgent docs peer:

- `voltagent-docs`

That docs peer is a local-stdio MCP server used for documentation lookup during
development. It is not the mechanism for routing client skills, subagents, or
general Workspace behavior through Mimir.

## Boundary

Mimir owns:

- durable memory and retrieval
- governed note mutation
- local execution
- bounded paid helper roles inside this repo

External clients still own:

- skills
- subagents
- workspace skill roots
- client-local VoltAgent orchestration quality

The full boundary is in
`documentation/reference/external-client-boundary.md`.

## Current configuration

The current env contract for the two Mimir-owned helper roles is:

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

Use `MAB_ROLE_<ROLE>_FALLBACK_MODELS_JSON` for an ordered fallback list instead
of one fallback model.

## Current validation lanes

Focused validation commands:

```bash
corepack pnpm test:voltagent-contracts
corepack pnpm test:voltagent-smoke
```

Current coverage:

- VoltAgent-related provider config parsing
- helper-role contract behavior
- coding advisory parity across CLI, HTTP, and MCP
- toolbox manifest compilation for `voltagent-docs`
- Codex local-stdio materialization
- Docker sync omission of client-materialized peers

Current tracked CI workflows:

- `.github/workflows/voltagent-contracts.yml`
- `.github/workflows/voltagent-upstream-canary.yml`

The canary workflow temporarily upgrades upstream VoltAgent packages and reruns
the focused checks.

## Current toolbox path for VoltAgent docs

The development-oriented workflow is `core-dev+voltagent-docs`.

It includes:

- `core-dev`
- `docs-research`
- `voltagent-docs`

Its fallback profile is `core-dev+docs-research`.

Activate it:

```bash
corepack pnpm cli -- request-toolbox-activation --json "{\"requestedToolbox\":\"core-dev+voltagent-docs\",\"taskSummary\":\"Need VoltAgent docs while editing this repository\"}"
```

Render the current Codex client artifact:

```bash
corepack pnpm cli -- sync-toolbox-client --apply --json "{\"activeProfileId\":\"core-dev+voltagent-docs\",\"clientId\":\"codex\"}"
```

Current output:

- file: `.mimir/toolbox/codex.mcp.json`
- server: `voltagent-docs`
- command: `npx -y @voltagent/docs-mcp`

Current important limitation:

- `voltagent-docs` is `local-stdio` and client-materialized
- it is intentionally omitted from Docker profile sync

## Stable failure modes

Current VoltAgent-related errors in code and tests:

- `voltagent_invalid_model_id`
- `voltagent_missing_openai_api_key`
- `voltagent_missing_anthropic_api_key`
- `voltagent_auth`
- `voltagent_timeout`

Operationally:

- if the paid path fails, Mimir still remains the authority for local retrieval
  and local execution
- failure of `voltagent-docs` does not change toolbox policy ownership or make
  it a Docker apply blocker

## Compatibility note

`core-dev+voltagent-dev` still exists as a compatibility alias in the current
manifest tree, but the current canonical name is `core-dev+voltagent-docs`.
