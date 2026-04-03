# docker

Runtime assets for local container execution.

## Files

- `brain-api.Dockerfile`: builds the monorepo and runs the HTTP adapter
- `compose.local.yml`: local compose stack for the API plus Qdrant

## Current Stack Note

`compose.local.yml` now mirrors the active local model stack:

- Docker Model Runner is reached from the container at `http://model-runner.docker.internal:12434`
- the compose profile binds the same Qwen-family roles used on the workstation
- Qdrant remains the vector sidecar
- containerized runs still use `/data/vault/canonical` and `/data/vault/staging` inside the container

The host-side default canonical brain path for direct Windows runs remains `F:\Dev\AI Context Brain` when `MAB_VAULT_ROOT` is unset.

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
