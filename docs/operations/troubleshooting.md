# Troubleshooting

This file focuses on failures that are directly supported by tracked code and tests.

## The process ignores my `.env` file

Symptom:

- you create `.env`
- the app still uses defaults or missing environment values

Cause:

- the Node apps call `loadEnvironment(process.env)` and do not load dotenv files

What to do:

- export variables in your shell before running `pnpm api`, `pnpm cli`, or `pnpm mcp`
- or pass them through Docker / your process manager

## The app writes outside the repo on Windows

Symptom:

- canonical notes appear under `F:\Dev\AI Context Brain`

Cause:

- `packages/infrastructure/src/config/env.ts` uses that as the Windows default when `MAB_VAULT_ROOT` is unset

What to do:

- set `MAB_VAULT_ROOT` explicitly for repo-local development

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

- inspect freshness through `GET /v1/system/freshness` or `pnpm cli -- freshness-status`
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

- `pnpm cli -- auth-status`
- `pnpm cli -- auth-issued-tokens`
- `pnpm cli -- auth-introspect-token --json ...`
- `GET /v1/system/auth`
- `POST /v1/system/auth/introspect-token`

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
- `packages/contracts/src/mcp/index.ts` and `apps/brain-mcp` do not currently expose the exact same MCP tool list

What to do:

- trust `apps/brain-api/src/server.ts`, `apps/brain-cli/src/main.ts`, and `apps/brain-mcp/src/tool-definitions.ts`
- update `docs/reference/interfaces.md` when you change any transport surface

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

- If the repo adds CI or a standard launcher that reads `.env`, add those failure modes here
