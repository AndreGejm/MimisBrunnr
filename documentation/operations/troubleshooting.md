# Troubleshooting

This file focuses on failures that are directly supported by tracked code and tests.

## The process ignores my `.env` file

Symptom:

- you create `.env`
- the app still uses defaults or missing environment values

Cause:

- the Node apps call `loadEnvironment(process.env)` and do not load dotenv files

What to do:

- export variables in your shell before running `corepack pnpm api`, `corepack pnpm cli`, or `corepack pnpm mcp`
- or pass them through Docker / your process manager

## `corepack enable` fails or `pnpm` is unavailable

Symptom:

- `corepack enable` fails to install shims
- `pnpm` is not found even though Node and Corepack are installed

Cause:

- your machine blocks shim installation or the configured Node tool directory is not writable

What to do:

- run workspace commands as `corepack pnpm ...` directly
- example: `corepack pnpm install`, `corepack pnpm cli -- version`, `corepack pnpm test`

## `docker compose -f docker/compose.mcp-session.yml config` fails immediately

Symptom:

- compose validation exits before starting the session container
- the error points at unset `MAB_HOST_*` or `MAB_FIXED_SESSION_*` variables

Cause:

- `docker/compose.mcp-session.yml` intentionally uses required variable checks for explicit host mounts and the fixed session actor contract

What to do:

- copy `docker/mimir-mcp-session.env.example` to `docker/mimir-mcp-session.env`
- set the host canonical, staging, state, and auth config paths explicitly
- set the fixed session actor id, source, and token contract explicitly
- validate again before launching the MCP client

## The app writes outside the repo

Symptom:

- canonical notes appear under `%USERPROFILE%\.mimir` or `$HOME/.mimir`

Cause:

- `packages/infrastructure/src/config/env.ts` derives default storage paths from `MAB_DATA_ROOT`

What to do:

- set `MAB_DATA_ROOT` or the explicit `MAB_VAULT_ROOT`, `MAB_STAGING_ROOT`, and `MAB_SQLITE_PATH` variables for repo-local development

## `GET /health/live` is degraded or `GET /health/ready` fails

Common cause:

- Qdrant is unavailable

Behavior:

- `live` treats Qdrant failure as a warning
- `ready` treats Qdrant failure as a failure

What to do:

- start Qdrant
- or accept degraded vector retrieval for local development and do not use readiness as your only signal

## Retrieval warnings mention expired or future-dated evidence

Cause:

- retrieval includes note freshness warnings from `RetrieveContextService`
- runtime health also warns on expired, future-dated, or expiring-soon current-state notes

What to do:

- inspect freshness through `GET /v1/system/freshness` or `corepack pnpm cli -- freshness-status`
- create governed refresh drafts instead of mutating canonical notes directly

## `401 unauthorized` or `403 forbidden` on API, CLI, or MCP

Interpretation:

- `401` usually means missing, inactive, revoked, or unrecognized credentials
- `403` usually means the actor is known but not allowed to use the requested role, command, transport, or admin action

What to check:

- `MAB_AUTH_MODE`
- actor registry contents
- source binding
- allowed transport / command / admin-action lists
- token validity windows
- revocation state

Helpful surfaces:

- `corepack pnpm cli -- auth-status --json '{ "actor": { ... } }'`
- `corepack pnpm cli -- auth-issued-tokens --json '{ "actor": { ... }, "includeRevoked": true }'`
- `corepack pnpm cli -- auth-issued-tokens --json '{ "actor": { ... }, "issuedByActorId": "operator-cli", "lifecycleStatus": "active", "includeRevoked": true }'`
- `corepack pnpm cli -- query-history --json '{ "actor": { ... }, "actorId": "operator-cli", "actionType": "issue_auth_token", "limit": 20 }'`
- `corepack pnpm cli -- auth-introspect-token --json '{ "actor": { ... }, ... }'`
- `GET /v1/system/auth`
- `POST /v1/system/auth/introspect-token`

If you need to prove who minted or revoked a token, inspect `query-history` for `issue_auth_token` and `revoke_auth_token` entries. The history detail records `tokenId`, actor target metadata, and revocation reason, but not the raw token string.

In enforced mode, CLI auth-control calls without operator or system actor context now fail with `401 unauthorized` instead of silently returning status.

## `draft_note` behaves differently with and without models

Observed behavior:

- when no drafting provider is configured, `StagingDraftService` generates a deterministic fallback body
- when a drafting provider is configured, it uses provider output first and then validates it

What to do:

- if you want predictable no-model behavior, set `MAB_DRAFTING_PROVIDER=disabled`
- if you want model-backed drafting, configure the provider endpoint and model variables explicitly

## Coding tasks fail or escalate immediately

Common causes:

- Python executable not found
- missing Python dependencies in the vendored runtime
- coding model endpoint unavailable
- runtime timeout

What to check:

- `MAB_CODING_RUNTIME_PYTHON_EXECUTABLE`
- `MAB_CODING_RUNTIME_PYTHONPATH`
- `MAB_CODING_RUNTIME_MODULE`
- `MAB_CODING_RUNTIME_TIMEOUT_MS`
- Python dependencies noted in `runtimes/local_experts/README.md`

## A transport surface exists in code but not in docs

Known risk areas:

- transport surfaces changed faster than the old adapter READMEs and planning docs

What to do:

- trust `apps/mimir-api/src/server.ts`, `apps/mimir-cli/src/main.ts`, and `apps/mimir-mcp/src/tool-definitions.ts`
- update `documentation/reference/interfaces.md` when you change any transport surface
- run `corepack pnpm test:interface-docs` to verify the tracked HTTP interface map
- run `corepack pnpm codesight:routes` if you need to refresh ignored local `.codesight` route artifacts

## `security:audit` reports the VoltAgent uuid advisory

Current expected behavior:

- the audit wrapper allows only `GHSA-w5hq-g745-h8pq` when it appears through the
  documented `@voltagent/core 2.7.x -> uuid 9.0.1` workspace paths
- any other advisory, path, or version pattern fails the command

What to do:

- if the command fails for a new advisory, treat it as a real dependency review
- if VoltAgent publishes a compatible patched dependency, upgrade VoltAgent and
  remove the exception from `scripts/audit-security.mjs`
- do not replace the wrapper with a blanket audit ignore

## The repo map seems to disagree with the workspace

Possible reason:

- your local workspace may include untracked helper files such as `.codesight/`, `vault/`, or local notes

What to do:

- use `git status --short` to separate tracked repository content from local workspace residue

## Evidence status

### Verified facts

- Every issue listed here is grounded in tracked code, root scripts, or tracked tests
- Auth behavior is enforced by `packages/orchestration/src/root/actor-authorization-policy.ts`
- Health behavior is implemented in `packages/infrastructure/src/health/runtime-health.ts`

### Assumptions

- None

### TODO gaps

- If the repo adds a broader release pipeline or a standard launcher that reads
  `.env`, add those failure modes here
