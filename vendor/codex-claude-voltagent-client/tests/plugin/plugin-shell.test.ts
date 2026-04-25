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
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..");
const pluginRoot = join(repoRoot, "plugins", "codex-voltagent-default");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dirPath = tempDirs.pop();

    if (dirPath) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  }
});

function createTempConfig(
  overrides: Record<string, unknown> = {},
  workspaceRoot?: string
) {
  const tempDir = mkdtempSync(join(tmpdir(), "codex-voltagent-plugin-"));
  const configPath = join(tempDir, "client-config.json");
  const resolvedWorkspaceRoot = workspaceRoot ?? join(tempDir, "workspace");
  const skillRoot = join(tempDir, "skills");

  tempDirs.push(tempDir);
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
          fallback: ["anthropic/claude-sonnet-4-20250514"]
        },
        runtime: {
          mode: "voltagent-default",
          trustedWorkspaceRoots: [resolvedWorkspaceRoot]
        },
        claude: {
          enabled: false,
          skillPacks: [],
          profiles: []
        },
        ...overrides
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    tempDir,
    configPath,
    workspaceRoot: resolvedWorkspaceRoot
  };
}

function createHomeGlobalConfig(
  overrides: Record<string, unknown> = {},
  workspaceRoot?: string
) {
  const tempDir = mkdtempSync(join(tmpdir(), "codex-voltagent-plugin-home-"));
  const homeRoot = join(tempDir, "home");
  const resolvedWorkspaceRoot = workspaceRoot ?? join(tempDir, "workspace");
  const skillRoot = join(homeRoot, ".codex", "skills");
  const configPath = join(homeRoot, ".codex", "voltagent", "client-config.json");

  tempDirs.push(tempDir);
  mkdirSync(skillRoot, { recursive: true });
  mkdirSync(join(homeRoot, ".codex", "voltagent"), { recursive: true });

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
          fallback: ["anthropic/claude-sonnet-4-20250514"]
        },
        runtime: {
          mode: "voltagent-default",
          workspaceTrustMode: "all-workspaces",
          trustedWorkspaceRoots: []
        },
        claude: {
          enabled: false,
          skillPacks: [],
          profiles: []
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
    homeRoot,
    workspaceRoot: resolvedWorkspaceRoot
  };
}

function readPluginFile(...segments: string[]) {
  return readFileSync(join(pluginRoot, ...segments), "utf8");
}

