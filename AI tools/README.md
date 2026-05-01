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

## Launcher

The first shared launcher is:

```bash
node "AI tools/scripts/ai-tools.mjs" <command> [options]
```

Short alias:

```bash
node "AI tools/scripts/ai.mjs" <command> [options]
```

Available read-only commands:

- `list-tools`: emit machine-readable metadata for the tools in `index/`.
- `tree-lite`: emit a bounded tree with generated and dependency folders omitted.
- `file-inventory`: summarize file counts, sizes, extensions, largest files, and
  recent files.
- `smart-search`: return ranked, bounded text matches while ignoring generated
  and dependency folders. Content search also skips common secret-looking files
  such as `.env`, private-key extensions, and package-manager credential files.
- `chunk-file`: split a text or Markdown file into chunks with line ranges,
  headings, token estimates, and bounded previews.
- `log-summary`: collapse a log into counts, first errors, warnings, repeated
  lines, and referenced files.
- `diff-summary`: summarize a git diff or patch file by changed files, line
  counts, categories, and risky files.
- `command-index`: list package scripts with simple mutation and network safety
  metadata.
- `config-map`: summarize config files and environment-variable references
  without exposing secret values.
- `csv-profile`: profile CSV rows, columns, missing values, inferred types, and
  duplicate rows.
- `extract-headings`: extract a compact Markdown heading outline with levels and
  line numbers.
- `doc-check`: check Markdown files for broken local links, duplicate headings,
  and long sections without dumping document bodies.
- `cleanup-candidates`: dry-run temporary, cache, and log cleanup candidates.
- `extract-text`: extract bounded text from one readable text file while
  refusing secret-like files.
- `extract-links`: extract Markdown links from a file or folder with local
  existence checks and external-link flags.
- `media-info`: summarize image, audio, and video files with file metadata and
  basic image dimensions when available.

Examples:

```bash
node "AI tools/scripts/ai-tools.mjs" list-tools --json
node "AI tools/scripts/ai-tools.mjs" file-inventory --root . --max-items 20 --json
node "AI tools/scripts/ai-tools.mjs" tree-lite --root . --max-depth 3 --max-items 100 --json
node "AI tools/scripts/ai-tools.mjs" smart-search "timeout" --root . --max-items 10 --max-chars 180 --json
node "AI tools/scripts/ai-tools.mjs" chunk-file README.md --max-chars 800 --json
node "AI tools/scripts/ai-tools.mjs" log-summary build.log --max-items 20 --json
node "AI tools/scripts/ai-tools.mjs" diff-summary --staged --json
node "AI tools/scripts/ai-tools.mjs" command-index --root . --json
node "AI tools/scripts/ai-tools.mjs" config-map --root . --json
node "AI tools/scripts/ai-tools.mjs" csv-profile data.csv --json
node "AI tools/scripts/ai-tools.mjs" extract-headings README.md --json
node "AI tools/scripts/ai-tools.mjs" doc-check --root docs --json
node "AI tools/scripts/ai-tools.mjs" cleanup-candidates --root . --json
node "AI tools/scripts/ai-tools.mjs" extract-text README.md --max-chars 12000 --json
node "AI tools/scripts/ai-tools.mjs" extract-links --root docs --json
node "AI tools/scripts/ai-tools.mjs" media-info --root assets --json
```

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
- Do not scan secret-looking files for text content by default.
- Keep scripts small and composable. If a tool becomes a product surface, promote
  it intentionally into the normal Mimir toolbox or Docker AI tool registry.

## Metadata

When adding a script, copy `index/tool-template.json` to a tool-specific metadata
file and fill it in. The goal is that an agent can inspect the index before
opening script source.
