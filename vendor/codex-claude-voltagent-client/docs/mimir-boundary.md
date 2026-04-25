# Mimir and Client Boundary

This package exists to keep the Mimir boundary explicit instead of letting client runtime concerns bleed into governed memory tooling.

Native Codex skill discovery is the stable activation path. Hidden startup hooks
or background bootstrap behavior are not part of the baseline design.

## Use Mimir for

- durable memory retrieval
- local coding execution
- governed writes

These map onto the current Mimir-facing routes:

- `mimir-retrieval`
- `mimir-local-execution`
- `mimir-memory-write`

## Use VoltAgent locally for

- Workspace skills
- subagents
- paid-agent quality work

These stay on the client side of the boundary:

- `client-skill`
- `client-paid-runtime`

## Never route `workspace_*` behavior through Mimir

`workspace_*` behavior is intentionally local. The Mimir adapter in this repo exposes retrieval, local coding, trace, and draft-note methods, but it does not expose Workspace-skill methods.

That boundary is also enforced in the runtime entrypoints:

- `createCodexRuntime`
- `createClaudeRuntime`
- `createCodexClient`
- `createClaudeClient`

Both entrypoints reject `workflowMemoryAuthority: "durable-governed"` because VoltAgent workflow memory must stay `client-operational`.

That runtime entrypoint workflow-memory boundary is covered separately by `tests/entrypoints/client-entrypoints.test.ts`.

## Stable routing expectations

The route classifier currently resolves tasks with this priority:

| Need | Route |
| --- | --- |
| governed write | `mimir-memory-write` |
| local coding execution | `mimir-local-execution` |
| durable memory retrieval | `mimir-retrieval` |
| Workspace skill only | `client-skill` |
| no special routing | `client-paid-runtime` |

The two boundary checks that should not regress are:

1. Workspace-skill work stays `client-skill`.
2. Governed writes route to `mimir-memory-write`.

The routing invariants above are locked by `tests/smoke/boundary-smoke.test.ts`.

The composed client surface is covered by `tests/integration/composed-client-surface.test.ts`, including one real stdio Mimir read path and one local workspace-skill path.

If Codex later exposes a documented, stable startup hook, that can be evaluated
as an optional enhancement. It is not required for the supported default path.
