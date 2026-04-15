# Environment variable reference

This reference covers environment variables that are explicitly read in tracked code or documented in `.env.example`.

## Important note

The Node applications do **not** auto-load `.env`. These variables must exist in the process environment.

`MAB_` remains the compatibility prefix for the current release. It is not a
new product name. User-facing docs should call the app/orchestrator mimir and
the stored context layer mimisbrunnr.

## Runtime and release metadata

| Variable | Purpose | Default / notes |
| --- | --- | --- |
| `MAB_NODE_ENV` | runtime mode | defaults to `development` |
| `MIMIR_APPLICATION_NAME` | display application name | defaults to `mimir`; overrides `MAB_APPLICATION_NAME` |
| `MAB_APPLICATION_NAME` | legacy alias for display application name | optional |
| `MAB_RELEASE_VERSION` | release metadata version | optional |
| `MAB_GIT_TAG` | release metadata tag | optional |
| `MAB_GIT_COMMIT` | release metadata commit | optional |
| `MAB_RELEASE_CHANNEL` | release metadata channel | optional |
| `MAB_API_HOST` | HTTP bind host | `127.0.0.1` |
| `MAB_API_PORT` | HTTP bind port | `8080` |
| `MAB_LOG_LEVEL` | log level | `info` |

## Storage and indexing

| Variable | Purpose | Default / notes |
| --- | --- | --- |
| `MAB_DATA_ROOT` | root for default host state paths | `%USERPROFILE%\.mimir` on Windows, `$HOME/.mimir` elsewhere |
| `MAB_VAULT_ROOT` | canonical note root | `$MAB_DATA_ROOT/vault/canonical` |
| `MAB_STAGING_ROOT` | staging draft root | `$MAB_DATA_ROOT/vault/staging` |
| `MAB_SQLITE_PATH` | SQLite path | `$MAB_DATA_ROOT/state/mimisbrunnr.sqlite` |
| `MAB_QDRANT_URL` | Qdrant base URL | `http://127.0.0.1:6333` |
| `MAB_QDRANT_COLLECTION` | Qdrant collection | `mimisbrunnr_chunks` |
| `MAB_QDRANT_SOFT_FAIL` | allow degraded vector behavior instead of surfacing hard failure | defaults to `true` |

## Provider selectors

| Variable | Purpose | Default / notes |
| --- | --- | --- |
| `MAB_EMBEDDING_PROVIDER` | embedding provider selector | `hash` |
| `MAB_REASONING_PROVIDER` | reasoning provider selector | `heuristic` |
| `MAB_DRAFTING_PROVIDER` | drafting provider selector | `ollama` |
| `MAB_RERANKER_PROVIDER` | reranker provider selector | `ollama` |
| `MAB_DISABLE_PROVIDER_FALLBACKS` | disable heuristic/hash fallbacks behind remote providers | defaults to `false` |

Allowed selector values are defined in `packages/infrastructure/src/config/env.ts`.

## Provider endpoints and model names

| Variable | Purpose | Default / notes |
| --- | --- | --- |
| `MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL` | Docker/Ollama-compatible provider base URL | falls back to `MAB_OLLAMA_BASE_URL`, then `http://127.0.0.1:12434` |
| `MAB_OLLAMA_BASE_URL` | generic Ollama-compatible base URL | `http://127.0.0.1:12434` |
| `MAB_OLLAMA_EMBEDDING_MODEL` | default embedding model | `docker.io/ai/qwen3-embedding:0.6B-F16` |
| `MAB_OLLAMA_REASONING_MODEL` | default reasoning model | `qwen3:4B-F16` |
| `MAB_OLLAMA_DRAFTING_MODEL` | default drafting model | falls back to reasoning model |
| `MAB_PROVIDER_PAID_ESCALATION_BASE_URL` | paid OpenAI-compatible endpoint | optional |
| `MAB_PROVIDER_PAID_ESCALATION_API_KEY` | paid provider API key | optional |

## Role binding overrides

Supported role names:

- `CODING_PRIMARY`
- `MIMISBRUNNR_PRIMARY`
- `EMBEDDING_PRIMARY`
- `RERANKER_PRIMARY`
- `PAID_ESCALATION`

Supported suffixes:

- `_PROVIDER`
- `_MODEL`
- `_TEMPERATURE`
- `_SEED`
- `_TIMEOUT_MS`
- `_MAX_INPUT_CHARS`
- `_MAX_OUTPUT_TOKENS`

