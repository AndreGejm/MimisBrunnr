# docker

Tracked container assets for the local HTTP runtime live here.

## Files

- `docker/mimir-api.Dockerfile`
- `docker/compose.local.yml`

## Current behavior

`docker/mimir-api.Dockerfile`:

- builds the workspace with Node 22
- runs `pnpm install --frozen-lockfile`
- runs `pnpm build`
- starts the app with `pnpm api`

`docker/compose.local.yml`:

- runs `mimir-api`
- runs `qdrant`
- maps the API to `8080:8080`
- binds persistent named volumes for canonical vault, staging vault, SQLite state, and Qdrant storage
- points model-backed providers at `http://model-runner.docker.internal:12434`
- sets embedding, reasoning, drafting, and reranking selectors to the Ollama-compatible stack

## Important profile note

The compose profile is more model-backed than the generic defaults in `packages/infrastructure/src/config/env.ts`.

For example:

- generic defaults use `hash` embeddings and `heuristic` reasoning unless overridden
- compose forces the main provider selectors to `ollama`

## Run

```bash
docker compose -f docker/compose.local.yml up --build
```

## Evidence status

### Verified facts

- This README is based on `docker/mimir-api.Dockerfile` and `docker/compose.local.yml`

### Assumptions

- None

### TODO gaps

- If more container profiles are added, document their differences here instead of folding everything into one description
