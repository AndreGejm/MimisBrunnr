import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawn } from "node:child_process";

const installerCliPath = path.resolve("scripts/installers/windows/cli.ps1");
const powershellExecutable = "powershell.exe";

test("windows installer cli detect-environment returns a structured capability report and persists state", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const stateRoot = path.join(root, "state");

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand([
    "-Operation",
    "detect-environment",
    "-StateRoot",
    stateRoot,
    "-Json"
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "detect-environment");
  assert.equal(envelope.status, "success");
  assert.equal(envelope.reasonCode, "environment_detected");
  assert.deepEqual(envelope.commandsRun, []);
  assert.ok(Array.isArray(envelope.details.capabilities));
  assert.ok(
    envelope.details.capabilities.some((capability) => capability.id === "powershell")
  );
  assert.ok(
    envelope.details.capabilities.some((capability) => capability.id === "node")
  );
  assert.equal(
    envelope.details.capabilities.find((capability) => capability.id === "powershell").state,
    "Ready"
  );
  assert.equal(
    envelope.details.capabilities.find((capability) => capability.id === "node").state,
    "Ready"
  );

  const persistedReport = JSON.parse(
    await readFile(path.join(stateRoot, "last-report.json"), "utf8")
  );
  assert.equal(persistedReport.operationId, "detect-environment");
});

test("windows installer cli audit-install-surface returns a structured result and persists state", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const binDir = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  const configPath = path.join(root, "config.toml");
  const manifestPath = path.join(root, "installation.json");
  await mkdir(binDir, { recursive: true });

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand([
    "-Operation",
    "audit-install-surface",
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
    "-StateRoot",
    stateRoot,
    "-Json"
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "audit-install-surface");
  assert.equal(envelope.mode, "audit_only");
  assert.equal(envelope.status, "user_action_required");
  assert.equal(envelope.reasonCode, "install_surface_unavailable");
  assert.ok(Array.isArray(envelope.commandsRun));
  assert.equal(envelope.commandsRun.length, 1);
  assert.ok(Array.isArray(envelope.nextActions));
  assert.ok(Array.isArray(envelope.artifactsWritten));
  assert.ok(envelope.artifactsWritten.some((item) => item.endsWith("last-report.json")));
  assert.ok(envelope.artifactsWritten.some((item) => item.endsWith("install-session.json")));
  assert.equal(envelope.details.clientAccess.clientName, "codex");
  assert.equal(envelope.details.clientAccess.displayName, "Codex");
  assert.equal(envelope.details.clientAccess.accessKind, "mcp_stdio");
  assert.equal(envelope.details.clientAccess.configPath, configPath);
  assert.equal(envelope.details.clientAccess.configured, false);
  assert.equal(envelope.details.defaultAccess.report.codexMcp.configured, false);
  assert.equal(envelope.details.defaultAccess.report.status, "unavailable");
  assert.equal(envelope.details.defaultAccess.report.dockerTools.registry.manifestCount, 3);
  assert.deepEqual(
    envelope.details.defaultAccess.report.dockerTools.registry.tools.map((tool) => tool.id),
    ["aider", "codesight", "rtk"]
  );

  const persistedReport = JSON.parse(
    await readFile(path.join(stateRoot, "last-report.json"), "utf8")
  );
  assert.equal(persistedReport.operationId, "audit-install-surface");
  const sessionState = JSON.parse(
    await readFile(path.join(stateRoot, "install-session.json"), "utf8")
  );
  assert.equal(sessionState.schemaVersion, 1);
  assert.equal(sessionState.lastOperationId, "audit-install-surface");
  assert.equal(sessionState.operations.length, 1);
  assert.equal(sessionState.operations[0].status, "user_action_required");
});

test("windows installer cli plan-client-access returns a dry-run write plan with backup previews", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const binDir = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  const configPath = path.join(root, "config.toml");
  const manifestPath = path.join(root, "installation.json");
  await mkdir(binDir, { recursive: true });
  await writeFile(configPath, "# existing config\n", "utf8");
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1 }, null, 2), "utf8");
  await writeFile(path.join(binDir, "mimir.cmd"), "@echo off\r\n", "utf8");

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand([
    "-Operation",
    "plan-client-access",
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
    "-StateRoot",
    stateRoot,
    "-Json"
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "plan-client-access");
  assert.equal(envelope.mode, "plan_only");
  assert.equal(envelope.status, "success");
  assert.equal(envelope.reasonCode, "client_access_plan_ready");
  assert.ok(Array.isArray(envelope.commandsRun));
  assert.equal(envelope.commandsRun.length, 1);
  assert.equal(envelope.details.clientAccess.clientName, "codex");
  assert.equal(envelope.details.writePlan.applyCommand.serverName, "mimir");
  assert.equal(envelope.details.writePlan.applyCommand.repoRoot, process.cwd());
  assert.ok(Array.isArray(envelope.details.writePlan.writeTargets));

  const configTarget = envelope.details.writePlan.writeTargets.find((target) => target.id === "client-config");
  assert.ok(configTarget);
  assert.equal(configTarget.path, configPath);
  assert.equal(configTarget.exists, true);
  assert.equal(configTarget.mutationKind, "upsert_file");
  assert.equal(configTarget.backupStrategy, "timestamped_copy");
  assert.match(configTarget.backupPathPattern, /\.bak$/);

  const manifestTarget = envelope.details.writePlan.writeTargets.find((target) => target.id === "installation-manifest");
  assert.ok(manifestTarget);
  assert.equal(manifestTarget.path, manifestPath);
  assert.equal(manifestTarget.exists, true);
  assert.equal(manifestTarget.mutationKind, "replace_file");
  assert.equal(manifestTarget.backupStrategy, "timestamped_copy");
  assert.match(manifestTarget.backupPathPattern, /\.bak$/);

  const launcherTarget = envelope.details.writePlan.writeTargets.find((target) => target.id === "launcher:mimir");
  assert.ok(launcherTarget);
  assert.equal(launcherTarget.path, path.join(binDir, "mimir.cmd"));
  assert.equal(launcherTarget.exists, true);
  assert.equal(launcherTarget.mutationKind, "replace_file");
  assert.equal(launcherTarget.backupStrategy, "none");
  assert.equal(launcherTarget.backupPathPattern, null);

  const persistedReport = JSON.parse(
    await readFile(path.join(stateRoot, "last-report.json"), "utf8")
  );
  assert.equal(persistedReport.operationId, "plan-client-access");
});

