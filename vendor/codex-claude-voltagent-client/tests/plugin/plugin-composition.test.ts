import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
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

function createTempSkillRoot(rootPath: string): string {
  const skillRoot = join(rootPath, "skills");
  const skillDir = join(skillRoot, "sample-skill");

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: Sample Skill
description: Test composed runtime probing
---
Use the sample skill instructions.
`,
    "utf8"
  );

  return skillRoot;
}

function createTempConfig() {
  const tempDir = mkdtempSync(join(tmpdir(), "codex-voltagent-plugin-compose-"));
  const configPath = join(tempDir, "client-config.json");
  const workspaceRoot = join(tempDir, "workspace");
  const stateRoot = join(tempDir, "state");
  const skillRoot = createTempSkillRoot(tempDir);

  tempDirs.push(tempDir);

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        configVersion: 1,
        mimir: {
          serverCommand: [process.execPath],
          serverArgs: [
            join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs")
          ],
          transport: "stdio"
        },
        skills: {
          rootPaths: [skillRoot]
        },
        models: {
          primary: "openai/gpt-5-mini",
          fallback: []
        },
        runtime: {
          mode: "voltagent-default",
          trustedWorkspaceRoots: [workspaceRoot]
        },
        claude: {
          enabled: false,
          skillPacks: [],
          profiles: []
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    configPath,
    workspaceRoot,
    stateRoot
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

describe("repo-local Codex plugin composition probes", () => {
  it("lets status probe the real composed client runtime and release ownership afterwards", () => {
    const { configPath, workspaceRoot, stateRoot } = createTempConfig();

    const stdout = runPluginScript("status.mjs", [
      "--config",
      configPath,
      "--workspace",
      workspaceRoot,
      "--probe-runtime",
      "--state-root",
      stateRoot
    ]);

    const status = JSON.parse(stdout);
    const ownershipDir = join(stateRoot, "runtime-ownership");

    expect(status.runtimeHealth).toBe("ready");
    expect(status.mimirConnection).toBe("connected");
    expect(status.probe).toMatchObject({
      ok: true,
      ownershipStatus: "acquired",
      discoveredSkillCount: 1
    });
    expect(readFileSync(configPath, "utf8")).toContain("voltagent-default");
    expect(
      !existsSync(ownershipDir) || readdirSync(ownershipDir).length === 0
    ).toBe(true);
  });

  it("lets doctor probe the real composed client runtime and report a passing composition check", () => {
    const { configPath, workspaceRoot, stateRoot } = createTempConfig();

    const stdout = runPluginScript("doctor.mjs", [
      "--config",
      configPath,
      "--workspace",
      workspaceRoot,
      "--probe-runtime",
      "--state-root",
      stateRoot
    ]);

    const report = JSON.parse(stdout);

    expect(report.ok).toBe(true);
    expect(report.status.runtimeHealth).toBe("ready");
    expect(report.status.mimirConnection).toBe("connected");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "client_composition",
          status: "ok"
        })
      ])
    );
  });
});
