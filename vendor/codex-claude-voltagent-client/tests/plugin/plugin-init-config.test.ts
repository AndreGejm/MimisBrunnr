import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
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

function createTempWorkspace() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "codex-voltagent-workspace-"));

  tempDirs.push(workspaceRoot);

  return workspaceRoot;
}

function createTempCodexHome() {
  const homeRoot = mkdtempSync(join(tmpdir(), "codex-home-"));
  const codexRoot = join(homeRoot, ".codex");

  tempDirs.push(homeRoot);
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

function runRepoPluginScript(
  scriptName: string,
  args: string[],
  cwd: string,
  envOverrides: Record<string, string> = {}
) {
  return execFileSync(
    process.execPath,
    [join(pluginRoot, "scripts", scriptName), ...args],
    {
      cwd,
      env: {
        ...process.env,
        ...envOverrides
      },
      encoding: "utf8"
    }
  );
}

describe("repo-local Codex client config bootstrap", () => {
  it("writes the default home-global config", () => {
    const workspaceRoot = createTempWorkspace();
    const { homeRoot } = createTempCodexHome();
    const stdout = runRepoPluginScript(
      "init-client-config.mjs",
      [
        "--mimir-command",
        process.execPath,
        "--mimir-arg",
        join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs")
      ],
      workspaceRoot,
      {
        USERPROFILE: homeRoot
      }
    );
    const result = JSON.parse(stdout);
    const configPath = join(
      homeRoot,
      ".codex",
      "voltagent",
      "client-config.json"
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));

    expect(result).toMatchObject({
      ok: true,
      configPath,
      mode: "voltagent-default",
      claudeEnabled: false,
      workspaceRoot
    });
    expect(config.runtime.mode).toBe("voltagent-default");
    expect(config.runtime.workspaceTrustMode).toBe("all-workspaces");
    expect(config.runtime.trustedWorkspaceRoots).toEqual([]);
    expect(config.skills.rootPaths).toEqual([join(homeRoot, ".codex", "skills")]);
    expect(config.mimir.serverCommand).toEqual([process.execPath]);
  });

  it("writes the default Claude profile packs when auto mode is requested", () => {
    const workspaceRoot = createTempWorkspace();
    const { homeRoot } = createTempCodexHome();
    const stdout = runRepoPluginScript(
      "init-client-config.mjs",
      [
        "--mode",
        "voltagent+claude-auto",
        "--mimir-command",
        process.execPath,
        "--mimir-arg",
        join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs"),
        "--skill-root",
        join(workspaceRoot, "skills")
      ],
      workspaceRoot,
      {
        USERPROFILE: homeRoot
      }
    );
    const result = JSON.parse(stdout);
    const config = JSON.parse(
      readFileSync(
        join(homeRoot, ".codex", "voltagent", "client-config.json"),
        "utf8"
      )
    );

    expect(result.mode).toBe("voltagent+claude-auto");
    expect(result.claudeEnabled).toBe(true);
    expect(result.profileIds).toEqual([
      "design-advisor",
      "implementation-reviewer",
      "debug-specialist",
      "release-reviewer"
    ]);
    expect(config.claude.skillPacks.map((skillPack: { skillPackId: string }) => skillPack.skillPackId)).toEqual([
      "design-core",
      "review-core",
      "debug-core",
      "release-core"
    ]);
    expect(config.claude.profiles).toHaveLength(4);
  });

  it("auto-detects the Mimir MCP command from the existing Codex config when no explicit override is given", () => {
    const workspaceRoot = createTempWorkspace();
    const { homeRoot, codexConfigPath } = createTempCodexHome();

    writeCodexMimirConfig(codexConfigPath, process.execPath, [
      join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs")
    ]);

    const stdout = runRepoPluginScript("init-client-config.mjs", [], workspaceRoot, {
      USERPROFILE: homeRoot
    });
    const result = JSON.parse(stdout);
    const configPath = join(
      homeRoot,
      ".codex",
      "voltagent",
      "client-config.json"
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));

    expect(result).toMatchObject({
      ok: true,
      configPath,
      mode: "voltagent-default",
      workspaceRoot
    });
    expect(config.mimir.serverCommand).toEqual([process.execPath]);
    expect(config.mimir.serverArgs).toEqual([
      join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs")
    ]);
  });

  it("prefers explicit Mimir command overrides over the existing Codex config", () => {
    const workspaceRoot = createTempWorkspace();
    const { homeRoot, codexConfigPath } = createTempCodexHome();

    writeCodexMimirConfig(codexConfigPath, "node-from-codex-config", [
      "from-codex-config.mjs"
    ]);

    runRepoPluginScript(
      "init-client-config.mjs",
      [
        "--mimir-command",
        process.execPath,
        "--mimir-arg",
        join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs")
      ],
      workspaceRoot,
      {
        USERPROFILE: homeRoot
      }
    );

    const config = JSON.parse(
      readFileSync(
        join(homeRoot, ".codex", "voltagent", "client-config.json"),
        "utf8"
      )
    );

    expect(config.mimir.serverCommand).toEqual([process.execPath]);
    expect(config.mimir.serverArgs).toEqual([
      join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs")
    ]);
  });
});
