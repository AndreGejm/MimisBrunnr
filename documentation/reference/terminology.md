# Terminology Contract

This project uses two related names with different meanings. Do not collapse them into one label.

## mimir

mimir is the application and product identity. Use this name for:

- the operator-facing app
- the orchestrator
- runtime and release metadata
- CLI, API, MCP, Docker, and installer descriptions when referring to the whole system
- documentation that describes how a user operates the product

ASCII-safe technical forms for new identifiers are `mimir`, `mimir-cli`, `mimir-api`, and `mimir-mcp`.

## mimisbrunnr

mimisbrunnr is the durable knowledge store, retrieval surface, context assembly layer, and governed memory well where information is persisted, searched, staged, validated, reviewed, and promoted.

Use this name for:

- canonical and staging memory
- context retrieval
- note validation, review, and promotion
- session archive recall when discussed as part of knowledge retrieval
- context packets assembled for local agents
- the memory/retrieval controller layer inside the orchestrator

Canonical technical forms for new identifiers are `mimisbrunnr` for package-neutral strings and `mimisbrunnr_*` / `mimisbrunnr-*` only where the surrounding surface already requires separators.

## Compatibility Aliases

Compatibility aliases are accepted only at explicit boundary surfaces. They are not canonical names.

- CLI launchers: `mimir`, `mimir-cli`, `mimis`, `mimis-cli`, `mimisbrunnr`, `mimisbrunnr-cli`, `mimirbrunnr`, `mimirbrunnr-cli`, `mimirsbrunnr`, `mimirsbrunnr-cli`, `brain`, `brain-cli`, `brain.CLI`, `multiagentbrain`, `multiagentbrain-cli`, `multiagent-brain`, `multi-agent-brain`, `multi-agent-brain-cli`, and `mab`.
- Corpus/request aliases: old context-brain inputs such as `brain`, `mimir_brunnr`, `mimir-brunnr`, `mimirsbrunnr`, `mimis`, `multiagentbrain`, and `multi-agent-brain` normalize to `mimisbrunnr`.
- Role env aliases: `MAB_ROLE_MIMISBRUNNR_PRIMARY_*` is canonical; `MAB_ROLE_MIMIR_BRUNNR_PRIMARY_*` remains accepted for compatibility.
- `MAB_*` remains the environment-variable prefix for this release. Treat it as a compatibility prefix, not product branding.
- Do not create duplicate Codex MCP server blocks for aliases by default. The canonical MCP server name is `mimir`; duplicate blocks expose duplicate toolsets and make operator review harder.
## Technical Names

Several low-level identifiers intentionally use ASCII-safe names:

- package scope: `@mimir/*`
- app paths: `apps/mimir-api`, `apps/mimir-cli`, `apps/mimir-mcp`
- launcher: `mimir`
- environment variable prefix: `MAB_`
- corpus IDs: `mimisbrunnr`, `general_notes`
- URI scheme and examples such as `mimir://mimisbrunnr/...`
- default Qdrant collection: `mimisbrunnr_chunks`
- default SQLite filename: `mimisbrunnr.sqlite`

Docs may mention those names as exact command, path, environment variable, package, or persisted identifiers.

## Going Forward

Avoid ambiguous standalone use of `brain`.

- If it means the product, write `mimir`.
- If it means the memory/context store, write `mimisbrunnr`.
- If it is an exact legacy command, path, environment variable, package name, or persisted identifier, keep the literal value and label it as compatibility.

Historical planning documents and changelogs may retain the old name when describing past implementation history.
