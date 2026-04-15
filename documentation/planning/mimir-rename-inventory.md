# mimir Rename Inventory

Date: 2026-04-13

## Rename Strategy

The product identity is split into two names:

- mimir: the application, operator-facing product, runtime, and orchestrator.
- mimisbrunnr: the AI context well, durable knowledge store, memory well,
  retrieval/read side, staging/review/promotion path, and context assembly
  layer.

This stricter pass removed pre-release internal old branding from package
scopes, app paths, Docker paths, launcher generation, corpus identifiers,
namespace URI examples, default SQLite filenames, and default Qdrant collection
names. The remaining compatibility surface is primarily the `MAB_` environment
prefix, which requires a separate aliasing and migration pass.

## Applied Renames

Product/runtime surfaces now use:

- package scope: `@mimir/*`
- app paths: `apps/mimir-api`, `apps/mimir-cli`, `apps/mimir-mcp`
- Docker files: `docker/mimir-api.Dockerfile`,
  `docker/mimir-mcp.Dockerfile`, and `docker/mimir-mcp-session-*`
- launcher wrapper paths: `scripts/launch-mimir-cli.mjs` and
  `scripts/launch-mimir-mcp.mjs`
- installer launcher name: `mimir`
- intended Git repository slug: `mimisbrunnr`
- MCP server name: `mimir-mcp`
- actor source labels: `mimir-api`, `mimir-cli`, `mimir-mcp`,
  `mimir-mcp-session`

mimisbrunnr surfaces now use:

- corpus/owner scope: `mimisbrunnr`
- namespace URI scheme examples: `mimir://`
- default SQLite filename: `mimisbrunnr.sqlite`
- default Qdrant collection: `mimisbrunnr_chunks`
- model role: `mimisbrunnr_primary`
- orchestration controllers under `packages/orchestration/src/mimisbrunnr`

## Remaining Compatibility Surface

Still intentionally present:

- `MAB_*` environment variables.
- `MAB_ROLE_MIMISBRUNNR_PRIMARY_*` environment variables.
- Existing local installations may still have old global launcher files on disk
  until users rerun the installer.
- Historical archive references may still point at old repository slugs outside
  runtime code.
- The active release checkout is now `F:\Dev\scripts\Mimir\mimir`; the former pre-release checkout path is obsolete.
- External Superpowers skill names may still contain the old product slug until
  those external skills are renamed in their own repository.

## Next Migration Pass

Recommended next steps if the compatibility surface should also be renamed:

1. Add `MIMIR_*` and `MIMISBRUNNR_*` env aliases while keeping `MAB_*`
   fallbacks.
2. Write a state migration for older vault paths, SQLite filenames, Qdrant
   collections, and namespace URI references.
3. Rename external Superpowers skills and update their skill metadata.
4. Provide an installer cleanup command that removes obsolete launcher shims
   from user PATH directories after confirming `mimir` works.
