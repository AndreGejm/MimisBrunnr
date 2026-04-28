# Testing strategy

The tracked test strategy is currently centered on end-to-end Node tests plus a focused Python safety test for the vendored runtime.

## Supported commands

From the root `package.json`:

```bash
pnpm build
pnpm typecheck
pnpm test:interface-docs
pnpm test:command-surface
pnpm test:security-audit
pnpm security:audit
pnpm test:transport
pnpm test:e2e
pnpm test
```

Current meanings:

- `pnpm test:interface-docs` runs the tracked HTTP interface documentation and local Codesight route-map drift checks
- `pnpm test:command-surface` checks runtime command catalog, authorization, transport, and CLI command-surface alignment
- `pnpm test:security-audit` checks the audit allowlist classifier with fixtures
- `pnpm security:audit` runs the live pnpm audit wrapper and fails on unallowed advisories
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
- `tests/e2e/command-catalog.test.mjs`
- `tests/e2e/codesight-route-map.test.mjs`

Coverage includes:

- release metadata exposure
- command-surface inventory alignment
- tracked interface docs and generated local Codesight route-map alignment
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

### Dependency audit policy

- `tests/e2e/security-audit.test.mjs`
- `scripts/audit-security.mjs`

Coverage includes:

- the single documented VoltAgent `uuid` advisory exception
- rejection when that advisory appears outside the documented paths
- rejection of unknown advisories

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
- no tracked doc-specific test or link checker
- no full release-publication pipeline

## Suggested order when validating changes

1. `pnpm build`
2. run the smallest relevant test surface
3. run `pnpm test:interface-docs` and `pnpm test:command-surface` if you changed external command or HTTP surfaces
4. run `pnpm security:audit` if you changed dependencies or the lockfile
5. run `pnpm test:transport` if you changed adapters
6. run `pnpm test` before finishing
7. run the Python safety test if you changed `runtimes/local_experts`

## Core quality CI

`.github/workflows/core-quality.yml` is the focused GitHub Actions gate. It runs:

- `pnpm typecheck`
- `pnpm test:interface-docs`
- `pnpm test:security-audit`
- `pnpm security:audit`
- `pnpm test:command-surface`
- `pnpm test:transport`

This catches command-surface, route-doc, dependency-advisory, and transport
regressions without replacing the full `pnpm test:e2e` suite.

## Evidence status

### Verified facts

- Commands come from the root `package.json`
- Test files listed here are the tracked files under `tests/e2e` and `runtimes/local_experts/tests`

### Assumptions

- None

### TODO gaps

- If the repo adds linting, formatting, unit-test packages, or a broader release
  pipeline, update this file to show the preferred validation order
