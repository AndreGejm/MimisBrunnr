# brain-api

Thin local HTTP adapter over the existing application services.

## Routes

- `GET /health/live`
- `GET /health/ready`
- `GET /v1/system/auth`
- `GET /v1/system/freshness`
- `GET /v1/system/version`
- `POST /v1/system/auth/issue-token`
- `POST /v1/system/auth/introspect-token`
- `POST /v1/coding/execute`
- `POST /v1/context/search`
- `POST /v1/context/packet`
- `POST /v1/context/decision-summary`
- `POST /v1/notes/drafts`
- `POST /v1/system/freshness/refresh-draft`
- `POST /v1/notes/validate`
- `POST /v1/notes/promote`
- `POST /v1/history/query`

## Behavior

- request and response bodies are JSON
- request payloads mirror the existing service contracts
- actor context can be supplied in the body or through `x-brain-*` headers
- route handlers stay thin and delegate directly to the orchestrator and service layer
- health routes expose live and ready checks for local runtime supervision and include release metadata
- the system auth route exposes a redacted actor-registry and issued-token summary for operator review
- the auth control routes let authorized operators issue short-lived actor tokens and inspect token validity against the active policy
- the system freshness route exposes temporal-validity counts plus refresh candidates for expired, future-dated, and expiring-soon current-state notes
- the refresh-draft route creates a governed staging draft for a stale or time-bounded current-state canonical note instead of mutating canonical memory directly
- the system version route exposes the shared Git-centric release metadata contract
- coding execution is surfaced through the same HTTP adapter as the brain-domain routes

## Run

```bash
pnpm api
```
