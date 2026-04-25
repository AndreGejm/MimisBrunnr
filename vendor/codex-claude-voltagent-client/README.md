# codex-claude-voltagent-client

Thin client boundary for pairing local VoltAgent workspace skills with Mimir retrieval and governed-write tooling.

## What this package owns

- `createCodexRuntime` and `createClaudeRuntime` build a local VoltAgent runtime from an explicit model and one or more skill roots.
- `createCodexClient` and `createClaudeClient` compose validated config, a real stdio MCP client, the narrow Mimir adapter, and the local VoltAgent runtime into one usable client surface.
- `loadClientConfig` validates the explicit client config for Mimir transport, skill roots, and model selection.
- `MimirCommandAdapter` exposes the narrow Mimir command surface this client is expected to call: retrieval, context packets, local coding tasks, agent traces, and draft-note writes.

This package does not widen the runtime boundary. It keeps Workspace skills local to VoltAgent and keeps durable memory concerns on the Mimir side.

## Codex activation

The stable **primary activation path** is **native Codex skill discovery**, not plugin lifecycle automation.

- install the top-level `skills/` tree into `~/.codex/skills/voltagent-default`
- restart Codex
- let Codex discover the VoltAgent skills the same way it discovers Superpowers

See [`.codex/INSTALL.md`](./.codex/INSTALL.md) for the canonical native Codex skill discovery install flow.
See [docs/codex-default-activation.md](./docs/codex-default-activation.md) for the stable default workflow, route policy, and Claude escalation rules.

For a single onboarding command that installs native skills, bootstraps
`client-config.json`, and runs a readiness doctor, use `pnpm codex:onboard`.
Run that package command from this repository root and pass `--workspace` when
the target workspace is elsewhere. For a standalone system-level readiness
check, use `pnpm codex:doctor` with the same `--workspace` rule.
For the packaged fresh-machine verification path, use `pnpm codex:smoke`.

The repo-local and home-local plugin shell remains available, but only as an **optional** diagnostics and bootstrap surface.

## Boundary summary

- Use Mimir for durable memory retrieval, local coding tasks, and governed writes.
- Use the local VoltAgent runtime for Workspace skills, subagents, and paid-agent quality work.
- Do not route `workspace_*` behavior through Mimir.
- Workspace-skill-only work stays `client-skill`.
- Governed writes route to `mimir-memory-write`.

The detailed boundary notes live in [docs/mimir-boundary.md](./docs/mimir-boundary.md).

## Repo-local plugin shell

The repository also carries a repo-local plugin shell at
`plugins/codex-voltagent-default` for reviewing the Codex-side default-runtime
integration and for explicitly syncing that shell into a home-local Codex plugin
directory.

This is the **plugin shell install (optional)** path. Native Codex skill discovery is the primary activation path.

If you want a single onboarding command instead of running install and bootstrap
steps separately, prefer the repo-level `pnpm codex:onboard` flow. It keeps the
plugin shell optional and treats native Codex skill discovery as the primary
activation path.

Current scope:

- diagnostics-only review scaffolding
- `status.mjs` for an explicit config and workspace snapshot
- `doctor.mjs` for deterministic readiness checks
- `enable.mjs` and `disable.mjs` for explicit mode toggling in the client config
- `init-client-config.mjs` for bootstrapping a valid client config in the current workspace
- `bootstrap-default-runtime.mjs` for installing the home-local plugin shell and initializing the workspace config in one step
- `profiles.mjs` for resolved Claude profile inspection
- `route-preview.mjs` for deterministic route previews, including Claude auto-selection previews
- `claude-handoff.mjs` for explicit manual Claude role/skill handoff generation
- `claude-auto-handoff.mjs` for deterministic profile selection by escalation reason
- `install-home-plugin.mjs` for syncing the shell into a home-local plugin and marketplace entry that point back to the current checkout
- optional `--probe-runtime` on `status.mjs` and `doctor.mjs` to compose the real client runtime against the current built package

Current non-goals:

- no automatic startup hook
- no claimed background bootstrap behavior
- no implicit Codex bootstrap beyond explicit installation and invocation

Run `pnpm build` before using `--probe-runtime` or `install-home-plugin.mjs`,
because both paths require the built `dist/` client surface.

The home-local install writes a `client-root.json` pointer inside the installed
plugin so the home-local shell can resolve back to this repository checkout.
Re-run the installer if you move the repository.

You can run the installer directly or through `pnpm plugin:install-home`.

