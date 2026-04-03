# Vendored Local Experts Runtime

This folder vendors the runtime-critical Python modules from the standalone
`local-experts` repository so `multi-agent-brain` can become self-contained.

Purpose:

- preserve the proven coding-domain safety and escalation logic
- keep the coding runtime inside this repository
- make later bridge/adaptation work incremental instead of cross-repo

What is intentionally included:

- coding-domain orchestration and escalation control
- deterministic LLM phase orchestration
- patch safety gates and rollback helpers
- local MCP/FastMCP entrypoint
- safety regression tests
- coordination policy reference

What is intentionally excluded:

- repo-local `.gitconfig`
- Windows launcher batch file
- non-runtime helper scripts

Notes:

- imports were converted to package-relative form so this runtime can live under
  `runtimes/local_experts` without external path assumptions
- this runtime is now the active coding runtime used through the
  `CodingDomainController` and the Node-to-Python bridge inside
  `multi-agent-brain`
- the runtime is invoked as a bounded worker, not as the outer application host
- the current local coding model path is Docker Model Runner backed and uses the
  repository's configured coding role

Suggested Python dependencies:

- `fastmcp`
- `httpx`
- `pytest`
