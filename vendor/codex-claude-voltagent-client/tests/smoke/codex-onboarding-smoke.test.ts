import { execSync } from "node:child_process";
import {
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

function createFreshCodexHome() {
  const homeRoot = createTempDir("codex-voltagent-smoke-home-");
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

function runPnpm(args: string[], cwd: string, envOverrides: Record<string, string> = {}) {
  const fullArgs = ["--silent", ...args];
  const command = process.platform === "win32"
    ? `pnpm.cmd ${fullArgs.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(" ")}`
    : `pnpm ${fullArgs.map((value) => `'${value.replace(/'/g, `'\\''`)}'`).join(" ")}`;

  return execSync(command, {
    cwd,
    env: {
      ...process.env,
      ...envOverrides
    },
    encoding: "utf8"
  });
}

describe("fresh-home Codex onboarding smoke", () => {
  it(
    "proves the package-script onboarding path works from a fresh home and workspace",
    () => {
    const workspaceRoot = createTempDir("codex-voltagent-smoke-workspace-");
    const stateRoot = createTempDir("codex-voltagent-smoke-state-");
    const { homeRoot, codexConfigPath } = createFreshCodexHome();

    writeCodexMimirConfig(codexConfigPath, process.execPath, [
      join(repoRoot, "tests", "fixtures", "fake-mimir-mcp-server.mjs")
    ]);

    const onboardStdout = runPnpm(
      [
        "codex:onboard",
        "--",
        "--home-root",
        homeRoot,
        "--workspace",
        workspaceRoot,
        "--probe-runtime",
        "--state-root",
        stateRoot
      ],
      repoRoot,
      {
        USERPROFILE: homeRoot
      }
    );
    const doctorStdout = runPnpm(
      [
        "codex:doctor",
        "--",
        "--home-root",
        homeRoot,
        "--workspace",
        workspaceRoot,
        "--probe-runtime",
        "--state-root",
        stateRoot
      ],
      repoRoot,
      {
        USERPROFILE: homeRoot
      }
    );

    const onboardResult = JSON.parse(onboardStdout);
    const doctorResult = JSON.parse(doctorStdout);
    const config = JSON.parse(readFileSync(join(workspaceRoot, "client-config.json"), "utf8"));

    expect(onboardResult.ok).toBe(true);
    expect(onboardResult.install).toMatchObject({
      homeRoot,
      pluginShellInstalled: false,
      targetPath: join(homeRoot, ".codex", "skills", "voltagent-default")
    });
    expect(config.mimir.serverCommand).toEqual([process.execPath]);
    expect(config.runtime.trustedWorkspaceRoots).toEqual([workspaceRoot]);

    expect(doctorResult.ok).toBe(true);
    expect(doctorResult.status.activation).toEqual({
      nativeCodexSkillsConfigured: true,
      nativeCodexInstallPresent: true,
      pluginShellPresent: false,
      surface: "native-skills-only"
    });
    expect(doctorResult.status.runtimeHealth).toBe("ready");
    expect(doctorResult.status.mimirConnection).toBe("connected");
    expect(doctorResult.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "native_skill_install",
          status: "ok"
        }),
        expect.objectContaining({
          code: "client_composition",
          status: "ok"
        })
      ])
    );
    },
    15000
  );
});
