# brain-api

Thin local HTTP adapter over the existing application services.

## Routes

- `GET /health/live`
- `GET /health/ready`
- `POST /v1/coding/execute`
- `POST /v1/context/search`
- `POST /v1/context/packet`
- `POST /v1/context/decision-summary`
- `POST /v1/notes/drafts`
- `POST /v1/notes/validate`
- `POST /v1/notes/promote`
- `POST /v1/history/query`

## Behavior

- request and response bodies are JSON
- request payloads mirror the existing service contracts
- actor context can be supplied in the body or through `x-brain-*` headers
- route handlers stay thin and delegate directly to the orchestrator and service layer
- health routes expose live and ready checks for local runtime supervision
- coding execution is surfaced through the same HTTP adapter as the brain-domain routes

## Run

```bash
pnpm api
```
