import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function createTempConfig(mode: string = "voltagent+claude-auto") {
  const tempDir = mkdtempSync(join(tmpdir(), "codex-voltagent-auto-handoff-"));
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
          mode,
          trustedWorkspaceRoots: [join(tempDir, "workspace")]
        },
        claude: {
          enabled: true,
          skillPacks: [
            {
              skillPackId: "debug-core",
              skills: ["superpowers:systematic-debugging"]
            },
            {
              skillPackId: "review-core",
              skills: ["superpowers:verification-before-completion"]
            }
          ],
          profiles: [
            {
              profileId: "debug-specialist",
              roleId: "debug_specialist",
              skillPackId: "debug-core",
              model: "anthropic/claude-sonnet-4-20250514",
              fallback: ["openai/gpt-5-mini"],
              escalationReasons: ["test-failure"],
              outputMode: "structured",
              timeouts: {
                totalMs: 30000,
                modelMs: 20000
              },
              retries: 1
            },
            {
              profileId: "release-reviewer",
              roleId: "release_reviewer",
              skillPackId: "review-core",
              model: "anthropic/claude-sonnet-4-20250514",
              fallback: [],
              escalationReasons: ["pre-release-review"],
              outputMode: "structured",
              timeouts: {
                totalMs: 45000,
                modelMs: 30000
              },
              retries: 0
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

function runAutoHandoffScript(args: string[]) {
  return execFileSync(
    process.execPath,
    [join(pluginRoot, "scripts", "claude-auto-handoff.mjs"), ...args],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );
}

describe("repo-local Codex Claude auto handoff", () => {
  it("selects the unique profile allowed for the provided escalation reason", () => {
    const configPath = createTempConfig();

    const stdout = runAutoHandoffScript([
      "--config",
      configPath,
      "--reason",
      "pre-release-review",
      "--task-summary",
      "Review release readiness before tagging.",
      "--repo-context",
      "Repository is in feature/codex-default-voltagent."
    ]);

    const handoff = JSON.parse(stdout);

    expect(handoff.profileId).toBe("release-reviewer");
    expect(handoff.roleId).toBe("release_reviewer");
    expect(handoff.skillPackId).toBe("review-core");
    expect(handoff.skillPack.skills).toEqual([
      "superpowers:verification-before-completion"
    ]);
    expect(handoff.model).toEqual({
      primary: "anthropic/claude-sonnet-4-20250514",
      fallback: []
    });
  });

  it("fails clearly when no profile matches the provided escalation reason", () => {
    const configPath = createTempConfig();

    expect(() =>
      runAutoHandoffScript([
        "--config",
        configPath,
        "--reason",
        "design-ambiguity",
        "--task-summary",
        "Need architectural guidance.",
        "--repo-context",
        "Repository is in feature/codex-default-voltagent."
      ])
    ).toThrow(/no claude profile/i);
  });

  it("fails clearly when multiple profiles claim the same escalation reason", () => {
    const configPath = createTempConfig();
    const duplicateConfigPath = configPath.replace("client-config.json", "duplicate-config.json");
    const baseConfig = JSON.parse(readFileSync(configPath, "utf8"));

    writeFileSync(
      duplicateConfigPath,
      JSON.stringify(
        {
          ...baseConfig,
          claude: {
            enabled: true,
            skillPacks: [
              {
                skillPackId: "debug-core",
                skills: ["superpowers:systematic-debugging"]
              }
            ],
            profiles: [
              {
                profileId: "debug-specialist-a",
                roleId: "debug_specialist",
                skillPackId: "debug-core",
                model: "anthropic/claude-sonnet-4-20250514",
                fallback: [],
                escalationReasons: ["test-failure"],
                outputMode: "structured",
                timeouts: {
                  totalMs: 30000,
                  modelMs: 20000
                },
                retries: 0
              },
              {
                profileId: "debug-specialist-b",
                roleId: "debug_specialist",
                skillPackId: "debug-core",
                model: "anthropic/claude-sonnet-4-20250514",
                fallback: [],
                escalationReasons: ["test-failure"],
                outputMode: "structured",
                timeouts: {
                  totalMs: 30000,
                  modelMs: 20000
                },
                retries: 0
              }
            ]
          }
        },
        null,
        2
      ),
      "utf8"
    );

    expect(() =>
      runAutoHandoffScript([
        "--config",
        duplicateConfigPath,
        "--reason",
        "test-failure",
        "--task-summary",
        "Investigate failing tests.",
        "--repo-context",
        "Repository is in feature/codex-default-voltagent."
      ])
    ).toThrow(/multiple claude profiles/i);
  });

  it("rejects recursive Claude auto handoff depths greater than one", () => {
    const configPath = createTempConfig();

    expect(() =>
      runAutoHandoffScript([
        "--config",
        configPath,
        "--reason",
        "pre-release-review",
        "--task-summary",
        "Review release readiness before tagging.",
        "--repo-context",
        "Repository is in feature/codex-default-voltagent.",
        "--escalation-depth",
        "2"
      ])
    ).toThrow(/depth must be 1/i);
  });
});
