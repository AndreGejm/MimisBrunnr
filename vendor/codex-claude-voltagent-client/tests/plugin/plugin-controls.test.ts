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

function createTempConfig(overrides: Record<string, unknown> = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "codex-voltagent-plugin-controls-"));
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
          fallback: ["anthropic/claude-sonnet-4-20250514"]
        },
        runtime: {
          mode: "local-only",
          trustedWorkspaceRoots: []
        },
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
              profileId: "debug-specialist",
              roleId: "debug_specialist",
              skillPackId: "debug-core",
              model: "anthropic/claude-sonnet-4-20250514",
              fallback: [],
              escalationReasons: ["test-failure"],
              outputMode: "structured",
              timeouts: {
                totalMs: 20000,
                modelMs: 15000
              },
              retries: 0
            }
          ]
        },
        ...overrides
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    configPath,
    tempDir
  };
}

function runPluginScript(scriptName: string, args: string[]) {
  return execFileSync(
    process.execPath,
    [join(pluginRoot, "scripts", scriptName), ...args],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );
}

describe("repo-local Codex plugin controls", () => {
  it("enables default mode for an explicit trusted workspace", () => {
    const { configPath, tempDir } = createTempConfig();
    const workspaceRoot = join(tempDir, "workspace");

    const stdout = runPluginScript("enable.mjs", [
      "--config",
      configPath,
      "--workspace",
      workspaceRoot
    ]);

    const result = JSON.parse(stdout);
    const savedConfig = JSON.parse(readFileSync(configPath, "utf8"));

    expect(result).toMatchObject({
      ok: true,
      mode: "voltagent-default",
      workspaceRoot
    });
    expect(savedConfig.runtime.mode).toBe("voltagent-default");
    expect(savedConfig.runtime.trustedWorkspaceRoots).toContain(workspaceRoot);
  });

  it("disables default mode without deleting trusted workspace roots", () => {
    const trustedRoot = join(tmpdir(), "trusted-workspace");
    const { configPath } = createTempConfig({
      runtime: {
        mode: "voltagent-default",
        trustedWorkspaceRoots: [trustedRoot]
      }
    });

    const stdout = runPluginScript("disable.mjs", ["--config", configPath]);
    const result = JSON.parse(stdout);
    const savedConfig = JSON.parse(readFileSync(configPath, "utf8"));

    expect(result).toMatchObject({
      ok: true,
      mode: "local-only"
    });
    expect(savedConfig.runtime.mode).toBe("local-only");
    expect(savedConfig.runtime.trustedWorkspaceRoots).toContain(trustedRoot);
  });

  it("prints configured Claude profiles with resolved skill packs", () => {
    const { configPath } = createTempConfig();

    const stdout = runPluginScript("profiles.mjs", ["--config", configPath]);
    const result = JSON.parse(stdout);

    expect(result.enabled).toBe(true);
    expect(result.profiles).toEqual([
      expect.objectContaining({
        profileId: "debug-specialist",
        roleId: "debug_specialist",
        skillPackId: "debug-core",
        skills: ["superpowers:systematic-debugging"]
      })
    ]);
  });

  it("previews route classification from explicit route flags", () => {
    const stdout = runPluginScript("route-preview.mjs", [
      "--needs-governed-write",
      "--needs-workspace-skill"
    ]);

    const result = JSON.parse(stdout);

    expect(result).toEqual({
      input: {
        needsDurableMemory: false,
        needsLocalExecution: false,
        needsWorkspaceSkill: true,
        needsGovernedWrite: true
      },
      route: "mimir-memory-write"
    });
  });

  it("shows the effective Claude escalation route when auto mode selects a unique profile", () => {
    const { configPath } = createTempConfig({
      runtime: {
        mode: "voltagent+claude-auto",
        trustedWorkspaceRoots: [join(tmpdir(), "trusted-workspace")]
      }
    });

    const stdout = runPluginScript("route-preview.mjs", [
      "--config",
      configPath,
      "--reason",
      "test-failure"
    ]);

    const result = JSON.parse(stdout);

    expect(result.route).toBe("client-paid-runtime");
    expect(result.effectiveRoute).toBe("claude-escalation");
    expect(result.claudeAutoSelection).toEqual({
      status: "selected",
      profileId: "debug-specialist",
      roleId: "debug_specialist",
      skillPackId: "debug-core",
      skills: ["superpowers:systematic-debugging"],
      model: {
        primary: "anthropic/claude-sonnet-4-20250514",
        fallback: []
      }
    });
  });
});
