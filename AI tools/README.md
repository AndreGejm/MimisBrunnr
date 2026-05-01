# AI tools

This folder is the shared drop zone for small scripts that help AI agents spend
fewer tokens and make better local decisions before reading large files, logs,
datasets, or directories.

Tools placed here should turn messy local state into compact, structured facts.
They are for Codex, local models, Docker-based agents, and paid model workflows
that need quick workspace orientation.

## Layout

```text
AI tools/
  AGENTS.md              Agent-facing usage rules
  README.md              Human-facing overview
  index/
    tool-template.json   Copy this when describing a new tool
  scripts/
    .gitkeep             Put executable helper scripts here
```

Use `scripts/` for runnable helpers. Use `index/` for concise metadata that an
agent can read before deciding whether a script is relevant.

## Tool Categories

Good first tools:

- `tree-lite`: compact folder tree with ignored directories removed.
- `file-inventory`: file counts, size totals, extension summary, largest files,
  and recently modified files.
- `smart-search`: ranked text search with deduped nearby matches and bounded
  context.
- `chunk-file`: split long files by headings, symbols, lines, or token budget.
- `log-summary`: collapse logs into first errors, repeated errors, warnings, and
  referenced files.
- `diff-summary`: summarize staged or working-tree changes for review and handoff.
- `command-index`: list package scripts, make targets, task files, and Docker
  commands with safety metadata.
- `config-map`: summarize config files and referenced environment variables.
- `csv-profile`: profile rows, columns, types, missing values, and duplicates.
- `doc-check`: report broken links, heading problems, duplicate sections, and
  long sections.
- `cleanup-candidates`: dry-run cleanup report with safe and review-required
  candidates.
- `media-info`: summarize image, audio, and video metadata.

## Output Contract

Prefer JSON by default. Markdown output is useful for humans, but agents should
be able to request compact JSON from every tool.

```json
{
  "tool": "file-inventory",
  "schema_version": "1.0",
  "root": "C:/example/project",
  "generated_at": "2026-05-01T12:00:00Z",
  "data": {},
  "warnings": [],
  "errors": []
}
```

Recommended common flags:

- `--json`
- `--markdown`
- `--max-items`
- `--max-chars`
- `--ignore`
- `--include`
- `--root`
- `--dry-run`

For AI use, default to bounded output. A script should never dump an entire large
file, full dependency tree, full dataset, or full log unless explicitly asked.

## Safety Rules

- Default destructive or cleanup-related tools to dry-run.
- Mark whether each tool mutates files, requires network access, or can read
  secrets.
- Ignore generated or dependency folders by default, including `.git`,
  `node_modules`, `dist`, `target`, `.pnpm-store`, `coverage`, `.venv`, and
  `__pycache__`.
- Prefer deterministic output and stable ordering so agents can compare runs.
- Keep scripts small and composable. If a tool becomes a product surface, promote
  it intentionally into the normal Mimir toolbox or Docker AI tool registry.

## Metadata

When adding a script, copy `index/tool-template.json` to a tool-specific metadata
file and fill it in. The goal is that an agent can inspect the index before
opening script source.
