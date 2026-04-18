# mimir-cli

CLI adapter over the shared runtime container.

## Entrypoint

- `apps/mimir-cli/src/main.ts`

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
- `version` does not require a payload
- `auth-status` has no required payload, but enforced auth mode still requires operator or system actor context in the JSON body
- `auth-issued-tokens`, `freshness-status`, and `create-refresh-drafts` accept optional payloads
- `auth-issued-tokens`, `auth-introspect-token`, `issue-auth-token`, and `revoke-auth-token` should carry an `actor` object when `MAB_AUTH_MODE=enforced`
- `auth-issued-tokens` accepts `actorId`, `issuedByActorId`, `revokedByActorId`, `lifecycleStatus`, `asOf`, `includeRevoked`, and `limit`; the returned summary applies the same filters except for `limit`
- lifecycle entries returned by `auth-issued-tokens` include `issuedByActorId`, `issuedByActorRole`, `issuedBySource`, and `issuedByTransport` when the token was minted through the protected issue flow, plus `revokedByActorId`, `revokedByActorRole`, `revokedBySource`, and `revokedByTransport` after revocation
- `issue-auth-token` and `revoke-auth-token` also write `issue_auth_token` and `revoke_auth_token` audit events into `query-history`; the audit detail records token ids, actor targets, policy-shape booleans, and revocation reasons, but never the raw issued token
- `query-history` accepts `actorId`, `actionType`, `source`, `noteId`, `since`, `until`, and `limit`; filtering happens before the bounded result window is applied
- output is always JSON

## Run

```bash
pnpm cli -- version
pnpm cli -- auth-status --json "{\"actor\":{\"actorId\":\"operator-cli\",\"actorRole\":\"operator\",\"source\":\"mimir-cli-admin\",\"authToken\":\"<token>\"}}"
pnpm cli -- auth-issued-tokens --json "{\"actor\":{\"actorId\":\"operator-cli\",\"actorRole\":\"operator\",\"source\":\"mimir-cli-admin\",\"authToken\":\"<token>\"},\"issuedByActorId\":\"security-cli\",\"lifecycleStatus\":\"future\",\"includeRevoked\":true}"
pnpm cli -- query-history --json "{\"actor\":{\"actorId\":\"operator-cli\",\"actorRole\":\"operator\",\"source\":\"mimir-cli-admin\",\"authToken\":\"<token>\"},\"actorId\":\"operator-cli\",\"actionType\":\"issue_auth_token\",\"limit\":20}"
pnpm cli -- list-context-tree --json "{\"ownerScope\":\"mimisbrunnr\",\"authorityStates\":[\"canonical\",\"staging\"]}"
```

## Canonical docs

- `documentation/reference/interfaces.md`
- `documentation/setup/development-workflow.md`

## Evidence status

### Verified facts

- This README is based on `apps/mimir-cli/src/main.ts`

### Assumptions

- None

### TODO gaps

- If commands change, update this file and `documentation/reference/interfaces.md` together
