import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
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

function createTempHomeRoot() {
  const homeRoot = mkdtempSync(join(tmpdir(), "codex-voltagent-home-"));

  tempDirs.push(homeRoot);

  return homeRoot;
}

function createTempConfig(baseDir: string) {
  const configDir = join(baseDir, "client-config");
  const skillRoot = join(configDir, "skills");
  const skillDir = join(skillRoot, "sample-skill");
  const configPath = join(configDir, "client-config.json");
  const workspaceRoot = join(configDir, "workspace");
  const stateRoot = join(configDir, "state");

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---
name: Sample Skill
description: Test installed home-local plugin probing
---
Use the sample skill instructions.
`,
    "utf8"
  );
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
    stateRoot,
    workspaceRoot
  };
}

function runRepoPluginScript(scriptName: string, args: string[]) {
  return execFileSync(
    process.execPath,
    [join(pluginRoot, "scripts", scriptName), ...args],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );
}

describe("home-local Codex plugin install", () => {
  it("installs a home-local plugin shell and marketplace entry that point back to the checked-out client repo", () => {
    const homeRoot = createTempHomeRoot();
    const stdout = runRepoPluginScript("install-home-plugin.mjs", [
      "--home-root",
      homeRoot
    ]);
    const result = JSON.parse(stdout);
    const installedPluginRoot = join(homeRoot, "plugins", "codex-voltagent-default");
    const marketplacePath = join(homeRoot, ".agents", "plugins", "marketplace.json");

    expect(result).toMatchObject({
      ok: true,
      homeRoot,
      clientRoot: repoRoot,
      pluginPath: installedPluginRoot,
      marketplacePath
    });
    expect(
      existsSync(join(installedPluginRoot, ".codex-plugin", "plugin.json"))
    ).toBe(true);

    const clientRootPointer = JSON.parse(
      readFileSync(join(installedPluginRoot, "client-root.json"), "utf8")
    );
    const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
    const pluginEntry = marketplace.plugins.find(
      (entry: { name: string }) => entry.name === "codex-voltagent-default"
    );

    expect(clientRootPointer.clientRoot).toBe(repoRoot);
    expect(pluginEntry).toMatchObject({
      name: "codex-voltagent-default",
      source: {
        source: "local",
        path: "./plugins/codex-voltagent-default"
      },
      policy: {
        installation: "INSTALLED_BY_DEFAULT",
        authentication: "ON_INSTALL"
      },
      category: "Developer Tools"
    });
  });

  it("lets an installed home-local plugin probe the built client runtime through the recorded client root", () => {
    const homeRoot = createTempHomeRoot();

    runRepoPluginScript("install-home-plugin.mjs", ["--home-root", homeRoot]);

    const { configPath, workspaceRoot, stateRoot } = createTempConfig(homeRoot);
    const installedPluginRoot = join(homeRoot, "plugins", "codex-voltagent-default");
    const stdout = execFileSync(
      process.execPath,
      [
        join(installedPluginRoot, "scripts", "status.mjs"),
        "--config",
        configPath,
        "--workspace",
        workspaceRoot,
        "--probe-runtime",
        "--state-root",
        stateRoot
      ],
      {
        cwd: installedPluginRoot,
        encoding: "utf8"
      }
    );
    const status = JSON.parse(stdout);

    expect(status.runtimeHealth).toBe("ready");
    expect(status.mimirConnection).toBe("connected");
    expect(status.probe).toMatchObject({
      ok: true,
      discoveredSkillCount: 1
    });
  });
});
