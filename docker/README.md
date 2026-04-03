# docker

Runtime assets for local container execution.

## Files

- `brain-api.Dockerfile`: builds the monorepo and runs the HTTP adapter
- `compose.local.yml`: local compose stack for the API plus Qdrant

## Health

The API now exposes:

- `GET /health/live`
- `GET /health/ready`

`live` treats missing Qdrant as a warning so the process can still be considered alive during local startup.

`ready` requires Qdrant and the core local resources to be available.

## Run

```bash
docker compose -f docker/compose.local.yml up --build
```