describe("repo-local Codex plugin shell", () => {
  it("keeps the repo-local plugin shell limited to manifest, skills, and scripts", () => {
    const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");

    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readPluginFile(".codex-plugin", "plugin.json"));

    expect(manifest.name).toBe("codex-voltagent-default");
    expect(manifest.skills).toBe("./skills/");
    expect(manifest.hooks).toBeUndefined();
    expect(manifest.mcpServers).toBeUndefined();
    expect(manifest.apps).toBeUndefined();
    expect(manifest.interface.defaultPrompt).toEqual(
      expect.arrayContaining([
        expect.stringContaining("status"),
        expect.stringContaining("doctor")
      ])
    );

    const statusSkill = readPluginFile("skills", "voltagent-status", "SKILL.md");
    const doctorSkill = readPluginFile("skills", "voltagent-doctor", "SKILL.md");
    const bootstrapSkill = readPluginFile(
      "skills",
      "voltagent-bootstrap-default-runtime",
      "SKILL.md"
    );
    const initConfigSkill = readPluginFile(
      "skills",
      "voltagent-init-config",
      "SKILL.md"
    );

    expect(statusSkill).toContain("status.mjs");
    expect(doctorSkill).toContain("doctor.mjs");
    expect(bootstrapSkill).toContain("bootstrap-default-runtime.mjs");
    expect(initConfigSkill).toContain("init-client-config.mjs");
  });

  it("prints status JSON from an explicit config file and workspace root", () => {
    const { configPath, workspaceRoot } = createTempConfig();

    const stdout = execFileSync(
      process.execPath,
      [
        join(pluginRoot, "scripts", "status.mjs"),
        "--config",
        configPath,
        "--workspace",
        workspaceRoot
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    const status = JSON.parse(stdout);

    expect(status).toMatchObject({
      configVersion: 1,
      configPath,
      configSource: "explicit",
      mode: "voltagent-default",
      workspaceTrustMode: "explicit-roots",
      workspaceTrusted: true,
      workspaceOverrideActive: false,
      runtimeHealth: "stopped",
      mimirConnection: "disconnected"
    });
    expect(status.models.primary).toBe("openai/gpt-5-mini");
    expect(status.activation).toEqual({
      nativeCodexSkillsConfigured: false,
      nativeCodexInstallPresent: false,
      pluginShellPresent: true,
      surface: "plugin-shell-only"
    });
  });

  it("falls back to the home-global config when no workspace override exists", () => {
    const { configPath, homeRoot, workspaceRoot } = createHomeGlobalConfig();

    const stdout = execFileSync(
      process.execPath,
      [
        join(pluginRoot, "scripts", "status.mjs"),
        "--home-root",
        homeRoot,
        "--workspace",
        workspaceRoot
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    const status = JSON.parse(stdout);

    expect(status).toMatchObject({
      configPath,
      configSource: "home-global-default",
      mode: "voltagent-default",
      workspaceTrustMode: "all-workspaces",
      workspaceTrusted: true,
      workspaceOverrideActive: false
    });
    expect(status.activation).toEqual({
      nativeCodexSkillsConfigured: true,
      nativeCodexInstallPresent: true,
      pluginShellPresent: true,
      surface: "both"
    });
  });

  it("shows when native Codex skill discovery and the plugin shell are both in play", () => {
    const { configPath, workspaceRoot } = createTempConfig({
      skills: {
        rootPaths: [join(process.env.USERPROFILE ?? "C:/Users/test", ".codex", "skills")]
      }
    });

    const stdout = execFileSync(
      process.execPath,
      [
        join(pluginRoot, "scripts", "status.mjs"),
        "--config",
        configPath,
        "--workspace",
        workspaceRoot
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    const status = JSON.parse(stdout);

    expect(status.activation).toEqual({
      nativeCodexSkillsConfigured: true,
      nativeCodexInstallPresent: true,
      pluginShellPresent: true,
      surface: "both"
    });
  });

  it("prints doctor JSON that blocks default mode in an untrusted workspace", () => {
    const { configPath } = createTempConfig();
    const untrustedWorkspaceRoot = join(tmpdir(), "untrusted-workspace");

    const stdout = execFileSync(
      process.execPath,
      [
        join(pluginRoot, "scripts", "doctor.mjs"),
        "--config",
        configPath,
        "--workspace",
        untrustedWorkspaceRoot
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    const report = JSON.parse(stdout);

    expect(report.ok).toBe(false);
    expect(report.mode).toBe("voltagent-default");
    expect(report.workspaceRoot).toBe(untrustedWorkspaceRoot);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "workspace_trust",
          status: "error"
        })
      ])
    );
  });

  it("reports all-workspaces trust as healthy without explicit roots", () => {
    const { homeRoot, workspaceRoot } = createHomeGlobalConfig();

    const stdout = execFileSync(
      process.execPath,
      [
        join(pluginRoot, "scripts", "doctor.mjs"),
        "--home-root",
        homeRoot,
        "--workspace",
        workspaceRoot
      ],
      {
        cwd: repoRoot,
        encoding: "utf8"
      }
    );

    const report = JSON.parse(stdout);

    expect(report.ok).toBe(true);
    expect(report.workspaceRoot).toBe(workspaceRoot);
    expect(report.status.configSource).toBe("home-global-default");
    expect(report.status.workspaceTrustMode).toBe("all-workspaces");
    expect(report.status.workspaceTrusted).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "workspace_trust",
          status: "ok",
          message: "Global all-workspaces trust mode is active."
        })
      ])
    );
  });
});