test("windows installer cli apply-client-access executes the tracked install helper and reports backups", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const binDir = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  const configPath = path.join(root, "config.toml");
  const manifestPath = path.join(root, "installation.json");
  await mkdir(binDir, { recursive: true });
  await writeFile(configPath, "# existing config\n", "utf8");
  await writeFile(
    manifestPath,
    JSON.stringify({ schemaVersion: 1, installation: { repoRoot: "stale" } }, null, 2),
    "utf8"
  );
  await writeFile(path.join(binDir, "mimir.cmd"), "@echo off\r\nREM stale\n", "utf8");

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand(
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

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "apply-client-access");
  assert.equal(envelope.mode, "apply");
  assert.equal(envelope.status, "success");
  assert.equal(envelope.reasonCode, "client_access_applied");
  assert.equal(envelope.details.clientAccess.clientName, "codex");
  assert.equal(envelope.details.clientAccess.configured, true);
  assert.equal(envelope.details.defaultAccess.report.status, "healthy");
  assert.equal(envelope.commandsRun.length, 2);
  assert.equal(envelope.backupsCreated.length, 2);
  assert.ok(envelope.backupsCreated.every((item) => item.endsWith(".bak")));
  assert.equal(envelope.details.applyResult.writeTargets.length > 0, true);

  const configContents = await readFile(configPath, "utf8");
  assert.match(configContents, /\[mcp_servers\.mimir\]/);

  const manifestContents = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifestContents.installation.repoRoot, process.cwd());

  const launcherContents = await readFile(path.join(binDir, "mab.cmd"), "utf8");
  assert.match(launcherContents, /launch-mimir-cli\.mjs/);

  const persistedReport = JSON.parse(
    await readFile(path.join(stateRoot, "last-report.json"), "utf8")
  );
  assert.equal(persistedReport.operationId, "apply-client-access");
});

test("windows installer cli audit-toolbox-assets returns toolbox manifest and runtime plan summary", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const stateRoot = path.join(root, "state");

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand([
    "-Operation",
    "audit-toolbox-assets",
    "-RepoRoot",
    process.cwd(),
    "-StateRoot",
    stateRoot,
    "-Json"
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "audit-toolbox-assets");
  assert.equal(envelope.mode, "audit_only");
  assert.equal(envelope.status, "success");
  assert.equal(envelope.reasonCode, "toolbox_assets_valid");
  assert.equal(envelope.commandsRun.length, 1);
  assert.equal(envelope.details.toolboxAssets.manifestDir, path.join(process.cwd(), "docker", "mcp"));
  assert.equal(typeof envelope.details.toolboxAssets.manifestRevision, "string");
  assert.notEqual(envelope.details.toolboxAssets.manifestRevision.length, 0);
  assert.ok(envelope.details.toolboxAssets.counts.categories > 0);
  assert.ok(envelope.details.toolboxAssets.counts.trustClasses > 0);
  assert.ok(envelope.details.toolboxAssets.counts.servers > 0);
  assert.ok(envelope.details.toolboxAssets.counts.profiles > 0);
  assert.ok(envelope.details.toolboxAssets.counts.clients > 0);
  assert.ok(envelope.details.toolboxAssets.runtimePlan.serverCount > 0);
  assert.ok(envelope.details.toolboxAssets.runtimePlan.profileCount > 0);
  assert.ok(
    envelope.details.toolboxAssets.runtimePlan.serverIds.includes("kubernetes-read")
  );
  assert.ok(
    envelope.details.toolboxAssets.runtimePlan.profileIds.includes("runtime-observe")
  );
  assert.equal(envelope.details.toolboxAssets.bootstrapProfilePresent, true);
  assert.equal(envelope.details.toolboxAssets.controlServerPresent, true);

  const persistedReport = JSON.parse(
    await readFile(path.join(stateRoot, "last-report.json"), "utf8")
  );
  assert.equal(persistedReport.operationId, "audit-toolbox-assets");
});

