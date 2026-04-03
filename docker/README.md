# docker

Runtime assets for local container execution.

## Files

- `brain-api.Dockerfile`: builds the monorepo and runs the HTTP adapter
- `compose.local.yml`: local compose stack for the API plus Qdrant

## Current Stack Note

The compose file is intentionally more conservative than the live workstation setup.

Today the live local stack uses Docker Model Runner plus Qwen-family models, while `compose.local.yml` still defaults to safer heuristic or fallback-oriented provider settings. That makes compose useful for reproducible local bring-up, but it is not yet a full declaration of the active local model stack.

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
