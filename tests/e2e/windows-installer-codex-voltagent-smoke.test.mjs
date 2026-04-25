import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawn } from "node:child_process";

const installerCliPath = path.resolve("scripts/installers/windows/cli.ps1");
const vendoredDoctorPath = path.resolve(
  "vendor/codex-claude-voltagent-client/scripts/codex-doctor.mjs"
);
const powershellExecutable = "powershell.exe";

test(
  "windows installer smoke provisions vendored Codex VoltAgent access in a fresh home and workspace",
  async (t) => {
    if (process.platform !== "win32") {
      t.skip("Windows-only installer contract");
      return;
    }

    const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-smoke-"));
    const homeRoot = path.join(root, "home");
    const workspacePath = path.join(root, "workspace");
    const binDir = path.join(root, "bin");
    const stateRoot = path.join(root, "state");
    const configPath = path.join(homeRoot, ".codex", "config.toml");
    const manifestPath = path.join(homeRoot, ".mimir", "installation.json");
    const globalVoltAgentConfigPath = path.join(
      homeRoot,
      ".codex",
      "voltagent",
      "client-config.json"
    );

    await mkdir(workspacePath, { recursive: true });
    await mkdir(binDir, { recursive: true });

    t.after(async () => {
      await rm(root, { recursive: true, force: true });
    });

    const applyResult = await runInstallerCommand(
      [
        "-Operation",
        "apply-client-access",
        "-RepoRoot",
        process.cwd(),
        "-ClientName",
        "codex",
        "-ConfigPath",
        configPath,
        "-BinDir",
        binDir,
        "-ManifestPath",
        manifestPath,
        "-WorkspacePath",
        workspacePath,
        "-HomeRoot",
        homeRoot,
        "-StateRoot",
        stateRoot,
        "-Json"
      ],
      {
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
        }
      }
    );

    assert.equal(applyResult.exitCode, 0, applyResult.stderr);
    const applyEnvelope = JSON.parse(applyResult.stdout);
    assert.equal(applyEnvelope.status, "success");
    assert.equal(applyEnvelope.details.codexVoltAgentAccess.doctor.ok, true);
    assert.equal(
      applyEnvelope.details.clientAccess.codexVoltAgentAccess.configPath,
      globalVoltAgentConfigPath
    );
    assert.equal(
      applyEnvelope.details.clientAccess.codexVoltAgentAccess.workspacePath,
      workspacePath
    );

    const doctorResult = await runNodeJsonCommand(
      vendoredDoctorPath,
      [
        "--home-root",
        homeRoot,
        "--workspace",
        workspacePath,
        "--probe-runtime",
        "--state-root",
        stateRoot
      ],
      {
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`
      }
    );

    assert.equal(doctorResult.exitCode, 0, doctorResult.stderr);
    const doctorReport = JSON.parse(doctorResult.stdout);
    assert.equal(doctorReport.ok, true);
    assert.equal(doctorReport.status.configPath, globalVoltAgentConfigPath);
    assert.equal(doctorReport.status.configSource, "home-global-default");
    assert.deepEqual(doctorReport.status.activation, {
      nativeCodexSkillsConfigured: true,
      nativeCodexInstallPresent: true,
      pluginShellPresent: false,
      surface: "native-skills-only"
    });
    assert.equal(doctorReport.status.runtimeHealth, "ready");
    assert.equal(doctorReport.status.mimirConnection, "connected");
    assert.ok(
      doctorReport.checks.some(
        (check) => check.code === "client_composition" && check.status === "ok"
      )
    );

    const vendoredConfig = JSON.parse(
      await readFile(globalVoltAgentConfigPath, "utf8")
    );
    assert.equal(vendoredConfig.runtime.mode, "voltagent-default");
    assert.equal(vendoredConfig.runtime.workspaceTrustMode, "all-workspaces");
    assert.deepEqual(vendoredConfig.runtime.trustedWorkspaceRoots, []);
  },
  90000
);

function runInstallerCommand(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershellExecutable,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        installerCliPath,
        ...args
      ],
      {
        cwd: process.cwd(),
        env: options.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function runNodeJsonCommand(scriptPath, args, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...envOverrides
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