test("windows installer cli prepare-toolbox-runtime writes a compiled runtime-plan artifact", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const stateRoot = path.join(root, "state");
  const expectedOutputPath = path.join(stateRoot, "toolbox-runtime-plan.json");

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand([
    "-Operation",
    "prepare-toolbox-runtime",
    "-RepoRoot",
    process.cwd(),
    "-StateRoot",
    stateRoot,
    "-Json"
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "prepare-toolbox-runtime");
  assert.equal(envelope.mode, "plan_only");
  assert.equal(envelope.status, "success");
  assert.equal(envelope.reasonCode, "toolbox_runtime_prepared");
  assert.equal(envelope.commandsRun.length, 1);
  assert.equal(envelope.details.toolboxRuntime.manifestDir, path.join(process.cwd(), "docker", "mcp"));
  assert.equal(envelope.details.toolboxRuntime.outputPath, expectedOutputPath);
  assert.equal(typeof envelope.details.toolboxRuntime.manifestRevision, "string");
  assert.notEqual(envelope.details.toolboxRuntime.manifestRevision.length, 0);
  assert.ok(envelope.details.toolboxRuntime.profileCount > 0);
  assert.ok(envelope.details.toolboxRuntime.serverCount > 0);
  assert.equal(envelope.details.toolboxRuntime.dryRun, true);
  assert.equal(envelope.details.toolboxRuntime.dockerApplyImplemented, false);
  assert.ok(envelope.artifactsWritten.includes(expectedOutputPath));

  const writtenPlan = JSON.parse(await readFile(expectedOutputPath, "utf8"));
  assert.equal(
    writtenPlan.manifestRevision,
    envelope.details.toolboxRuntime.manifestRevision
  );
  assert.ok(Array.isArray(writtenPlan.profiles));
  assert.ok(Array.isArray(writtenPlan.servers));
  assert.ok(writtenPlan.servers.some((server) => server.id === "kubernetes-read"));

  const persistedReport = JSON.parse(
    await readFile(path.join(stateRoot, "last-report.json"), "utf8")
  );
  assert.equal(persistedReport.operationId, "prepare-toolbox-runtime");
});

