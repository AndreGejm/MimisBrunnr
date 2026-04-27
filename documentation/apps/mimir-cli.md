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

corepack pnpm cli -- search-context --json "{\"query\":\"toolbox rollout readiness\",\"budget\":{\"maxTokens\":1200,\"maxSources\":4,\"maxRawExcerpts\":1,\"maxSummarySentences\":4},\"corpusIds\":[\"general_notes\",\"mimisbrunnr\"]}"

corepack pnpm cli -- list-toolboxes --json "{}"

corepack pnpm cli -- sync-toolbox-runtime --json "{}"
```

## Canonical docs

- [`../reference/interfaces.md`](../reference/interfaces.md)
- [`../setup/development-workflow.md`](../setup/development-workflow.md)
- [`../operations/docker-toolbox-v1.md`](../operations/docker-toolbox-v1.md)
- [`../planning/current-implementation.md`](../planning/current-implementation.md)
