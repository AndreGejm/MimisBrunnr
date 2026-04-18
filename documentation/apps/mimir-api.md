# mimir-api

HTTP adapter over the shared runtime container.

## Entrypoints

- `apps/mimir-api/src/main.ts`
- `apps/mimir-api/src/server.ts`

## Routes

### Health and system

- `GET /health/live`
- `GET /health/ready`
- `GET /v1/system/auth`
- `GET /v1/system/auth/issued-tokens`
- `POST /v1/system/auth/issue-token`
- `POST /v1/system/auth/introspect-token`
- `POST /v1/system/auth/revoke-token`
- `GET /v1/system/freshness`
- `GET /v1/system/version`

### Retrieval and context

- `POST /v1/context/search`
- `POST /v1/context/tree`
- `POST /v1/context/node`
- `POST /v1/context/packet`
- `POST /v1/context/decision-summary`

### Memory and governance

- `POST /v1/notes/drafts`
- `POST /v1/system/freshness/refresh-draft`
- `POST /v1/system/freshness/refresh-drafts`
- `POST /v1/notes/validate`
- `POST /v1/notes/promote`
- `POST /v1/maintenance/import-resource`
- `POST /v1/history/query`
- `POST /v1/history/session-archives`

### Coding

- `POST /v1/coding/execute`

## Behavior

- validates JSON request bodies through shared transport validation
- injects actor defaults from body and `x-mimir-*` headers
- delegates into the shared orchestrator or shared services
- exposes liveness and readiness health reports
- `GET /v1/system/auth/issued-tokens` accepts `actorId`, `issuedByActorId`, `revokedByActorId`, `lifecycleStatus`, `asOf`, `includeRevoked`, and `limit` as query parameters; the returned summary applies the same filters except for `limit`
- `POST /v1/system/auth/issue-token` and `POST /v1/system/auth/revoke-token` also append `issue_auth_token` and `revoke_auth_token` audit events that become visible through `POST /v1/history/query`; those audit details record token ids and safe lifecycle metadata, not raw token strings
- `POST /v1/history/query` accepts `actorId`, `actionType`, `source`, `noteId`, `since`, `until`, and `limit` so operators can isolate lifecycle events without scanning unrelated history
- maps service/auth/validation failures to HTTP status codes

## Run

```bash
pnpm api
```

## Canonical docs

- `documentation/reference/interfaces.md`
- `documentation/operations/running.md`
- `documentation/operations/troubleshooting.md`

## Evidence status

### Verified facts

- This README is based on `apps/mimir-api/src/server.ts`

### Assumptions

- None

### TODO gaps

- If routes change, update this file and `documentation/reference/interfaces.md` together