test("windows installer cli prepare-repo-workspace validates a clean repo, runs install/build, and verifies entrypoints", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const repoRoot = path.join(root, "repo");
  const binDir = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  await mkdir(binDir, { recursive: true });
  await mkdir(path.join(repoRoot, ".git"), { recursive: true });
  await mkdir(path.join(repoRoot, "apps", "mimir-api"), { recursive: true });
  await mkdir(path.join(repoRoot, "apps", "mimir-cli"), { recursive: true });
  await mkdir(path.join(repoRoot, "apps", "mimir-mcp"), { recursive: true });
  await mkdir(path.join(repoRoot, "apps", "mimir-control-mcp"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        name: "@mimir/workspace",
        packageManager: "pnpm@10.7.0",
        engines: {
          node: ">=22.0.0"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(repoRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n", "utf8");
  await writeFile(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  await writeFile(
    path.join(binDir, "git.cmd"),
    [
      "@echo off",
      "if \"%~1 %~2\"==\"rev-parse --show-toplevel\" (",
      `  echo ${repoRoot}`,
      "  exit /b 0",
      ")",
      "if \"%~1 %~2\"==\"status --porcelain\" (",
      "  exit /b 0",
      ")",
      "echo unexpected git args: %* 1>&2",
      "exit /b 1"
    ].join("\r\n"),
    "utf8"
  );
  await writeFile(
    path.join(binDir, "corepack.cmd"),
    [
      "@echo off",
      "if \"%~1 %~2 %~3\"==\"pnpm install --frozen-lockfile\" (",
      `  if not exist \"${path.join(repoRoot, "node_modules")}\" mkdir \"${path.join(repoRoot, "node_modules")}\"`,
      `  echo ready>\"${path.join(repoRoot, "node_modules", ".prepared")}\"`,
      "  exit /b 0",
      ")",
      "if \"%~1 %~2\"==\"pnpm build\" (",
      `  if not exist \"${path.join(repoRoot, "apps", "mimir-api", "dist")}\" mkdir \"${path.join(repoRoot, "apps", "mimir-api", "dist")}\"`,
      `  if not exist \"${path.join(repoRoot, "apps", "mimir-cli", "dist")}\" mkdir \"${path.join(repoRoot, "apps", "mimir-cli", "dist")}\"`,
      `  if not exist \"${path.join(repoRoot, "apps", "mimir-mcp", "dist")}\" mkdir \"${path.join(repoRoot, "apps", "mimir-mcp", "dist")}\"`,
      `  if not exist \"${path.join(repoRoot, "apps", "mimir-control-mcp", "dist")}\" mkdir \"${path.join(repoRoot, "apps", "mimir-control-mcp", "dist")}\"`,
      `  echo export default {}>\"${path.join(repoRoot, "apps", "mimir-api", "dist", "main.js")}\"`,
      `  echo export default {}>\"${path.join(repoRoot, "apps", "mimir-cli", "dist", "main.js")}\"`,
      `  echo export default {}>\"${path.join(repoRoot, "apps", "mimir-mcp", "dist", "main.js")}\"`,
      `  echo export default {}>\"${path.join(repoRoot, "apps", "mimir-control-mcp", "dist", "main.js")}\"`,
      "  exit /b 0",
      ")",
      "echo unexpected corepack args: %* 1>&2",
      "exit /b 1"
    ].join("\r\n"),
    "utf8"
  );

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand(
    [
      "-Operation",
      "prepare-repo-workspace",
      "-RepoRoot",
      repoRoot,
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

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "prepare-repo-workspace");
  assert.equal(envelope.mode, "apply");
  assert.equal(envelope.status, "success");
  assert.equal(envelope.reasonCode, "repo_workspace_prepared");
  assert.equal(envelope.commandsRun.length, 4);
  assert.equal(envelope.details.repoWorkspace.repoRoot, repoRoot);
  assert.equal(envelope.details.repoWorkspace.isDirty, false);
  assert.equal(envelope.details.repoWorkspace.installAttempted, true);
  assert.equal(envelope.details.repoWorkspace.buildAttempted, true);
  assert.equal(envelope.details.repoWorkspace.outputsVerified, true);
  assert.deepEqual(
    envelope.details.repoWorkspace.verifiedOutputs.map((item) => item.relativePath),
    [
      "apps/mimir-api/dist/main.js",
      "apps/mimir-cli/dist/main.js",
      "apps/mimir-mcp/dist/main.js",
      "apps/mimir-control-mcp/dist/main.js"
    ]
  );

  const persistedReport = JSON.parse(
    await readFile(path.join(stateRoot, "last-report.json"), "utf8")
  );
  assert.equal(persistedReport.operationId, "prepare-repo-workspace");
});

test("windows installer cli prepare-repo-workspace blocks on a dirty repo before install/build", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const repoRoot = path.join(root, "repo");
  const binDir = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  await mkdir(binDir, { recursive: true });
  await mkdir(path.join(repoRoot, ".git"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "package.json"),
    JSON.stringify(
      {
        name: "@mimir/workspace",
        packageManager: "pnpm@10.7.0",
        engines: {
          node: ">=22.0.0"
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(repoRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n", "utf8");
  await writeFile(path.join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  await writeFile(
    path.join(binDir, "git.cmd"),
    [
      "@echo off",
      "if \"%~1 %~2\"==\"rev-parse --show-toplevel\" (",
      `  echo ${repoRoot}`,
      "  exit /b 0",
      ")",
      "if \"%~1 %~2\"==\"status --porcelain\" (",
      "  echo  M README.md",
      "  exit /b 0",
      ")",
      "echo unexpected git args: %* 1>&2",
      "exit /b 1"
    ].join("\r\n"),
    "utf8"
  );
  await writeFile(
    path.join(binDir, "corepack.cmd"),
    [
      "@echo off",
      "echo corepack should not run for a dirty repo 1>&2",
      "exit /b 1"
    ].join("\r\n"),
    "utf8"
  );

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand(
    [
      "-Operation",
      "prepare-repo-workspace",
      "-RepoRoot",
      repoRoot,
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

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "prepare-repo-workspace");
  assert.equal(envelope.status, "user_action_required");
  assert.equal(envelope.reasonCode, "repo_workspace_dirty");
  assert.equal(envelope.commandsRun.length, 2);
  assert.equal(envelope.details.repoWorkspace.isDirty, true);
  assert.equal(envelope.details.repoWorkspace.installAttempted, false);
  assert.equal(envelope.details.repoWorkspace.buildAttempted, false);
  assert.match(envelope.details.repoWorkspace.blockedReasons[0], /clean git worktree/i);
});

test("windows installer cli audit-docker-mcp-toolkit reports Docker MCP toolkit state", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const binDir = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  await mkdir(binDir, { recursive: true });
  await writeFile(
    path.join(binDir, "docker.cmd"),
    [
      "@echo off",
      "if \"%~1 %~2\"==\"mcp version\" (",
      "  echo v0.40.3",
      "  exit /b 0",
      ")",
      "if \"%~1 %~2 %~3 %~4\"==\"mcp server ls --json\" (",
      "  echo [{\"name\":\"mimir-control\",\"description\":\"Control server\",\"secrets\":\"none\",\"config\":\"done\",\"oauth\":\"none\"},{\"name\":\"mimir-core\",\"description\":\"Core server\",\"secrets\":\"none\",\"config\":\"done\",\"oauth\":\"none\"}]",
        "  exit /b 0",
      ")",
      "if \"%~1 %~2 %~3 %~4\"==\"mcp client ls --json\" (",
      "  echo {\"codex\":{\"displayName\":\"Codex\",\"dockerMCPCatalogConnected\":true,\"profile\":\"workspace\",\"error\":null,\"Cfg\":null,\"isConfigured\":true}}",
      "  exit /b 0",
      ")",
      "if \"%~1 %~2 %~3\"==\"mcp config read\" (",
      "  echo filesystem:",
      "  echo   paths:",
      "  echo     - F:\\Dev",
      "  exit /b 0",
      ")",
      "if \"%~1 %~2 %~3\"==\"mcp feature ls\" (",
      "  echo dynamic-tools enabled",
      "  exit /b 0",
      ")",
      "echo unexpected docker args: %* 1>&2",
      "exit /b 1"
    ].join("\r\n"),
    "utf8"
  );

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand(
    [
      "-Operation",
      "audit-docker-mcp-toolkit",
      "-RepoRoot",
      process.cwd(),
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

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "audit-docker-mcp-toolkit");
  assert.equal(envelope.mode, "audit_only");
  assert.equal(envelope.status, "success");
  assert.equal(envelope.reasonCode, "docker_mcp_toolkit_audited");
  assert.equal(envelope.commandsRun.length, 5);
  assert.equal(envelope.details.dockerMcpToolkit.available, true);
  assert.equal(envelope.details.dockerMcpToolkit.version, "v0.40.3");
  assert.equal(envelope.details.dockerMcpToolkit.enabledServerCount, 2);
  assert.equal(envelope.details.dockerMcpToolkit.configuredClientCount, 1);
  assert.equal(envelope.details.dockerMcpToolkit.connectedClientCount, 1);
  assert.equal(envelope.details.dockerMcpToolkit.servers[0].name, "mimir-control");
  assert.equal(envelope.details.dockerMcpToolkit.servers[1].name, "mimir-core");
  assert.equal(envelope.details.dockerMcpToolkit.clients[0].name, "codex");
  assert.match(envelope.details.dockerMcpToolkit.configText, /filesystem:/);
  assert.match(envelope.details.dockerMcpToolkit.featureText, /dynamic-tools enabled/);

  const persistedReport = JSON.parse(
    await readFile(path.join(stateRoot, "last-report.json"), "utf8")
  );
  assert.equal(persistedReport.operationId, "audit-docker-mcp-toolkit");
});

test("windows installer cli plan-docker-mcp-toolkit-apply reports a blocked dry-run when Docker lacks profile support", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const binDir = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  await mkdir(binDir, { recursive: true });
  await writeFile(
    path.join(binDir, "docker.cmd"),
    [
      "@echo off",
      "if \"%~1 %~2\"==\"mcp version\" (",
      "  echo v0.40.3",
      "  exit /b 0",
      ")",
      "if \"%~1 %~2 %~3 %~4\"==\"mcp server ls --json\" (",
      "  echo [{\"name\":\"mimir-control\",\"description\":\"Control server\",\"secrets\":\"none\",\"config\":\"done\",\"oauth\":\"none\"},{\"name\":\"mimir-core\",\"description\":\"Core server\",\"secrets\":\"none\",\"config\":\"done\",\"oauth\":\"none\"}]",
      "  exit /b 0",
      ")",
      "if \"%~1 %~2 %~3 %~4\"==\"mcp client ls --json\" (",
      "  echo {\"codex\":{\"displayName\":\"Codex\",\"dockerMCPCatalogConnected\":false,\"profile\":\"bootstrap\",\"error\":null,\"Cfg\":null,\"isConfigured\":true}}",
      "  exit /b 0",
      ")",
      "if \"%~1 %~2 %~3\"==\"mcp config read\" (",
      "  echo filesystem:",
      "  echo   paths:",
      "  echo     - F:\\Dev",
      "  exit /b 0",
      ")",
      "if \"%~1 %~2 %~3\"==\"mcp feature ls\" (",
      "  echo dynamic-tools enabled",
      "  exit /b 0",
      ")",
      "if \"%~1 %~2 %~3\"==\"mcp profile --help\" (",
      "  echo unknown command \"profile\" 1>&2",
      "  exit /b 1",
      ")",
      "echo unexpected docker args: %* 1>&2",
      "exit /b 1"
    ].join("\r\n"),
    "utf8"
  );

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand(
    [
      "-Operation",
      "plan-docker-mcp-toolkit-apply",
      "-RepoRoot",
      process.cwd(),
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

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "plan-docker-mcp-toolkit-apply");
  assert.equal(envelope.mode, "plan_only");
  assert.equal(envelope.status, "user_action_required");
  assert.equal(envelope.reasonCode, "docker_mcp_toolkit_apply_plan_blocked");
  assert.ok(envelope.commandsRun.length >= 7);
  assert.equal(envelope.details.dockerMcpToolkitApplyPlan.mutationAllowed, false);
  assert.equal(envelope.details.dockerMcpToolkitApplyPlan.compatibleWithCurrentToolkit, false);
  assert.equal(envelope.details.dockerMcpToolkitApplyPlan.dockerProfileSubcommandAvailable, false);
  assert.ok(envelope.details.dockerMcpToolkitApplyPlan.applyCommandCount > 0);
  assert.match(
    envelope.details.dockerMcpToolkitApplyPlan.blockedReasons[0],
    /profile/i
  );
  assert.equal(envelope.details.dockerMcpToolkitApplyPlan.toolkit.version, "v0.40.3");

  const persistedReport = JSON.parse(
    await readFile(path.join(stateRoot, "last-report.json"), "utf8")
  );
  assert.equal(persistedReport.operationId, "plan-docker-mcp-toolkit-apply");
});

test("windows installer cli audit-toolbox-control-surface reports toolbox discovery metadata from the real CLI surface", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const binDir = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  await mkdir(binDir, { recursive: true });
  await writeFile(
    path.join(binDir, "corepack.cmd"),
    [
      "@echo off",
      "if \"%~1 %~2 %~3 %~4\"==\"pnpm cli -- list-toolboxes\" (",
      "  echo {\"reasonCode\":\"toolbox_discovery\",\"toolboxes\":[{\"id\":\"core-dev\",\"displayName\":\"Core Development\",\"summary\":\"Safe local repository work.\",\"exampleTasks\":[\"Inspect code\"],\"targetProfile\":\"core-dev\",\"trustClass\":\"local-readwrite\",\"requiresApproval\":false,\"allowedCategories\":[\"repo-read\",\"repo-write\"],\"deniedCategories\":[\"deployment\"],\"fallbackProfile\":\"bootstrap\"},{\"id\":\"core-dev+docs-research\",\"displayName\":\"Core Dev Plus Docs Research\",\"summary\":\"Code plus docs.\",\"exampleTasks\":[\"Implement a fix with docs\"],\"targetProfile\":\"core-dev+docs-research\",\"trustClass\":\"external-read\",\"requiresApproval\":false,\"allowedCategories\":[\"repo-read\",\"repo-write\",\"docs-search\"],\"deniedCategories\":[\"deployment\"],\"fallbackProfile\":\"core-dev\"},{\"id\":\"runtime-admin\",\"displayName\":\"Runtime Admin\",\"summary\":\"Approved runtime mutation.\",\"exampleTasks\":[\"Restart a container\"],\"targetProfile\":\"runtime-admin\",\"trustClass\":\"ops-mutate\",\"requiresApproval\":true,\"allowedCategories\":[\"docker-read\",\"docker-write\"],\"deniedCategories\":[\"deployment\"],\"fallbackProfile\":\"runtime-observe\"}]}",
      "  exit /b 0",
      ")",
      "if \"%~1 %~2 %~3 %~4\"==\"pnpm cli -- describe-toolbox\" (",
      "  echo {\"reasonCode\":\"toolbox_discovery\",\"toolbox\":{\"id\":\"core-dev\",\"displayName\":\"Core Development\",\"summary\":\"Safe local repository work.\",\"exampleTasks\":[\"Inspect code\"],\"targetProfile\":\"core-dev\",\"trustClass\":\"local-readwrite\",\"requiresApproval\":false,\"allowedCategories\":[\"repo-read\",\"repo-write\"],\"deniedCategories\":[\"deployment\"],\"fallbackProfile\":\"bootstrap\",\"workflow\":{\"activationMode\":\"session-switch\",\"sessionMode\":\"toolbox-activated\",\"requiresApproval\":false,\"fallbackProfile\":\"bootstrap\"},\"profile\":{\"id\":\"core-dev\",\"displayName\":\"Core Development\",\"sessionMode\":\"toolbox-activated\",\"composite\":false,\"baseProfiles\":[],\"fallbackProfile\":\"bootstrap\",\"profileRevision\":\"profile-core-dev-v1\"},\"tools\":[{\"toolId\":\"repo.read\",\"category\":\"repo-read\"},{\"toolId\":\"repo.write\",\"category\":\"repo-write\"}],\"antiUseCases\":[{\"type\":\"denied_category\",\"category\":\"deployment\"}]}}",
      "  exit /b 0",
      ")",
      "echo unexpected corepack args: %* 1>&2",
      "exit /b 1"
    ].join("\r\n"),
    "utf8"
  );

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand(
    [
      "-Operation",
      "audit-toolbox-control-surface",
      "-RepoRoot",
      process.cwd(),
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

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "audit-toolbox-control-surface");
  assert.equal(envelope.mode, "audit_only");
  assert.equal(envelope.status, "success");
  assert.equal(envelope.reasonCode, "toolbox_control_surface_audited");
  assert.equal(envelope.commandsRun.length, 2);
  assert.equal(envelope.details.toolboxControlSurface.clientId, "codex");
  assert.equal(envelope.details.toolboxControlSurface.toolboxCount, 3);
  assert.equal(envelope.details.toolboxControlSurface.approvalRequiredToolboxCount, 1);
  assert.deepEqual(envelope.details.toolboxControlSurface.toolboxIds, [
    "core-dev",
    "core-dev+docs-research",
    "runtime-admin"
  ]);
  assert.equal(envelope.details.toolboxControlSurface.describedToolboxId, "core-dev");
  assert.equal(envelope.details.toolboxControlSurface.describedToolbox.workflow.requiresApproval, false);
  assert.equal(envelope.details.toolboxControlSurface.describedToolbox.profile.profileRevision, "profile-core-dev-v1");
  assert.equal(envelope.details.toolboxControlSurface.describedToolbox.toolCount, 2);
  assert.equal(envelope.details.toolboxControlSurface.describedToolbox.antiUseCaseCount, 1);

  const persistedReport = JSON.parse(
    await readFile(path.join(stateRoot, "last-report.json"), "utf8")
  );
  assert.equal(persistedReport.operationId, "audit-toolbox-control-surface");
});

test("windows installer cli audit-active-toolbox-session reports active workflow, profile, and filtered tool counts", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const binDir = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  await mkdir(binDir, { recursive: true });
  await writeFile(
    path.join(binDir, "corepack.cmd"),
    [
      "@echo off",
      "if \"%~1 %~2 %~3 %~4\"==\"pnpm cli -- list-active-toolbox\" (",
      "  echo {\"workflow\":{\"toolboxId\":\"core-dev+docs-research\",\"activationMode\":\"session-switch\",\"sessionMode\":\"toolbox-activated\",\"requiresApproval\":false,\"fallbackProfile\":\"core-dev\"},\"profile\":{\"id\":\"core-dev+docs-research\",\"displayName\":\"Core Dev Plus Docs Research\",\"sessionMode\":\"toolbox-activated\",\"composite\":true,\"baseProfiles\":[\"core-dev\",\"docs-research\"],\"compositeReason\":\"paired workflow\",\"fallbackProfile\":\"core-dev\",\"allowedCategories\":[\"repo-read\",\"repo-write\",\"docs-search\"],\"deniedCategories\":[\"deployment\"],\"semanticCapabilities\":[\"repo.read\",\"repo.write\",\"docs.search\"],\"profileRevision\":\"profile-core-dev-docs-v1\"},\"client\":{\"id\":\"codex\",\"displayName\":\"Codex\",\"handoffStrategy\":\"env-reconnect\",\"handoffPresetRef\":\"codex/toolbox\",\"suppressServerIds\":[],\"suppressToolIds\":[],\"suppressCategories\":[\"github-write\"],\"suppressedSemanticCapabilities\":[\"github.write\"]}}",
      "  exit /b 0",
      ")",
      "if \"%~1 %~2 %~3 %~4\"==\"pnpm cli -- list-active-tools\" (",
      "  echo {\"declaredTools\":[{\"toolId\":\"repo.read\"},{\"toolId\":\"repo.write\"},{\"toolId\":\"github.write\"}],\"activeTools\":[{\"toolId\":\"repo.read\"},{\"toolId\":\"repo.write\"}],\"suppressedTools\":[{\"toolId\":\"github.write\",\"suppressionReasons\":[\"client_suppress_category\"]}],\"tools\":[{\"toolId\":\"repo.read\"},{\"toolId\":\"repo.write\"}]}",
      "  exit /b 0",
      ")",
      "echo unexpected corepack args: %* 1>&2",
      "exit /b 1"
    ].join("\r\n"),
    "utf8"
  );

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand(
    [
      "-Operation",
      "audit-active-toolbox-session",
      "-RepoRoot",
      process.cwd(),
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

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "audit-active-toolbox-session");
  assert.equal(envelope.mode, "audit_only");
  assert.equal(envelope.status, "success");
  assert.equal(envelope.reasonCode, "toolbox_active_session_audited");
  assert.equal(envelope.commandsRun.length, 2);
  assert.equal(envelope.details.activeToolboxSession.workflow.toolboxId, "core-dev+docs-research");
  assert.equal(envelope.details.activeToolboxSession.profile.profileRevision, "profile-core-dev-docs-v1");
  assert.equal(envelope.details.activeToolboxSession.client.handoffStrategy, "env-reconnect");
  assert.equal(envelope.details.activeToolboxSession.declaredToolCount, 3);
  assert.equal(envelope.details.activeToolboxSession.activeToolCount, 2);
  assert.equal(envelope.details.activeToolboxSession.suppressedToolCount, 1);

  const persistedReport = JSON.parse(
    await readFile(path.join(stateRoot, "last-report.json"), "utf8")
  );
  assert.equal(persistedReport.operationId, "audit-active-toolbox-session");
});

test("windows installer cli audit-toolbox-client-handoff reports reconnect contract readiness for the selected client", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const binDir = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  const configPath = path.join(root, "config.toml");
  const manifestPath = path.join(root, "installation.json");
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(binDir, "mimir.cmd"), "@echo off\r\nREM placeholder\r\n", "utf8");
  await writeFile(
    path.join(binDir, "corepack.cmd"),
    [
      "@echo off",
      "if \"%~1 %~2 %~3 %~4\"==\"pnpm cli -- list-active-toolbox\" (",
      "  echo {\"workflow\":{\"toolboxId\":\"core-dev\",\"activationMode\":\"session-switch\",\"sessionMode\":\"toolbox-bootstrap\",\"requiresApproval\":false,\"fallbackProfile\":\"bootstrap\"},\"profile\":{\"id\":\"bootstrap\",\"displayName\":\"Bootstrap\",\"sessionMode\":\"toolbox-bootstrap\",\"composite\":false,\"baseProfiles\":[],\"fallbackProfile\":\"bootstrap\",\"allowedCategories\":[\"repo-read\"],\"deniedCategories\":[\"docker-write\"],\"semanticCapabilities\":[\"repo.read\"],\"profileRevision\":\"profile-bootstrap-v1\"},\"client\":{\"id\":\"codex\",\"displayName\":\"Codex\",\"handoffStrategy\":\"env-reconnect\",\"handoffPresetRef\":\"codex/toolbox\",\"suppressServerIds\":[],\"suppressToolIds\":[],\"suppressCategories\":[],\"suppressedSemanticCapabilities\":[]}}",
      "  exit /b 0",
      ")",
      "echo unexpected corepack args: %* 1>&2",
      "exit /b 1"
    ].join("\r\n"),
    "utf8"
  );

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

  const result = await runInstallerCommand(
    [
      "-Operation",
      "audit-toolbox-client-handoff",
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

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operationId, "audit-toolbox-client-handoff");
  assert.equal(envelope.mode, "audit_only");
  assert.equal(envelope.status, "success");
  assert.equal(envelope.reasonCode, "toolbox_client_handoff_ready");
  assert.equal(envelope.commandsRun.length, 2);
  assert.equal(envelope.details.toolboxClientHandoff.clientAccess.clientName, "codex");
  assert.equal(envelope.details.toolboxClientHandoff.clientAccess.configured, true);
  assert.equal(envelope.details.toolboxClientHandoff.runtimeClient.id, "codex");
  assert.equal(envelope.details.toolboxClientHandoff.runtimeClient.handoffStrategy, "env-reconnect");
  assert.equal(envelope.details.toolboxClientHandoff.readiness.clientMatchesRuntime, true);
  assert.equal(envelope.details.toolboxClientHandoff.readiness.accessConfigured, true);
  assert.equal(envelope.details.toolboxClientHandoff.handoffContract.mode, "reconnect");
  assert.deepEqual(
    envelope.details.toolboxClientHandoff.handoffContract.requiredEnvironmentFields,
    [
      "MAB_TOOLBOX_ACTIVE_PROFILE",
      "MAB_TOOLBOX_CLIENT_ID",
      "MAB_TOOLBOX_SESSION_MODE"
    ]
  );
  assert.deepEqual(
    envelope.details.toolboxClientHandoff.handoffContract.optionalEnvironmentFields,
    ["MAB_TOOLBOX_SESSION_POLICY_TOKEN"]
  );
  assert.deepEqual(
    envelope.details.toolboxClientHandoff.handoffContract.clearEnvironmentFields,
    ["MAB_TOOLBOX_SESSION_POLICY_TOKEN"]
  );
  assert.equal(
    envelope.details.toolboxClientHandoff.handoffContract.sessionPolicyTokenEnvVar,
    "MAB_TOOLBOX_SESSION_POLICY_TOKEN"
  );

  const persistedReport = JSON.parse(
    await readFile(path.join(stateRoot, "last-report.json"), "utf8")
  );
  assert.equal(persistedReport.operationId, "audit-toolbox-client-handoff");
});

test("windows installer cli show-state reads the persisted installer state", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const binDir = path.join(root, "bin");
  const stateRoot = path.join(root, "state");
  const configPath = path.join(root, "config.toml");
  const manifestPath = path.join(root, "installation.json");
  await mkdir(binDir, { recursive: true });

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const auditResult = await runInstallerCommand([
    "-Operation",
    "audit-install-surface",
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
    "-StateRoot",
    stateRoot,
    "-Json"
  ]);
  assert.equal(auditResult.exitCode, 0, auditResult.stderr);

  const stateResult = await runInstallerCommand([
    "-Operation",
    "show-state",
    "-StateRoot",
    stateRoot,
    "-Json"
  ]);

  assert.equal(stateResult.exitCode, 0, stateResult.stderr);
  const envelope = JSON.parse(stateResult.stdout);
  assert.equal(envelope.operationId, "show-state");
  assert.equal(envelope.status, "success");
  assert.equal(envelope.reasonCode, "state_loaded");
  assert.deepEqual(envelope.commandsRun, []);
  assert.equal(envelope.details.lastReport.operationId, "audit-install-surface");
  assert.equal(envelope.details.sessionState.lastOperationId, "audit-install-surface");
});

test("windows installer cli upgrades legacy session state before persisting a new operation", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only installer contract");
    return;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-installer-"));
  const stateRoot = path.join(root, "state");
  await mkdir(stateRoot, { recursive: true });
  await writeLegacyState(path.join(stateRoot, "install-session.json"));

  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runInstallerCommand([
    "-Operation",
    "detect-environment",
    "-StateRoot",
    stateRoot,
    "-Json"
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  const sessionState = JSON.parse(
    await readFile(path.join(stateRoot, "install-session.json"), "utf8")
  );
  assert.equal(sessionState.schemaVersion, 1);
  assert.equal(sessionState.lastOperationId, "detect-environment");
  assert.equal(sessionState.lastReasonCode, "environment_detected");
  assert.ok(Array.isArray(sessionState.operations));
  assert.equal(sessionState.operations.at(-1).operationId, "detect-environment");
});

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

async function writeLegacyState(targetPath) {
  const payload = {
    schemaVersion: 1,
    operations: []
  };
  await writeFile(targetPath, JSON.stringify(payload, null, 2), "utf8");
}
