# AI tools Agent Instructions

This folder contains small local helper scripts for saving model tokens and
improving agent efficiency.

Before reading script source, inspect the metadata under `index/` and this
folder's `README.md`.

Use the launcher for the current first-pass helpers:

```bash
node "AI tools/scripts/ai.mjs" list-tools --json
node "AI tools/scripts/ai-tools.mjs" list-tools --json
node "AI tools/scripts/ai-tools.mjs" describe workspace tree-lite --json
node "AI tools/scripts/ai-tools.mjs" run workspace.file-inventory --root . --json
node "AI tools/scripts/ai-tools.mjs" workspace file-inventory --root . --json
node "AI tools/scripts/ai-tools.mjs" workspace tree-lite --root . --json
node "AI tools/scripts/ai-tools.mjs" text smart-search "search terms" --root . --json
node "AI tools/scripts/ai-tools.mjs" text chunk-file README.md --json
node "AI tools/scripts/ai-tools.mjs" text log-summary build.log --json
node "AI tools/scripts/ai-tools.mjs" project diff-summary --staged --json
node "AI tools/scripts/ai-tools.mjs" project command-index --root . --json
node "AI tools/scripts/ai-tools.mjs" config config-map --root . --json
node "AI tools/scripts/ai-tools.mjs" data csv-profile data.csv --json
node "AI tools/scripts/ai-tools.mjs" documents extract-headings README.md --json
node "AI tools/scripts/ai-tools.mjs" documents doc-check --root docs --json
node "AI tools/scripts/ai-tools.mjs" maintenance cleanup-candidates --root . --json
node "AI tools/scripts/ai-tools.mjs" documents extract-text README.md --max-chars 12000 --json
node "AI tools/scripts/ai-tools.mjs" documents extract-links --root docs --json
node "AI tools/scripts/ai-tools.mjs" media media-info --root assets --json
```

Flat commands such as `tree-lite`, `smart-search`, and `config-map` remain
compatibility aliases, but new agent workflows should prefer family commands or
`run <family.tool-id>`.

When using or adding tools:

- Prefer JSON output for agent workflows.
- Keep output bounded with `--max-items`, `--max-chars`, or equivalent limits.
- Treat cleanup and mutation tools as dry-run unless the user explicitly asks to
  apply changes.
- Do not use text-search helpers to inspect secret-looking files unless the user
  explicitly requests that exact file and understands the risk.
- Do not place secrets, credentials, or local-only private data in metadata files.
- Keep scripts deterministic and reusable across paid models, local models, and
  Docker-based agents.
- Put runnable helper scripts in `scripts/`.
- Put concise tool metadata in `index/`.
- Put new tool implementations in `scripts/toolbox/families/<family>.mjs`.
- Keep CLI parsing, formatting, and registry commands in `scripts/toolbox/cli/`.

Useful tool families include inventory, search, chunking, log reduction, diff
summary, command discovery, config inspection, document quality checks, dataset
profiling, media metadata, and dry-run cleanup reports.

If a script becomes stable enough to be part of Mimir's governed runtime, propose
promoting it into the normal toolbox or Docker AI tool registry instead of
quietly expanding this folder into a second package manager.
