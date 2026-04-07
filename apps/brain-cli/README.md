# brain-cli

CLI adapter over the shared runtime container.

## Entrypoint

- `apps/brain-cli/src/main.ts`

## Commands

- `version`
- `auth-status`
- `auth-issued-tokens`
- `auth-introspect-token`
- `freshness-status`
- `issue-auth-token`
- `revoke-auth-token`
- `execute-coding-task`
- `search-context`
- `list-context-tree`
- `read-context-node`
- `get-context-packet`
- `fetch-decision-summary`
- `draft-note`
- `create-refresh-draft`
- `create-refresh-drafts`
- `validate-note`
- `promote-note`
- `import-resource`
- `query-history`
- `create-session-archive`

## Input behavior

- payload-bearing commands accept exactly one of `--stdin`, `--input <path>`, or `--json <payload>`
- `version` and `auth-status` do not require payloads
- `auth-issued-tokens`, `freshness-status`, and `create-refresh-drafts` accept optional payloads
- output is always JSON

## Run

```bash
pnpm cli -- version
pnpm cli -- auth-status
pnpm cli -- list-context-tree --json "{\"ownerScope\":\"context_brain\",\"authorityStates\":[\"canonical\",\"staging\"]}"
```

## Canonical docs

- `docs/reference/interfaces.md`
- `docs/setup/development-workflow.md`

## Evidence status

### Verified facts

- This README is based on `apps/brain-cli/src/main.ts`

### Assumptions

- None

### TODO gaps

- If commands change, update this file and `docs/reference/interfaces.md` together
