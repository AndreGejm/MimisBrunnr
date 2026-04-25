import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureBuiltClientDist } from "../helpers/ensure-built-client-dist.js";

const repoRoot = join(import.meta.dirname, "..", "..");
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

function createTempDir(prefix: string) {
  const dirPath = mkdtempSync(join(tmpdir(), prefix));

  tempDirs.push(dirPath);

  return dirPath;
}

function createTempCodexHome(prefix: string) {
  const homeRoot = createTempDir(prefix);
  const codexRoot = join(homeRoot, ".codex");

  mkdirSync(codexRoot, { recursive: true });

  return {
    homeRoot,
    codexConfigPath: join(codexRoot, "config.toml")
  };
}

function writeCodexMimirConfig(configPath: string, command: string, args: string[]) {
  const quotedArgs = args.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");

  writeFileSync(
    configPath,
    `model = "gpt-5.4"

[mcp_servers]
[mcp_servers.mimir]
command = '${command.replace(/'/g, "''")}'
args = [${quotedArgs}]
`,
    "utf8"
  );
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

describe("repo-level Codex onboarding", () => {
  it("installs native Codex skills, writes workspace config, and runs doctor in one step", () => {
    const workspaceRoot = createTempDir("codex-voltagent-onboard-workspace-");
    const stateRoot = createTempDir("codex-voltagent-onboard-state-");
    const { homeRoot, codexConfigPath } = createTempCodexHome(
      "codex-voltagent-onboard-home-"
    );

    writeCodexMimirConfig(codexConfigPath, process.execPath, [
      join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs")
    ]);

    const stdout = runRepoScript(
      "scripts/codex-onboard.mjs",
      ["--home-root", homeRoot, "--state-root", stateRoot, "--probe-runtime"],
      workspaceRoot,
      {
        USERPROFILE: homeRoot
      }
    );

    const result = JSON.parse(stdout);
    const configPath = join(workspaceRoot, "client-config.json");
    const skillsTarget = join(homeRoot, ".codex", "skills", "voltagent-default");
    const config = JSON.parse(readFileSync(configPath, "utf8"));

    expect(result).toMatchObject({
      ok: true,
      install: {
        homeRoot,
        sourcePath: join(repoRoot, "skills"),
        targetPath: skillsTarget,
        pluginShellInstalled: false
      },
      config: {
        configPath,
        mode: "voltagent-default",
        workspaceRoot
      }
    });
    expect(existsSync(skillsTarget)).toBe(true);
    expect(realpathSync(skillsTarget)).toBe(realpathSync(join(repoRoot, "skills")));
    expect(config.runtime.trustedWorkspaceRoots).toEqual([workspaceRoot]);
    expect(config.skills.rootPaths).toEqual([join(homeRoot, ".codex", "skills")]);
    expect(result.doctor.ok).toBe(true);
    expect(result.doctor.status.activation).toEqual({
      nativeCodexSkillsConfigured: true,
      nativeCodexInstallPresent: true,
      pluginShellPresent: false,
      surface: "native-skills-only"
    });
  });

  it("can optionally install the home-local plugin shell during onboarding", () => {
    const workspaceRoot = createTempDir("codex-voltagent-onboard-workspace-");
    const { homeRoot, codexConfigPath } = createTempCodexHome(
      "codex-voltagent-onboard-home-"
    );

    writeCodexMimirConfig(codexConfigPath, process.execPath, [
      join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs")
    ]);

    const stdout = runRepoScript(
      "scripts/codex-onboard.mjs",
      ["--home-root", homeRoot, "--install-plugin-shell"],
      workspaceRoot,
      {
        USERPROFILE: homeRoot
      }
    );

    const result = JSON.parse(stdout);

    expect(result.install.pluginShellInstalled).toBe(true);
    expect(result.install.pluginPath).toBe(
      join(homeRoot, "plugins", "codex-voltagent-default")
    );
    expect(
      existsSync(join(homeRoot, "plugins", "codex-voltagent-default", ".codex-plugin", "plugin.json"))
    ).toBe(true);
  });
});
