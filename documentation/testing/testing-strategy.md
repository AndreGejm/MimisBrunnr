# Testing strategy

The tracked test strategy is currently centered on end-to-end Node tests plus a focused Python safety test for the vendored runtime.

## Supported commands

From the root `package.json`:

```bash
pnpm build
pnpm typecheck
pnpm test:transport
pnpm test:e2e
pnpm test
```

Current meanings:

- `pnpm test:transport` runs the CLI/API/MCP transport adapter tests
- `pnpm test:e2e` runs `pnpm build` and then executes the tracked end-to-end suite
- `pnpm test` currently aliases `pnpm test:e2e`

Python runtime test:

```bash
python -m pytest runtimes/local_experts/tests/test_safety_gate.py -v
```

## Test surfaces by file

### Transport adapters

- `tests/e2e/transport-adapters.test.mjs`
- `tests/e2e/mcp-adapter.test.mjs`

Coverage includes:

- release metadata exposure
- auth-control surfaces
- namespace tree and node transport behavior
- direct packet assembly
- refresh-draft flows
- coding-route wiring
- auth enforcement and rotated credentials

### Retrieval and context behavior

- `tests/e2e/context-authority-contracts.test.mjs`
- `tests/e2e/context-namespace.test.mjs`
- `tests/e2e/context-representations.test.mjs`
- `tests/e2e/retrieval-trace.test.mjs`
- `tests/e2e/retrieval-strategy-diff.test.mjs`
- `tests/e2e/hierarchical-retrieval.test.mjs`

### Memory, promotion, import, and history

- `tests/e2e/service-boundaries-and-regression.test.mjs`
- `tests/e2e/import-pipeline.test.mjs`
- `tests/e2e/session-archives.test.mjs`

### Provider adapters

- `tests/e2e/local-model-providers.test.mjs`

### Python runtime safety

- `runtimes/local_experts/tests/test_safety_gate.py`

## Test style

The tracked Node tests:

- create temporary vault and SQLite paths
- frequently use the `hash` / `heuristic` / `disabled` / `local` provider profile
- validate transport behavior through built artifacts in `dist`
- use Qdrant URLs that may be unreachable, relying on vector soft-fail behavior where appropriate

## What is not currently present

- no tracked unit-test-only package split
- no tracked lint or formatting script
- no tracked CI workflow
- no tracked doc-specific test or link checker

## Suggested order when validating changes

1. `pnpm build`
2. run the smallest relevant test surface
3. run `pnpm test:transport` if you changed adapters
4. run `pnpm test` before finishing
5. run the Python safety test if you changed `runtimes/local_experts`

## Evidence status

### Verified facts

- Commands come from the root `package.json`
- Test files listed here are the tracked files under `tests/e2e` and `runtimes/local_experts/tests`

### Assumptions

- None

### TODO gaps

- If the repo adds linting, formatting, unit-test packages, or CI, update this file to show the preferred validation order
