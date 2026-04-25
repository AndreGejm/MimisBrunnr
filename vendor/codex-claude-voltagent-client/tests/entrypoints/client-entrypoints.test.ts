import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/runtime/client-voltagent-runtime.js", () => ({
  createClientVoltAgentRuntime: vi.fn()
}));

import * as clientRuntimeModule from "../../src/runtime/client-voltagent-runtime.js";
import { createClaudeRuntime } from "../../src/entrypoints/create-claude-runtime.js";
import { createCodexRuntime } from "../../src/entrypoints/create-codex-runtime.js";
import { assertWorkflowMemoryBoundary } from "../../src/runtime/workflow-policy.js";

afterEach(() => {
  vi.clearAllMocks();
});

function getCreateClientVoltAgentRuntimeMock() {
  return vi.mocked(clientRuntimeModule.createClientVoltAgentRuntime);
}

describe("assertWorkflowMemoryBoundary", () => {
  it("accepts client-operational workflow memory", () => {
    expect(() =>
      assertWorkflowMemoryBoundary({
        workflowMemoryAuthority: "client-operational"
      })
    ).not.toThrow();
  });

  it("rejects durable-governed workflow memory with a clear workflow-memory error", () => {
    expect(() =>
      assertWorkflowMemoryBoundary({
        workflowMemoryAuthority: "durable-governed"
      })
    ).toThrowError(/workflow memory/i);

    expect(() =>
      assertWorkflowMemoryBoundary({
        workflowMemoryAuthority: "durable-governed"
      })
    ).toThrowError(/durable-governed/i);
  });
});

describe("createCodexRuntime", () => {
  it("returns the existing client runtime for safe workflow memory and strips the boundary field before delegation", () => {
    const runtimeInput = {
      model: "openai/gpt-4.1-mini",
      skillRootPaths: ["/skills/codex"],
      hooks: {},
      workspaceSkillsPrompt: false
    };
    const input = {
      ...runtimeInput,
      workflowMemoryAuthority: "client-operational" as const
    };
    const expectedRuntime =
      {
        workspace: {},
        agent: {}
      } as ReturnType<typeof clientRuntimeModule.createClientVoltAgentRuntime>;
    const createClientVoltAgentRuntime = getCreateClientVoltAgentRuntimeMock();

    createClientVoltAgentRuntime.mockReturnValue(expectedRuntime);

    expect(createCodexRuntime(input)).toBe(expectedRuntime);
    expect(createClientVoltAgentRuntime).toHaveBeenCalledOnce();
    expect(createClientVoltAgentRuntime).toHaveBeenCalledWith(runtimeInput);
  });

  it("rejects durable-governed workflow memory before delegating to the client runtime", () => {
    const input = {
      model: "openai/gpt-4.1-mini",
      skillRootPaths: ["/skills/codex"],
      workflowMemoryAuthority: "durable-governed" as const
    };
    const createClientVoltAgentRuntime = getCreateClientVoltAgentRuntimeMock();

    expect(() => createCodexRuntime(input)).toThrowError(/durable-governed/i);
    expect(createClientVoltAgentRuntime).not.toHaveBeenCalled();
  });
});

describe("createClaudeRuntime", () => {
  it("returns the existing client runtime for safe workflow memory and strips the boundary field before delegation", () => {
    const runtimeInput = {
      model: "anthropic/claude-sonnet-4-20250514",
      skillRootPaths: ["/skills/claude"],
      hooks: {},
      workspaceSkillsPrompt: false
    };
    const input = {
      ...runtimeInput,
      workflowMemoryAuthority: "client-operational" as const
    };
    const expectedRuntime =
      {
        workspace: {},
        agent: {}
      } as ReturnType<typeof clientRuntimeModule.createClientVoltAgentRuntime>;
    const createClientVoltAgentRuntime = getCreateClientVoltAgentRuntimeMock();

    createClientVoltAgentRuntime.mockReturnValue(expectedRuntime);

    expect(createClaudeRuntime(input)).toBe(expectedRuntime);
    expect(createClientVoltAgentRuntime).toHaveBeenCalledOnce();
    expect(createClientVoltAgentRuntime).toHaveBeenCalledWith(runtimeInput);
  });

  it("rejects durable-governed workflow memory before delegating to the client runtime", () => {
    const input = {
      model: "anthropic/claude-sonnet-4-20250514",
      skillRootPaths: ["/skills/claude"],
      workflowMemoryAuthority: "durable-governed" as const
    };
    const createClientVoltAgentRuntime = getCreateClientVoltAgentRuntimeMock();

    expect(() => createClaudeRuntime(input)).toThrowError(/durable-governed/i);
    expect(createClientVoltAgentRuntime).not.toHaveBeenCalled();
  });
});