Examples:

- `MAB_ROLE_CODING_PRIMARY_MODEL`
- `MAB_ROLE_MIMISBRUNNR_PRIMARY_PROVIDER`
- `MAB_ROLE_PAID_ESCALATION_PROVIDER`

Compatibility aliases:

- MAB_ROLE_MIMIR_BRUNNR_PRIMARY_* remains accepted and maps to MAB_ROLE_MIMISBRUNNR_PRIMARY_*.
- When both old and new role variables are set, the MAB_ROLE_MIMISBRUNNR_PRIMARY_* value wins.

## Coding runtime

| Variable | Purpose | Default / notes |
| --- | --- | --- |
| `MAB_CODING_RUNTIME_PYTHON_EXECUTABLE` | Python executable used by the bridge | `py` on Windows, `python3` otherwise |
| `MAB_CODING_RUNTIME_PYTHONPATH` | base `PYTHONPATH` prepended by the bridge | defaults to `<workspace>/runtimes` |
| `MAB_CODING_RUNTIME_MODULE` | Python module to execute | `local_experts.bridge` |
| `MAB_CODING_RUNTIME_TIMEOUT_MS` | coding task timeout | `120000` |

Bridge-derived subprocess env values:

- `PYTHONPATH`
- `OLLAMA_API_URL`
- `CODING_MODEL`

## MCP session defaults

These variables are read by `apps/mimir-mcp/src/main.ts`.

| Variable | Purpose | Default / notes |
| --- | --- | --- |
| `MAB_MCP_DEFAULT_ACTOR_ID` | fixed actor ID for the whole MCP stdio session | optional; if unset, callers must provide actor identity themselves |
| `MAB_MCP_DEFAULT_ACTOR_ROLE` | fixed actor role for the whole MCP stdio session | optional; paired with `MAB_MCP_DEFAULT_ACTOR_ID` |
| `MAB_MCP_DEFAULT_ACTOR_AUTH_TOKEN` | fixed actor token for the whole MCP stdio session | optional; paired with `MAB_MCP_DEFAULT_ACTOR_ID` |
| `MAB_MCP_DEFAULT_SOURCE` | fixed source label for the MCP stdio session | defaults to `mimir-mcp-session` when fixed actor env is enabled |

## Auth

| Variable | Purpose | Default / notes |
| --- | --- | --- |
| `MAB_AUTH_MODE` | auth mode | defaults to `enforced` in production, otherwise `permissive` |
| `MAB_AUTH_ALLOW_ANONYMOUS_INTERNAL` | allow anonymous internal transport | defaults to `true` |
| `MAB_AUTH_ACTOR_REGISTRY_PATH` | path to actor registry JSON | optional |
| `MAB_AUTH_ACTOR_REGISTRY_JSON` | inline actor registry JSON | optional; merged with file-backed entries |
| `MAB_AUTH_ISSUER_SECRET` | secret used to issue/verify centrally issued actor tokens | optional |
| `MAB_AUTH_ISSUED_TOKEN_REQUIRE_REGISTRY_MATCH` | require issued-token actor to match registry | defaults to `true` |
| `MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH` | path to revoked issued token IDs JSON | optional |
| `MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_JSON` | inline revoked issued token IDs JSON | optional; merged with file-backed values |

Accepted JSON shapes:

- actor registry: array of actors or `{ "actors": [...] }`
- revoked tokens: array of token IDs or `{ "tokenIds": [...] }`

## Profile warning

`.env.example`, `docker/compose.local.yml`, and the Docker MCP session profile represent different modes:

- `.env.example` is a reference template and includes both defaults and suggested overrides
- `docker/compose.local.yml` is an explicit model-backed container profile
- `docker/mimir-mcp-session.env.example` and `docker/compose.mcp-session.yml` describe an explicit, session-scoped MCP container profile

Do not assume those files describe the same runtime behavior.

## Evidence status

### Verified facts

- Every variable in this file appears in `packages/infrastructure/src/config/env.ts`, `packages/infrastructure/src/coding/python-coding-controller-bridge.ts`, `packages/infrastructure/src/config/release-metadata.ts`, `.env.example`, or `docker/compose.local.yml`

### Assumptions

- None

### TODO gaps

- If new environment variables are added anywhere in tracked code, update this file in the same change
