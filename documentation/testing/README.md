# tests

Tracked tests are concentrated in `tests/e2e` plus the vendored Python runtime test in `runtimes/local_experts/tests`.

## Node end-to-end suites

- context authority and corpus boundaries
- namespace browse/read surfaces
- derived representation regeneration
- retrieval traces and strategy behavior
- hierarchical retrieval
- import pipeline behavior
- session archives
- transport adapters for CLI, HTTP, and MCP
- provider adapter behavior
- service-boundary regressions

## Commands

```bash
pnpm test:transport
pnpm test:e2e
pnpm test
python -m pytest runtimes/local_experts/tests/test_safety_gate.py -v
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
