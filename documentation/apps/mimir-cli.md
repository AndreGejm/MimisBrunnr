# mimir-cli

`apps/mimir-cli` is the thin JSON CLI transport over the shared runtime and the
repo-governed toolbox control surface.

Source of truth for the command catalog is `apps/mimir-cli/src/main.ts`. Source
of truth for the external interface inventory is
[`../reference/interfaces.md`](../reference/interfaces.md).

## How to run it

From the workspace root:

```bash
corepack pnpm cli -- version
```

The optional global `mimir` launcher is a convenience install surface. It is
not required for contributor or CI-style repo-local usage.

## Command families

### Runtime and auth

- `version`
- `auth-issuers`
- `auth-status`
- `auth-issued-tokens`
- `auth-introspect-token`
- `issue-auth-token`
- `revoke-auth-token`
- `revoke-auth-tokens`
- `set-auth-issuer-state`
- `freshness-status`
- `query-history`

### Retrieval and context

- `index-repo`
- `answer-repo`
- `eval-repo`
- `search-context`
- `search-session-archives`
- `assemble-agent-context`
- `list-context-tree`
- `read-context-node`
- `get-context-packet`
- `fetch-decision-summary`

### Drafting, review, and history

- `draft-note`
- `list-review-queue`
- `read-review-note`
- `accept-note`
- `reject-note`
- `create-refresh-draft`
- `create-refresh-drafts`
- `validate-note`
- `promote-note`
- `import-resource`
- `create-session-archive`

### Coding and AI tool registry

- `execute-coding-task`
- `list-agent-traces`
- `show-tool-output`
- `list-ai-tools`
- `check-ai-tools`
- `tools-package-plan`

### Toolbox authoring and control

- `check-mcp-profiles`
- `list-toolbox-servers`
- `scaffold-toolbox`
- `scaffold-toolbox-band`
- `preview-toolbox`
- `sync-mcp-profiles`
- `sync-toolbox-runtime`
- `sync-toolbox-client`
- `list-toolboxes`
- `describe-toolbox`
- `request-toolbox-activation`
- `list-active-toolbox`
- `list-active-tools`
- `deactivate-toolbox`

## CLI behavior

- output is always JSON
- payload-bearing commands accept exactly one of:
  - `--stdin`
  - `--input <path>`
  - `--json <payload>`
- `version` and `--version` do not require a payload
- `--apply` is only supported by:
  - `sync-mcp-profiles`
  - `sync-toolbox-runtime`
  - `sync-toolbox-client`
- `scaffold-toolbox --wizard` is the only wizard mode and must not be combined
  with `--stdin`, `--input`, or `--json`

In enforced auth mode, the auth-control commands require operator or system
actor context in the payload. The current auth-control set is:

- `auth-issuers`
- `auth-status`
- `auth-issued-tokens`
- `auth-introspect-token`
- `issue-auth-token`
- `revoke-auth-token`
- `revoke-auth-tokens`
- `set-auth-issuer-state`

## Important boundaries

### Repo-local first

The verified repo-local form is `corepack pnpm cli -- <command>`. Public docs
or examples should not assume a separate `mimir-mcp` launcher exists.

### Toolbox apply is still split

- `sync-toolbox-runtime --apply` writes the client artifact only
- `sync-mcp-profiles --apply` is the Docker-facing apply surface

Those are deliberately separate. Docker apply can still be blocked by the local
Docker MCP Toolkit contract or by descriptor-only peers with no safe raw
catalog target.

### Command inventory lives elsewhere

This file is orientation, not the canonical full interface listing. When the
catalog changes, update `documentation/reference/interfaces.md` in the same
change.

## Examples

```bash
corepack pnpm cli -- version

corepack pnpm cli -- index-repo --json "{\"root\":\"C:\\\\Users\\\\alexa\\\\Workspaces\\\\panopticon-infra\",\"include\":[\"README.md\",\"AGENTS.md\",\"docs/\",\"ai/\"],\"exclude\":[\"docs/evaluations/\"],\"outputPath\":\"C:\\\\Users\\\\alexa\\\\AppData\\\\Local\\\\Temp\\\\panopticon-repo-index.json\"}"

corepack pnpm cli -- answer-repo --json "{\"indexPath\":\"C:\\\\Users\\\\alexa\\\\AppData\\\\Local\\\\Temp\\\\panopticon-repo-index.json\",\"query\":\"Vilka dokument beskriver restore, backup och rollback i Panopticon?\",\"excludeFromAnswer\":[\"docs/evaluations/\"],\"rankingProfile\":\"panopticon\",\"intentHint\":\"repo_orientation\",\"maxSources\":8}"

corepack pnpm cli -- search-context --json "{\"query\":\"toolbox rollout readiness\",\"corpusIds\":[\"general_notes\",\"mimisbrunnr\"]}"

corepack pnpm cli -- list-toolboxes --json "{}"

corepack pnpm cli -- sync-toolbox-runtime --json "{}"
```

`index-repo`, `answer-repo`, and `eval-repo` are CLI-local helpers for
file-level repository evaluation. They keep indexes outside the indexed repo,
return source-path citations, and support answer-time source exclusions such as
downranking or excluding test-suite documents. `answer-repo` and `eval-repo`
accept `rankingProfile` (`generic` or `panopticon`), custom `sourceWeights`,
optional `intentHint` (`repo_orientation`, `security_reasoning`,
`prompt_generation`, `gap_analysis`, or `operator_usefulness`), and eval checks
such as `expectedFiles`, `expectedAnyFiles`, `forbiddenFiles`,
`minExpectedFiles`, `maxExpectedRank`, `mustIncludeTerms`, and
`forbiddenTerms`. Tests can also set `requireGroundedTerms` with optional
`groundingTerms` to require required terms to appear in cited source excerpts,
not only in the prompt-derived summary. Citation output includes lexical score
breakdowns, eval output includes expected/forbidden rank metrics, and
`retrievalHealth.topCandidates` reports the highest scoring candidates for
debugging missing or surprising citations. The eval summary includes
`passRate`, `partialCreditRate`, suite-level `meanReciprocalRank`,
`groundedTermRate`, `forbiddenViolationCount`, and `scoreOutOf10` for comparing
quality across runs.
`search-context`,
`assemble-agent-context`, and `fetch-decision-summary` use the shared default
context budget when `budget` is omitted.

## Canonical docs

- [`../reference/interfaces.md`](../reference/interfaces.md)
- [`../setup/development-workflow.md`](../setup/development-workflow.md)
- [`../operations/docker-toolbox-v1.md`](../operations/docker-toolbox-v1.md)
- [`../operations/toolbox-operator-guide.md`](../operations/toolbox-operator-guide.md)
- [`../planning/current-implementation.md`](../planning/current-implementation.md)
