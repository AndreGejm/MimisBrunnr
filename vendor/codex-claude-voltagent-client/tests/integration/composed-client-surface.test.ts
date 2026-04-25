import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexClient } from "../../src/entrypoints/create-codex-client.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dirPath = tempDirs.pop();

    if (dirPath) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  }
});

function createTempSkillRoot(): string {
  const rootPath = mkdtempSync(join(tmpdir(), "composed-client-surface-"));
  const skillDir = join(rootPath, "sample-skill");

  mkdirSync(skillDir);
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: Sample Skill
description: Test composed client workspace access
---
Use the sample skill instructions.
`
  );

  tempDirs.push(rootPath);
  return rootPath;
}

function createConfig(skillRootPath: string) {
  return {
    mimir: {
      serverCommand: [process.execPath],
      serverArgs: [join(import.meta.dirname, "..", "fixtures", "fake-mimir-mcp-server.mjs")],
      transport: "stdio" as const
    },
    skills: {
      rootPaths: [skillRootPath]
    },
    models: {
      primary: "openai/gpt-5-mini",
      fallback: []
    }
  };
}

describe("createCodexClient", () => {
  it("rejects invalid raw config before attempting runtime or MCP composition", async () => {
    await expect(
      createCodexClient({
        config: {
          mimir: {
            serverCommand: [],
            serverArgs: [],
            transport: "stdio"
          },
          skills: {
            rootPaths: ["C:/skills"]
          },
          models: {
            primary: "openai/gpt-5-mini",
            fallback: []
          }
        }
      })
    ).rejects.toThrow();
  });

  it("routes durable-memory reads through a cached real stdio MCP surface", async () => {
    const skillRootPath = createTempSkillRoot();
    const client = await createCodexClient({
      config: createConfig(skillRootPath)
    });

    try {
      expect(client.classifyTaskRoute({ needsDurableMemory: true })).toBe(
        "mimir-retrieval"
      );

      const firstResult = await client.mimir.retrieveContext({
        actor: {
          actorId: "codex",
          actorRole: "retrieval",
          transport: "mcp",
          source: "integration-test",
          requestId: "req-1",
          initiatedAt: "2026-04-24T18:00:00.000Z"
        },
        query: "routing",
        budget: {
          maxTokens: 400,
          maxSources: 3,
          maxRawExcerpts: 1,
          maxSummarySentences: 4
        },
        corpusIds: ["general_notes"]
      });
      const secondResult = await client.mimir.retrieveContext({
        actor: {
          actorId: "codex",
          actorRole: "retrieval",
          transport: "mcp",
          source: "integration-test",
          requestId: "req-1",
          initiatedAt: "2026-04-24T18:00:00.000Z"
        },
        query: "routing",
        budget: {
          maxTokens: 400,
          maxSources: 3,
          maxRawExcerpts: 1,
          maxSummarySentences: 4
        },
        corpusIds: ["general_notes"]
      });

      expect(firstResult).toEqual({
        contextBlock: "context:routing",
        invocationCount: 1
      });
      expect(secondResult).toEqual(firstResult);
    } finally {
      await client.close();
    }
  });

  it("keeps workspace-skill work on the local runtime surface", async () => {
    const skillRootPath = createTempSkillRoot();
    const client = await createCodexClient({
      config: createConfig(skillRootPath)
    });

    try {
      expect(client.classifyTaskRoute({ needsWorkspaceSkill: true })).toBe(
        "client-skill"
      );

      const discoveredSkills =
        await client.runtime.workspace.skills?.discoverSkills();
      const sampleSkill = discoveredSkills?.find(
        (skill) => skill.name === "Sample Skill"
      );

      expect(sampleSkill).toBeDefined();

      const activatedSkill = sampleSkill
        ? await client.runtime.workspace.skills?.activateSkill(sampleSkill.id)
        : undefined;
      const prompt = await client.runtime.workspace.skills?.buildPrompt();

      expect(client.runtime.workspace).toBeDefined();
      expect(client.runtime.agent).toBeDefined();
      expect(activatedSkill?.name).toBe("Sample Skill");
      expect(prompt).toContain("Sample Skill");
    } finally {
      await client.close();
    }
  });
});
