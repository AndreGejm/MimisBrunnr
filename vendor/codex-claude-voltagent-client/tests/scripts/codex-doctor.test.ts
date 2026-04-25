import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dirPath = tempDirs.pop();

    if (dirPath) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  }
});

function createTempDir(prefix: string) {
  const dirPath = mkdtempSync(join(tmpdir(), prefix));

  tempDirs.push(dirPath);

  return dirPath;
}

function runRepoScript(
  scriptPath: string,
  args: string[],
  cwd: string,
  envOverrides: Record<string, string> = {}
) {
  return execFileSync(process.execPath, [join(repoRoot, scriptPath), ...args], {
    cwd,
    env: {
      ...process.env,
      ...envOverrides
    },
    encoding: "utf8"
  });
}

describe("repo-level Codex doctor", () => {
  it("uses workspace defaults and warns when the native skill install is missing", () => {
    const workspaceRoot = createTempDir("codex-voltagent-doctor-workspace-");
    const homeRoot = createTempDir("codex-voltagent-doctor-home-");
    const configPath = join(workspaceRoot, "client-config.json");
    const skillRoot = join(homeRoot, ".codex", "skills");

    mkdirSync(skillRoot, { recursive: true });
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

    const stdout = runRepoScript("scripts/codex-doctor.mjs", [], workspaceRoot, {
      USERPROFILE: homeRoot
    });

    const result = JSON.parse(stdout);

    expect(result.workspaceRoot).toBe(workspaceRoot);
    expect(result.status.activation).toEqual({
      nativeCodexSkillsConfigured: true,
      nativeCodexInstallPresent: false,
      pluginShellPresent: false,
      surface: "native-skills-configured"
    });
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "native_skill_install",
          status: "warning"
        })
      ])
    );
  });
});
