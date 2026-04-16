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
- request-field and transport-validation boundaries
- coding transport validation boundaries
- transport adapters for CLI, HTTP, and MCP
- MCP session startup validation
- provider adapter behavior
- Docker AI tool registry discovery, validation, and package-plan behavior
- external-source registry behavior and external-source policy enforcement
- service-boundary regressions

## Commands

```bash
corepack pnpm test:transport
corepack pnpm test:e2e
corepack pnpm test
py -3 -m pytest runtimes/local_experts/tests/test_safety_gate.py -v   # Windows
python3 -m pytest runtimes/local_experts/tests/test_safety_gate.py -v # macOS/Linux
```

## Canonical docs

- `documentation/testing/testing-strategy.md`

## Evidence status

### Verified facts

- This README is based on tracked files under `tests/e2e` and `runtimes/local_experts/tests`

### Assumptions

- None

### TODO gaps

- If unit tests or CI are added, update this README and `documentation/testing/testing-strategy.md`
