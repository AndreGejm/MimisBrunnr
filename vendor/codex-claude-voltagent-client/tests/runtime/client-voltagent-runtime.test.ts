import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, Workspace, type AgentHooks } from "@voltagent/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClientVoltAgentRuntime } from "../../src/runtime/client-voltagent-runtime.js";
import { createClientWorkspace } from "../../src/runtime/create-client-workspace.js";
import { buildWorkspaceSkillPolicy } from "../../src/runtime/workspace-skill-policy.js";

type PrepareMessagesHook = NonNullable<AgentHooks["onPrepareMessages"]>;
type PrepareMessagesArgs = Parameters<PrepareMessagesHook>[0];

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dirPath = tempDirs.pop();
    if (dirPath) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  }

  vi.restoreAllMocks();
});

function createTempSkillRoot(): string {
  const rootPath = mkdtempSync(join(tmpdir(), "client-voltagent-runtime-"));
  const skillDir = join(rootPath, "sample-skill");

  mkdirSync(skillDir);
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: Sample Skill
description: Test workspace prompt injection
---
Use the sample skill instructions.
`
  );

  tempDirs.push(rootPath);
  return rootPath;
}

function normalizePathForAssertion(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/^\/(?=[A-Za-z]:)/, "");
}

async function activateFirstDiscoveredSkill(workspace: Workspace) {
  const discoveredSkills = await workspace.skills?.discoverSkills();
  const matchingSkills =
    discoveredSkills?.filter((skill) => skill.name === "Sample Skill") ?? [];
  const discoveredSkill = matchingSkills[0];

  expect(matchingSkills).toHaveLength(1);

  expect(discoveredSkill).toBeDefined();

  const activatedSkill = discoveredSkill
    ? await workspace.skills?.activateSkill(discoveredSkill.id)
    : null;

  expect(activatedSkill?.name).toBe("Sample Skill");

  return {
    matchingSkills,
    discoveredSkill,
    activatedSkill
  };
}

function createPrepareMessagesArgs(
  agent: Agent,
  messages: PrepareMessagesArgs["messages"]
): PrepareMessagesArgs {
  return {
    agent,
    messages,
    context: {} as PrepareMessagesArgs["context"]
  };
}

describe("buildWorkspaceSkillPolicy", () => {
  it("switches to explicit Workspace hook handling when custom message hooks are present", () => {
    const policy = buildWorkspaceSkillPolicy({
      hasCustomOnPrepareMessages: true,
      workspaceSkillsPrompt: undefined
    });

    expect(policy.workspaceSkillsPrompt).toBe(false);
    expect(policy.explicitWorkspaceSkillsPromptHook).toBe(true);
  });

  it("preserves explicit workspaceSkillsPrompt=false when skills are intentionally disabled", () => {
    const policy = buildWorkspaceSkillPolicy({
      hasCustomOnPrepareMessages: true,
      workspaceSkillsPrompt: false
    });

    expect(policy.workspaceSkillsPrompt).toBe(false);
    expect(policy.explicitWorkspaceSkillsPromptHook).toBeUndefined();
  });

  it("preserves boolean workspaceSkillsPrompt values when no custom hook is present", () => {
    const policy = buildWorkspaceSkillPolicy({
      hasCustomOnPrepareMessages: false,
      workspaceSkillsPrompt: true
    });

    expect(policy.workspaceSkillsPrompt).toBe(true);
  });
});

describe("createClientWorkspace", () => {
  it("creates a VoltAgent Workspace that can discover and activate skills from disk-backed root paths", async () => {
    const skillRootPath = createTempSkillRoot();
    const workspace = createClientWorkspace([skillRootPath]);
    const { matchingSkills, discoveredSkill } = await activateFirstDiscoveredSkill(workspace);
    const prompt = await workspace.skills?.buildPrompt();

    expect(workspace).toBeInstanceOf(Workspace);
    expect(matchingSkills).toHaveLength(1);
    expect(normalizePathForAssertion(discoveredSkill?.path ?? "")).toContain(
      normalizePathForAssertion(skillRootPath)
    );
    expect(prompt).toContain("Available skills:");
    expect(prompt).toContain("Activated skills:");
    expect(prompt).toContain("Sample Skill");
  });
});

describe("createClientVoltAgentRuntime", () => {
  it("explicitly preserves Workspace skill prompt injection behavior when custom onPrepareMessages is present", async () => {
    const skillRootPath = createTempSkillRoot();
    const customTailMessage: PrepareMessagesArgs["messages"][number] = {
      id: "custom-tail",
      role: "system",
      parts: [{ type: "text", text: "custom hook ran" }]
    };
    const customTransform: PrepareMessagesHook = async ({ messages }) => ({
      messages: [...messages, customTailMessage]
    });
    const runtime = createClientVoltAgentRuntime({
      model: "openai/gpt-4.1-mini",
      skillRootPaths: [skillRootPath],
      hooks: {
        onPrepareMessages: customTransform
      }
    });
    await activateFirstDiscoveredSkill(runtime.workspace);
    const baseMessages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Use a workspace skill." }]
      }
    ] as PrepareMessagesArgs["messages"];
    const args = createPrepareMessagesArgs(runtime.agent, baseMessages);
    const actual = await runtime.agent.hooks.onPrepareMessages?.(args);
    const firstMessageText =
      actual?.messages?.[0]?.parts?.find((part) => part.type === "text")?.text ?? "";

    expect(runtime.workspace).toBeInstanceOf(Workspace);
    expect(runtime.agent).toBeInstanceOf(Agent);
    expect(actual?.messages?.[0]?.role).toBe("system");
    expect(firstMessageText).toContain("<workspace_skills>");
    expect(firstMessageText).toContain("Activated skills:");
    expect(firstMessageText).toContain("Sample Skill");
    expect(actual?.messages?.at(-1)).toEqual(customTailMessage);
  });

  it("preserves workspaceSkillsPrompt=false when skills are intentionally disabled", async () => {
    const skillRootPath = createTempSkillRoot();
    const customTailMessage: PrepareMessagesArgs["messages"][number] = {
      id: "custom-tail",
      role: "system",
      parts: [{ type: "text", text: "custom hook ran" }]
    };
    const customTransform: PrepareMessagesHook = async ({ messages }) => ({
      messages: [...messages, customTailMessage]
    });
    const runtime = createClientVoltAgentRuntime({
      model: "openai/gpt-4.1-mini",
      skillRootPaths: [skillRootPath],
      hooks: {
        onPrepareMessages: customTransform
      },
      workspaceSkillsPrompt: false
    });
    await activateFirstDiscoveredSkill(runtime.workspace);
    const baseMessages = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Do not auto-inject skills." }]
      }
    ] as PrepareMessagesArgs["messages"];
    const args = createPrepareMessagesArgs(runtime.agent, baseMessages);
    const actual = await runtime.agent.hooks.onPrepareMessages?.(args);

    expect(actual).toEqual(await customTransform(args));
    expect(actual?.messages?.[0]?.role).toBe("user");
    expect(actual?.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: expect.stringContaining("<workspace_skills>")
            })
          ])
        })
      ])
    );
  });
});
