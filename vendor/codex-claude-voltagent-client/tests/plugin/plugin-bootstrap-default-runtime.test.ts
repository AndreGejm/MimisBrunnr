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

describe("repo-local Codex default runtime bootstrap", () => {
  it("installs the home-local plugin and initializes a trusted workspace config in one step", () => {
    const workspaceRoot = createTempDir("codex-voltagent-bootstrap-workspace-");
    const homeRoot = createTempDir("codex-voltagent-bootstrap-home-");
    const stdout = runRepoPluginScript(
      "bootstrap-default-runtime.mjs",
      [
        "--home-root",
        homeRoot,
        "--mimir-command",
        process.execPath,
        "--mimir-arg",
        join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs")
      ],
      workspaceRoot
    );
    const result = JSON.parse(stdout);
    const configPath = join(workspaceRoot, "client-config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const marketplace = JSON.parse(
      readFileSync(join(homeRoot, ".agents", "plugins", "marketplace.json"), "utf8")
    );

    expect(result).toMatchObject({
      ok: true,
      install: {
        homeRoot,
        clientRoot: repoRoot,
        pluginPath: join(homeRoot, "plugins", "codex-voltagent-default")
      },
      config: {
        configPath,
        mode: "voltagent-default",
        workspaceRoot,
        claudeEnabled: false
      }
    });
    expect(config.runtime.trustedWorkspaceRoots).toEqual([workspaceRoot]);
    expect(config.skills.rootPaths).toEqual([join(homedir(), ".codex", "skills")]);
    expect(marketplace.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "codex-voltagent-default"
        })
      ])
    );
  });

  it("bootstraps successfully from the existing Codex Mimir config when no explicit override is provided", () => {
    const workspaceRoot = createTempDir("codex-voltagent-bootstrap-workspace-");
    const { homeRoot, codexConfigPath } = createTempCodexHome(
      "codex-voltagent-bootstrap-home-"
    );

    writeCodexMimirConfig(codexConfigPath, process.execPath, [
      join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs")
    ]);

    const stdout = runRepoPluginScript(
      "bootstrap-default-runtime.mjs",
      ["--home-root", homeRoot],
      workspaceRoot,
      {
        USERPROFILE: homeRoot
      }
    );
    const result = JSON.parse(stdout);
    const configPath = join(workspaceRoot, "client-config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));

    expect(result).toMatchObject({
      ok: true,
      config: {
        configPath,
        mode: "voltagent-default",
        workspaceRoot
      }
    });
    expect(config.mimir.serverCommand).toEqual([process.execPath]);
    expect(config.mimir.serverArgs).toEqual([
      join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs")
    ]);
  });
});
