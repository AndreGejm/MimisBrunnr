# tests

Tracked tests are concentrated in `tests/e2e` plus the vendored Python runtime test in `runtimes/local_experts/tests`.

## Node end-to-end suites

- context authority and corpus boundaries
- authorization policy and actor-registry behavior
- namespace browse/read surfaces
- derived representation regeneration
- retrieval traces and strategy behavior
- hierarchical retrieval
- import pipeline behavior
- session archives
- configuration boundary handling
- command catalog coverage
- interface-documentation and local Codesight route-map drift checks
- request-field and transport-validation boundaries
- coding transport validation boundaries
- transport adapters for CLI, HTTP, and MCP
- security audit allowlist classification
- MCP session startup validation
- provider adapter behavior
- Docker AI tool registry discovery, validation, and package-plan behavior
- external-source registry behavior and external-source policy enforcement
- service-boundary regressions

## Commands

```bash
corepack pnpm typecheck
corepack pnpm test:interface-docs
corepack pnpm test:command-surface
corepack pnpm test:security-audit
corepack pnpm security:audit
corepack pnpm test:transport
corepack pnpm test:e2e
corepack pnpm test
py -3 -m pytest runtimes/local_experts/tests/test_safety_gate.py -v   # Windows
python3 -m pytest runtimes/local_experts/tests/test_safety_gate.py -v # macOS/Linux
```

## Core quality CI

`.github/workflows/core-quality.yml` is the focused required-style gate for
core runtime changes. It installs the workspace with the frozen lockfile and
runs:

- `pnpm typecheck`
- `pnpm test:interface-docs`
- `pnpm test:security-audit`
- `pnpm security:audit`
- `pnpm test:command-surface`
- `pnpm test:transport`

The workflow is intentionally narrower than `pnpm test:e2e` so ordinary
transport, command-surface, interface, and dependency-advisory drift is caught
without turning every pull request into a full release pipeline.

## Interface and route-map checks

HTTP route definitions are exported from `apps/mimir-api/src/server.ts`.
`test:interface-docs` verifies that `documentation/reference/interfaces.md`
lists every exported HTTP route. If the local ignored `.codesight/routes.md`
file exists, the same test also verifies that it contains every route.

Use these scripts for local Codesight artifacts:

```bash
corepack pnpm codesight:routes
corepack pnpm codesight:routes:check
```

Do not manually maintain `.codesight/routes.md`; regenerate it from source.

## Security audit policy

`security:audit` wraps `pnpm audit --audit-level moderate --json` and applies a
small, tested allowlist from `scripts/audit-security.mjs`. Unknown advisories
fail the command.

The only current allowed advisory is `GHSA-w5hq-g745-h8pq` for the transitive
`@voltagent/core 2.7.x -> uuid 9.0.1` dependency path. Keep this exception
narrow and remove it when VoltAgent publishes a compatible patched dependency.

## Canonical docs

- `documentation/testing/testing-strategy.md`

## Evidence status

### Verified facts

- This README is based on tracked files under `tests/e2e` and `runtimes/local_experts/tests`

### Assumptions

- None

### TODO gaps

- If unit tests, a broader release pipeline, or new advisory exceptions are
  added, update this README and `documentation/testing/testing-strategy.md`
