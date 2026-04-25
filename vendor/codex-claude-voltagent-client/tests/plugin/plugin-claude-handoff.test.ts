import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureBuiltClientDist } from "../helpers/ensure-built-client-dist.js";

const repoRoot = join(import.meta.dirname, "..", "..");
const pluginRoot = join(repoRoot, "plugins", "codex-voltagent-default");
const tempDirs: string[] = [];

beforeAll(() => {
  ensureBuiltClientDist();
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dirPath = tempDirs.pop();

    if (dirPath) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  }
});

function createTempConfig() {
  const tempDir = mkdtempSync(join(tmpdir(), "codex-voltagent-handoff-"));
  const configPath = join(tempDir, "client-config.json");

  tempDirs.push(tempDir);

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        configVersion: 1,
        mimir: {
          serverCommand: ["node"],
          serverArgs: ["./tests/fixtures/fake-mimir-mcp-server.mjs"],
          transport: "stdio"
        },
        skills: {
          rootPaths: [join(tempDir, "skills")]
        },
        models: {
          primary: "openai/gpt-5-mini",
          fallback: []
        },
        runtime: {
          mode: "voltagent+claude-manual",
          trustedWorkspaceRoots: [join(tempDir, "workspace")]
        },
        claude: {
          enabled: true,
          skillPacks: [
            {
              skillPackId: "debug-core",
              skills: [
                "superpowers:systematic-debugging",
                "superpowers:test-driven-development"
              ]
            }
          ],
          profiles: [
            {
              profileId: "debug-specialist",
              roleId: "debug_specialist",
              skillPackId: "debug-core",
              model: "anthropic/claude-sonnet-4-20250514",
              fallback: ["openai/gpt-5-mini"],
              escalationReasons: ["test-failure", "runtime-regression"],
              outputMode: "structured",
              timeouts: {
                totalMs: 30000,
                modelMs: 20000
              },
              retries: 1
            }
          ]
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return configPath;
}

function runHandoffScript(args: string[]) {
  return execFileSync(
    process.execPath,
    [join(pluginRoot, "scripts", "claude-handoff.mjs"), ...args],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );
}

describe("repo-local Codex Claude handoff", () => {
  it("emits a deterministic manual Claude handoff for an explicit profile", () => {
    const configPath = createTempConfig();

    const stdout = runHandoffScript([
      "--config",
      configPath,
      "--profile",
      "debug-specialist",
      "--reason",
      "test-failure",
      "--task-summary",
      "Investigate why the new integration tests are failing.",
      "--repo-context",
      "Repository is in feature/codex-default-voltagent.",
      "--relevant-file",
      "src/runtime/runtime-ownership.ts",
      "--relevant-file",
      "tests/plugin/plugin-composition.test.ts"
    ]);

    const handoff = JSON.parse(stdout);

    expect(handoff).toMatchObject({
      schemaVersion: 1,
      escalationReason: "test-failure",
      profileId: "debug-specialist",
      roleId: "debug_specialist",
      skillPackId: "debug-core",
      expectedOutputSchema: "claude_profile_structured_response_v1",
      recursion: {
        currentDepth: 1,
        maxDepth: 1,
        allowFurtherClaudeEscalation: false
      }
    });
    expect(handoff.skillPack.skills).toEqual([
      "superpowers:systematic-debugging",
      "superpowers:test-driven-development"
    ]);
    expect(handoff.model).toEqual({
      primary: "anthropic/claude-sonnet-4-20250514",
      fallback: ["openai/gpt-5-mini"]
    });
    expect(handoff.input.relevantFiles).toEqual([
      "src/runtime/runtime-ownership.ts",
      "tests/plugin/plugin-composition.test.ts"
    ]);
  });

  it("rejects escalation reasons that are not allowed by the selected profile", () => {
    const configPath = createTempConfig();

    expect(() =>
      runHandoffScript([
        "--config",
        configPath,
        "--profile",
        "debug-specialist",
        "--reason",
        "pre-release-review",
        "--task-summary",
        "Investigate why the new integration tests are failing.",
        "--repo-context",
        "Repository is in feature/codex-default-voltagent."
      ])
    ).toThrow(/not allowed/i);
  });

  it("rejects recursive Claude escalation depths greater than one", () => {
    const configPath = createTempConfig();

    expect(() =>
      runHandoffScript([
        "--config",
        configPath,
        "--profile",
        "debug-specialist",
        "--reason",
        "test-failure",
        "--task-summary",
        "Investigate why the new integration tests are failing.",
        "--repo-context",
        "Repository is in feature/codex-default-voltagent.",
        "--escalation-depth",
        "2"
      ])
    ).toThrow(/depth must be 1/i);
  });
});
