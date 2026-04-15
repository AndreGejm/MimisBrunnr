# Configuration

Configuration is read from `process.env` by `packages/infrastructure/src/config/env.ts`. There is no tracked dotenv loader in the Node applications.

## Configuration sources

In order of practical use:

1. process environment variables passed to the running process
2. explicit environment blocks in `docker/compose.local.yml`
3. defaults inside `packages/infrastructure/src/config/env.ts`

`.env.example` is a reference template. It is not auto-loaded by the code.

## Storage defaults

Default values from `packages/infrastructure/src/config/env.ts`:

- data root: `%USERPROFILE%\.mimir` on Windows or `$HOME/.mimir` elsewhere
- canonical vault root: `$MAB_DATA_ROOT/vault/canonical`
- staging root: `$MAB_DATA_ROOT/vault/staging`
- SQLite path: `$MAB_DATA_ROOT/state/mimisbrunnr.sqlite`
- Qdrant URL: `http://127.0.0.1:6333`
- Qdrant collection: `mimisbrunnr_chunks`

If you want repo-local state, override `MAB_VAULT_ROOT`, `MAB_STAGING_ROOT`,
and `MAB_SQLITE_PATH`.

## Provider defaults

Generic runtime defaults:

- embedding provider: `hash`
- reasoning provider: `heuristic`
- drafting provider: `ollama`
- reranker provider: `ollama`

Generic model defaults:

- embeddings: `docker.io/ai/qwen3-embedding:0.6B-F16`
- reasoning: `qwen3:4B-F16`
- drafting: `qwen3:4B-F16`

The compose profile overrides these generic defaults and forces a model-backed container stack.

## Role binding model

The runtime resolves five named model roles:

- `coding_primary`
- `mimisbrunnr_primary`
- `embedding_primary`
- `reranker_primary`
- `paid_escalation`

Legacy/default bindings are generated in `buildRoleBindingsFromLegacy()` and can then be overridden by per-role environment variables:

- `MAB_ROLE_<ROLE>_PROVIDER`
- `MAB_ROLE_<ROLE>_MODEL`
- `MAB_ROLE_<ROLE>_TEMPERATURE`
- `MAB_ROLE_<ROLE>_SEED`
- `MAB_ROLE_<ROLE>_TIMEOUT_MS`
- `MAB_ROLE_<ROLE>_MAX_INPUT_CHARS`
- `MAB_ROLE_<ROLE>_MAX_OUTPUT_TOKENS`

Examples:

- `MAB_ROLE_CODING_PRIMARY_MODEL=qwen3-coder`
- `MAB_ROLE_MIMISBRUNNR_PRIMARY_PROVIDER=docker_ollama`
- `MAB_ROLE_PAID_ESCALATION_PROVIDER=paid_openai_compat`

## Auth configuration

Auth is configured through `packages/infrastructure/src/config/env.ts` and enforced by `packages/orchestration/src/root/actor-authorization-policy.ts`.

Important defaults:

- `MAB_AUTH_MODE` defaults to `enforced` in production, otherwise `permissive`
- `MAB_AUTH_ALLOW_ANONYMOUS_INTERNAL` defaults to `true`
- `MAB_AUTH_ISSUED_TOKEN_REQUIRE_REGISTRY_MATCH` defaults to `true`

Auth registry sources:

- `MAB_AUTH_ACTOR_REGISTRY_PATH`
- `MAB_AUTH_ACTOR_REGISTRY_JSON`

Revocation sources:

- `MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH`
- `MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_JSON`

Central token issuance requires:

- `MAB_AUTH_ISSUER_SECRET`

## Coding runtime configuration

The Node bridge in `packages/infrastructure/src/coding/python-coding-controller-bridge.ts` reads:

- `MAB_CODING_RUNTIME_PYTHON_EXECUTABLE`
- `MAB_CODING_RUNTIME_PYTHONPATH`
- `MAB_CODING_RUNTIME_MODULE`
- `MAB_CODING_RUNTIME_TIMEOUT_MS`

At runtime it also passes these values into the Python subprocess environment:

- `PYTHONPATH`
- `OLLAMA_API_URL`
- `CODING_MODEL`

## Operational differences between profiles

### Generic local defaults

- can run without model-backed providers if you explicitly disable them
- keep vector search in degraded mode when Qdrant is missing
- use the Windows/non-Windows vault defaults if you do not override them

### `docker/compose.local.yml`

- always uses container paths under `/data`
- always starts Qdrant
- points provider endpoints at `model-runner.docker.internal`
- sets all main provider selectors to `ollama`

## Configuration guidance

- use explicit storage paths during development so runtime state stays where you expect it
- document new env vars in `documentation/reference/env-vars.md` in the same change that introduces them
- do not document `.env` loading unless the applications gain an actual loader

## Evidence status

### Verified facts

- All defaults and env names in this file come from `packages/infrastructure/src/config/env.ts`, `.env.example`, and `docker/compose.local.yml`
- The coding bridge environment handoff comes from `packages/infrastructure/src/coding/python-coding-controller-bridge.ts`

### Assumptions

- None

### TODO gaps

- If role names or auth sources change, update this file and `documentation/reference/env-vars.md` together
