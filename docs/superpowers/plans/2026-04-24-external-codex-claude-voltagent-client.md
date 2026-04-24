# External Codex And Claude VoltAgent Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone external client package that lets Codex and Claude use VoltAgent skills, subagents, and paid-model quality directly while calling Mimir only for memory, retrieval, local execution, and governed memory workflows.

**Architecture:** The implementation lives outside the Mimir repo in a standalone TypeScript package at `F:\Dev\scripts\codex-claude-voltagent-client`. The package exposes a narrow `MimirCommandAdapter`, a client-local VoltAgent runtime with explicit Workspace skill behavior, a router that decides when to stay client-local versus call Mimir, and client entrypoints for Codex and Claude. Mimir remains a backend dependency over MCP; no client Workspace or `workspace_*` feature is proxied through Mimir.

**Tech Stack:** TypeScript, Node.js, pnpm, `@voltagent/core`, `@modelcontextprotocol/sdk`, `zod`, `lru-cache`, `vitest`

---

### Task 1: Scaffold the standalone client package and config schema

**Files:**
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\package.json`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\tsconfig.json`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\vitest.config.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\config\schema.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\config\load-client-config.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\tests\config\load-client-config.test.ts`

- [ ] **Step 1: Write the failing config test and package scaffold**

```json
// F:\Dev\scripts\codex-claude-voltagent-client\package.json
{
  "name": "codex-claude-voltagent-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "@voltagent/core": "^2.7.2",
    "lru-cache": "^11.1.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\tests\config\load-client-config.test.ts
import { describe, expect, it } from "vitest";
import { loadClientConfig } from "../../src/config/load-client-config.js";

describe("loadClientConfig", () => {
  it("requires explicit Mimir MCP command and skill roots", () => {
    expect(() =>
      loadClientConfig({
        mimir: { serverCommand: [], serverArgs: [] },
        skills: { rootPaths: [] },
        models: { primary: "openai/gpt-4.1-mini" }
      })
    ).toThrow(/serverCommand/i);
  });

  it("accepts explicit Mimir MCP command and skill roots", () => {
    const config = loadClientConfig({
      mimir: {
        serverCommand: ["mimir"],
        serverArgs: ["mcp"],
        transport: "stdio"
      },
      skills: {
        rootPaths: ["C:/Users/vikel/.codex/skills", "F:/Dev/skills"]
      },
      models: {
        primary: "openai/gpt-4.1-mini",
        fallback: ["anthropic/claude-sonnet-4"]
      }
    });

    expect(config.mimir.serverCommand).toEqual(["mimir"]);
    expect(config.skills.rootPaths).toHaveLength(2);
    expect(config.models.fallback).toEqual(["anthropic/claude-sonnet-4"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
pnpm test -- tests/config/load-client-config.test.ts
```

Expected: FAIL with module-not-found or missing export errors for `loadClientConfig`.

- [ ] **Step 3: Write minimal config schema and loader**

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\src\config\schema.ts
import { z } from "zod";

export const clientConfigSchema = z.object({
  mimir: z.object({
    serverCommand: z.array(z.string().min(1)).min(1),
    serverArgs: z.array(z.string()).default([]),
    transport: z.enum(["stdio"]).default("stdio")
  }),
  skills: z.object({
    rootPaths: z.array(z.string().min(1)).min(1)
  }),
  models: z.object({
    primary: z.string().min(1),
    fallback: z.array(z.string().min(1)).default([])
  })
});

export type ClientConfig = z.infer<typeof clientConfigSchema>;
```

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\src\config\load-client-config.ts
import { clientConfigSchema, type ClientConfig } from "./schema.js";

export function loadClientConfig(input: unknown): ClientConfig {
  return clientConfigSchema.parse(input);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
pnpm test -- tests/config/load-client-config.test.ts
pnpm typecheck
```

Expected: PASS for the config tests and zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
git add package.json tsconfig.json vitest.config.ts src/config tests/config
git commit -m "feat: scaffold external client config"
```

### Task 2: Implement the narrow Mimir MCP adapter

**Files:**
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\mimir\command-types.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\mimir\mimir-command-adapter.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\mimir\mimir-transport.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\tests\mimir\mimir-command-adapter.test.ts`

- [ ] **Step 1: Write the failing adapter tests**

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\tests\mimir\mimir-command-adapter.test.ts
import { describe, expect, it, vi } from "vitest";
import { MimirCommandAdapter } from "../../src/mimir/mimir-command-adapter.js";

describe("MimirCommandAdapter", () => {
  it("maps retrieval calls onto Mimir MCP tools", async () => {
    const callTool = vi.fn(async (name: string, args: unknown) => {
      expect(name).toBe("assemble_agent_context");
      expect(args).toEqual({ query: "routing" });
      return { contextPacket: { summary: "ok" } };
    });

    const adapter = new MimirCommandAdapter({ callTool });
    const result = await adapter.retrieveContext({ query: "routing" });

    expect(result).toEqual({ contextPacket: { summary: "ok" } });
  });

  it("does not expose Workspace or workspace_* methods", () => {
    const adapter = new MimirCommandAdapter({
      callTool: vi.fn()
    });

    expect("workspaceListSkills" in adapter).toBe(false);
    expect("workspaceActivateSkill" in adapter).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
pnpm test -- tests/mimir/mimir-command-adapter.test.ts
```

Expected: FAIL because `MimirCommandAdapter` does not exist yet.

- [ ] **Step 3: Implement the adapter**

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\src\mimir\command-types.ts
export interface MimirToolCaller {
  (toolName: string, args: Record<string, unknown>): Promise<unknown>;
}
```

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\src\mimir\mimir-command-adapter.ts
import type { MimirToolCaller } from "./command-types.js";

export class MimirCommandAdapter {
  constructor(private readonly deps: { callTool: MimirToolCaller }) {}

  retrieveContext(args: { query: string }) {
    return this.deps.callTool("assemble_agent_context", args);
  }

  getContextPacket(args: { nodeId: string }) {
    return this.deps.callTool("get_context_packet", args);
  }

  executeLocalCodingTask(args: Record<string, unknown>) {
    return this.deps.callTool("execute_coding_task", args);
  }

  listLocalAgentTraces(args: Record<string, unknown>) {
    return this.deps.callTool("list_agent_traces", args);
  }

  draftMemoryNote(args: Record<string, unknown>) {
    return this.deps.callTool("draft_note", args);
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
pnpm test -- tests/mimir/mimir-command-adapter.test.ts
```

Expected: PASS with the narrow adapter surface only.

- [ ] **Step 5: Commit**

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
git add src/mimir tests/mimir
git commit -m "feat: add narrow Mimir MCP adapter"
```

### Task 3: Implement the client-local VoltAgent runtime with safe Workspace skill behavior

**Files:**
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\runtime\client-voltagent-runtime.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\runtime\create-client-workspace.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\runtime\workspace-skill-policy.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\tests\runtime\client-voltagent-runtime.test.ts`

- [ ] **Step 1: Write the failing runtime tests**

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\tests\runtime\client-voltagent-runtime.test.ts
import { describe, expect, it } from "vitest";
import { buildWorkspaceSkillPolicy } from "../../src/runtime/workspace-skill-policy.js";

describe("buildWorkspaceSkillPolicy", () => {
  it("forces explicit workspaceSkillsPrompt when custom message hooks are present", () => {
    const policy = buildWorkspaceSkillPolicy({
      hasCustomOnPrepareMessages: true,
      workspaceSkillsPrompt: undefined
    });

    expect(policy.workspaceSkillsPrompt).toEqual({
      includeAvailable: true,
      includeActivated: true
    });
  });

  it("preserves explicit workspaceSkillsPrompt=false when skills are intentionally disabled", () => {
    const policy = buildWorkspaceSkillPolicy({
      hasCustomOnPrepareMessages: true,
      workspaceSkillsPrompt: false
    });

    expect(policy.workspaceSkillsPrompt).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
pnpm test -- tests/runtime/client-voltagent-runtime.test.ts
```

Expected: FAIL because the runtime policy helpers do not exist yet.

- [ ] **Step 3: Implement the runtime policy and Workspace creation**

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\src\runtime\workspace-skill-policy.ts
export function buildWorkspaceSkillPolicy(input: {
  hasCustomOnPrepareMessages: boolean;
  workspaceSkillsPrompt: false | { includeAvailable: true; includeActivated: true } | undefined;
}) {
  if (!input.hasCustomOnPrepareMessages) {
    return { workspaceSkillsPrompt: input.workspaceSkillsPrompt };
  }

  if (input.workspaceSkillsPrompt === false) {
    return { workspaceSkillsPrompt: false };
  }

  return {
    workspaceSkillsPrompt:
      input.workspaceSkillsPrompt ?? {
        includeAvailable: true,
        includeActivated: true
      }
  };
}
```

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\src\runtime\create-client-workspace.ts
import { Workspace } from "@voltagent/core";

export function createClientWorkspace(rootPaths: string[]) {
  return new Workspace({
    skills: {
      rootPaths
    }
  });
}
```

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\src\runtime\client-voltagent-runtime.ts
import { Agent } from "@voltagent/core";
import { createClientWorkspace } from "./create-client-workspace.js";
import { buildWorkspaceSkillPolicy } from "./workspace-skill-policy.js";

export function createClientVoltAgentRuntime(input: {
  model: string;
  skillRootPaths: string[];
  hooks?: { onPrepareMessages?: (...args: unknown[]) => unknown };
}) {
  const workspace = createClientWorkspace(input.skillRootPaths);
  const skillPolicy = buildWorkspaceSkillPolicy({
    hasCustomOnPrepareMessages: Boolean(input.hooks?.onPrepareMessages),
    workspaceSkillsPrompt: undefined
  });

  const agent = new Agent({
    name: "client-primary",
    instructions: "Use local skills when relevant.",
    model: input.model,
    workspace,
    hooks: input.hooks,
    ...skillPolicy
  });

  return { workspace, agent };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
pnpm test -- tests/runtime/client-voltagent-runtime.test.ts
pnpm typecheck
```

Expected: PASS and no TypeScript errors around `Workspace` setup.

- [ ] **Step 5: Commit**

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
git add src/runtime tests/runtime
git commit -m "feat: add client-local voltagent runtime"
```

### Task 4: Implement the task router and ephemeral Mimir read cache

**Files:**
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\router\client-task-router.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\cache\mimir-result-cache.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\tests\router\client-task-router.test.ts`

- [ ] **Step 1: Write the failing router tests**

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\tests\router\client-task-router.test.ts
import { describe, expect, it } from "vitest";
import { classifyTaskRoute } from "../../src/router/client-task-router.js";

describe("classifyTaskRoute", () => {
  it("routes durable retrieval to Mimir", () => {
    expect(
      classifyTaskRoute({
        needsDurableMemory: true,
        needsLocalExecution: false,
        needsWorkspaceSkill: false
      })
    ).toBe("mimir-retrieval");
  });

  it("routes skill work to client-local VoltAgent", () => {
    expect(
      classifyTaskRoute({
        needsDurableMemory: false,
        needsLocalExecution: false,
        needsWorkspaceSkill: true
      })
    ).toBe("client-skill");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
pnpm test -- tests/router/client-task-router.test.ts
```

Expected: FAIL because the router module does not exist yet.

- [ ] **Step 3: Implement the router and cache**

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\src\router\client-task-router.ts
export function classifyTaskRoute(input: {
  needsDurableMemory: boolean;
  needsLocalExecution: boolean;
  needsWorkspaceSkill: boolean;
  needsGovernedWrite?: boolean;
}) {
  if (input.needsGovernedWrite) return "mimir-memory-write";
  if (input.needsLocalExecution) return "mimir-local-execution";
  if (input.needsDurableMemory) return "mimir-retrieval";
  if (input.needsWorkspaceSkill) return "client-skill";
  return "client-paid-runtime";
}
```

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\src\cache\mimir-result-cache.ts
import { LRUCache } from "lru-cache";

export function createMimirResultCache() {
  return new LRUCache<string, unknown>({
    max: 128,
    ttl: 1000 * 30
  });
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
pnpm test -- tests/router/client-task-router.test.ts
```

Expected: PASS with explicit route classification.

- [ ] **Step 5: Commit**

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
git add src/router src/cache tests/router
git commit -m "feat: add client routing and Mimir read cache"
```

### Task 5: Add client entrypoints for Codex and Claude and guard the workflow boundary

**Files:**
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\entrypoints\create-codex-runtime.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\entrypoints\create-claude-runtime.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\src\runtime\workflow-policy.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\tests\entrypoints\client-entrypoints.test.ts`

- [ ] **Step 1: Write the failing entrypoint and workflow-boundary tests**

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\tests\entrypoints\client-entrypoints.test.ts
import { describe, expect, it } from "vitest";
import { assertWorkflowMemoryBoundary } from "../../src/runtime/workflow-policy.js";

describe("workflow boundary", () => {
  it("rejects attempts to treat VoltAgent workflow memory as durable governed memory", () => {
    expect(() =>
      assertWorkflowMemoryBoundary({
        workflowMemoryAuthority: "durable-governed"
      })
    ).toThrow(/workflow memory/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
pnpm test -- tests/entrypoints/client-entrypoints.test.ts
```

Expected: FAIL because the workflow policy module does not exist yet.

- [ ] **Step 3: Implement entrypoints and workflow policy**

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\src\runtime\workflow-policy.ts
export function assertWorkflowMemoryBoundary(input: {
  workflowMemoryAuthority: "client-operational" | "durable-governed";
}) {
  if (input.workflowMemoryAuthority !== "client-operational") {
    throw new Error(
      "VoltAgent workflow memory is client-operational only and cannot replace governed durable memory."
    );
  }
}
```

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\src\entrypoints\create-codex-runtime.ts
import { createClientVoltAgentRuntime } from "../runtime/client-voltagent-runtime.js";

export function createCodexRuntime(config: {
  model: string;
  skillRootPaths: string[];
}) {
  return createClientVoltAgentRuntime(config);
}
```

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\src\entrypoints\create-claude-runtime.ts
import { createClientVoltAgentRuntime } from "../runtime/client-voltagent-runtime.js";

export function createClaudeRuntime(config: {
  model: string;
  skillRootPaths: string[];
}) {
  return createClientVoltAgentRuntime(config);
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
pnpm test -- tests/entrypoints/client-entrypoints.test.ts
pnpm typecheck
```

Expected: PASS and the workflow boundary is enforced in code.

- [ ] **Step 5: Commit**

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
git add src/entrypoints src/runtime tests/entrypoints
git commit -m "feat: add client entrypoints and workflow boundary"
```

### Task 6: Add docs, smoke scripts, and operator verification

**Files:**
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\README.md`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\docs\mimir-boundary.md`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\examples\codex-basic.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\examples\claude-basic.ts`
- Create: `F:\Dev\scripts\codex-claude-voltagent-client\tests\smoke\boundary-smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\tests\smoke\boundary-smoke.test.ts
import { describe, expect, it } from "vitest";
import { classifyTaskRoute } from "../../src/router/client-task-router.js";

describe("boundary smoke", () => {
  it("keeps workspace skill work client-local and durable writes on Mimir", () => {
    expect(
      classifyTaskRoute({
        needsDurableMemory: false,
        needsLocalExecution: false,
        needsWorkspaceSkill: true
      })
    ).toBe("client-skill");

    expect(
      classifyTaskRoute({
        needsDurableMemory: false,
        needsLocalExecution: false,
        needsWorkspaceSkill: false,
        needsGovernedWrite: true
      })
    ).toBe("mimir-memory-write");
  });
});
```

- [ ] **Step 2: Run test to verify it passes against current code, then add docs**

Run:

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
pnpm test -- tests/smoke/boundary-smoke.test.ts
```

Expected: PASS. Use this step as the smoke gate before writing public docs.

- [ ] **Step 3: Write usage docs and examples**

```md
<!-- F:\Dev\scripts\codex-claude-voltagent-client\docs\mimir-boundary.md -->
# Mimir Boundary

- Use Mimir for durable memory, retrieval, local coding, and governed writes.
- Use VoltAgent locally for Workspace skills, subagents, and paid-agent quality.
- Do not route `workspace_*` behavior through Mimir.
```

```ts
// F:\Dev\scripts\codex-claude-voltagent-client\examples\codex-basic.ts
import { createCodexRuntime } from "../src/entrypoints/create-codex-runtime.js";

createCodexRuntime({
  model: "openai/gpt-4.1-mini",
  skillRootPaths: ["C:/Users/vikel/.codex/skills"]
});
```

- [ ] **Step 4: Run the full project verification**

Run:

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
pnpm test
pnpm typecheck
pnpm build
```

Expected: all tests pass, typecheck passes, and the package builds cleanly.

- [ ] **Step 5: Commit**

```bash
cd /d F:\Dev\scripts\codex-claude-voltagent-client
git add README.md docs examples tests/smoke
git commit -m "docs: add boundary docs and smoke examples"
```

## Self-review checklist

- Spec coverage:
  - explicit client ownership for Workspace skills: covered in Tasks 3, 4, 6
  - narrow Mimir adapter: covered in Task 2
  - explicit `workspaceSkillsPrompt` handling with custom hooks: covered in Task 3
  - workflow memory stays client-operational only: covered in Task 5
  - Codex and Claude entrypoints: covered in Task 5
- Placeholder scan:
  - no `TODO`, `TBD`, or deferred implementation markers remain
- Type consistency:
  - `MimirCommandAdapter`, `createClientVoltAgentRuntime`, `classifyTaskRoute`, and `assertWorkflowMemoryBoundary` are named consistently across tasks

## Execution notes

- This plan intentionally creates a standalone external workspace, not a package
  inside `F:\Dev\scripts\Mimir\mimir`.
- Keep Mimir integration transport on MCP unless a concrete client limitation
  forces CLI fallback.
- Do not add any `Workspace` or `workspace_*` implementation to Mimir while
  executing this plan.