To bootstrap a valid client config in the current workspace:

```powershell
pnpm build
node .\plugins\codex-voltagent-default\scripts\init-client-config.mjs
```

This writes `.\client-config.json`, trusts the current directory for
`voltagent-default`, seeds the standard Claude profile packs when a Claude
mode is selected, and auto-reads Codex's existing `mcp_servers.mimir` config
when present.

You can also run the same bootstrap through `pnpm plugin:init-config`.

To do the primary install/bootstrap flow in one step:

```powershell
pnpm build
pnpm codex:onboard -- --workspace F:\path\to\target-workspace
```

This single onboarding command installs the native Codex skills, initializes
`client-config.json` in the current workspace, auto-reads Codex's existing
`mcp_servers.mimir` config when present, and runs a readiness doctor.

For a standalone readiness check against the current workspace:

```powershell
pnpm codex:doctor -- --workspace F:\path\to\target-workspace
```

For the packaged smoke verification path that exercises the boundary smoke tests
and a fresh-home onboarding smoke:

```powershell
pnpm codex:smoke
```

Manual `--mimir-command` and `--mimir-arg` overrides still work when you need
to bypass the default Codex config.

To do the home-local install and workspace bootstrap in one step:

```powershell
pnpm build
node .\plugins\codex-voltagent-default\scripts\bootstrap-default-runtime.mjs
```

You can also run the same one-step flow through `pnpm plugin:bootstrap-default`.

This supported default path does not depend on hidden startup hooks or
background runtime boot. If Codex later exposes a stable startup lifecycle,
that can be layered on as an explicit enhancement rather than being required.

## Quick start

The repo examples and consumer integrations should point at the built root export surface under `dist/` after `pnpm build`.
Callers must provide a valid MCP stdio command and args that exist on their machine.

```ts
import { createCodexClient, loadClientConfig } from "./dist/index.js";

const client = await createCodexClient({
  config: loadClientConfig({
    mimir: {
      serverCommand: ["node"],
      serverArgs: ["C:/absolute/path/to/your/mimir-mcp-server.js"],
      transport: "stdio"
    },
    skills: {
      rootPaths: ["C:/Users/you/.codex/skills"]
    },
    models: {
      primary: "openai/gpt-5-mini",
      fallback: ["anthropic/claude-sonnet-4-20250514"]
    }
  }),
  workflowMemoryAuthority: "client-operational"
});

const route = client.classifyTaskRoute({
  needsDurableMemory: true
});
const discoveredSkills =
  await client.runtime.workspace.skills?.discoverSkills();

console.log({
  route,
  agentName: client.runtime.agent.name,
  discoveredSkills: discoveredSkills?.map((skill) => skill.name) ?? []
});

await client.close();
```

If you only need the local VoltAgent runtime, the runtime-only entrypoints still work unchanged:

```ts
import { createCodexRuntime, loadClientConfig } from "./dist/index.js";

const config = loadClientConfig({
  mimir: {
    serverCommand: ["node"],
    serverArgs: ["C:/absolute/path/to/your/mimir-mcp-server.js"],
    transport: "stdio"
  },
  skills: {
    rootPaths: ["C:/Users/you/.codex/skills"]
  },
  models: {
    primary: "openai/gpt-5-mini",
    fallback: ["anthropic/claude-sonnet-4-20250514"]
  }
});

const runtime = createCodexRuntime({
  model: config.models.primary,
  skillRootPaths: config.skills.rootPaths,
  workflowMemoryAuthority: "client-operational"
});

const discoveredSkills = await runtime.workspace.skills?.discoverSkills();

console.log(discoveredSkills?.map((skill) => skill.name) ?? []);
```

The checked-in examples default to a repo-local stdio MCP stub so they run in this repository as-is. Set `MIMIR_EXAMPLE_SERVER_COMMAND` and `MIMIR_EXAMPLE_SERVER_ARGS_JSON` if you want the examples to target a real local Mimir MCP server instead.

## Examples

- [examples/codex-basic.ts](./examples/codex-basic.ts)
- [examples/claude-basic.ts](./examples/claude-basic.ts)

## Current routing contract

The current route classifier resolves tasks in this order:

1. `mimir-memory-write`
2. `mimir-local-execution`
3. `mimir-retrieval`
4. `client-skill`
5. `client-paid-runtime`

That ordering is intentional. Governed writes and durable-memory work stay on the Mimir side first, while Workspace skill work remains local to the client runtime.
