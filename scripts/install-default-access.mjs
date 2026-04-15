#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildInstallationManifest,
  COMPATIBILITY_LAUNCHER_NAMES,
  evaluateDefaultAccess,
  getCliWrapperPath,
  getDefaultCodexConfigPath,
  getDefaultInstallationManifestPath,
  getDefaultWindowsLauncherBinDir,
  getMcpWrapperPath,
  getRepoRootFromScript,
  renderWindowsCmdShim,
  upsertCodexMcpServerBlock,
  writeInstallationManifest
} from "./lib/default-access.mjs";

function parseArgs(argv) {
  const options = {
    binDir: getDefaultWindowsLauncherBinDir(),
    configPath: getDefaultCodexConfigPath(),
    dryRun: false,
    manifestPath: getDefaultInstallationManifestPath(),
    repoRoot: getRepoRootFromScript(import.meta.url),
    serverName: "mimir"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (value === "--repo-root") {
      options.repoRoot = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--config") {
      options.configPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--bin-dir") {
      options.binDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--manifest") {
      options.manifestPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--server-name") {
      options.serverName = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

function backupPathFor(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${filePath}.${stamp}.bak`;
}

const options = parseArgs(process.argv.slice(2));
const mcpWrapperPath = getMcpWrapperPath(options.repoRoot);
const cliWrapperPath = getCliWrapperPath(options.repoRoot);
const originalConfig = existsSync(options.configPath)
  ? readFileSync(options.configPath, "utf8")
  : "";
const updatedConfig = upsertCodexMcpServerBlock(
  originalConfig,
  options.serverName,
  process.execPath,
  [mcpWrapperPath]
);
const launcherNames = COMPATIBILITY_LAUNCHER_NAMES;
const launchers = launcherNames.map((launcherName) => ({
  fileName: `${launcherName}.cmd`,
  content: renderWindowsCmdShim(process.execPath, cliWrapperPath)
}));
const manifest = buildInstallationManifest({
  repoRoot: options.repoRoot,
  manifestPath: options.manifestPath,
  codexConfigPath: options.configPath,
  launcherBinDir: options.binDir,
  launcherNames: launchers.map((item) => item.fileName.replace(/\.cmd$/i, "")),
  serverName: options.serverName
});

if (options.dryRun) {
  process.stdout.write(
    `${JSON.stringify(
      {
        codexConfigPath: options.configPath,
        launcherBinDir: options.binDir,
        manifestPath: options.manifestPath,
        serverName: options.serverName,
        launcherFiles: launchers.map((item) => item.fileName),
        manifest
      },
      null,
      2
    )}\n`
  );
  process.exit(0);
}

mkdirSync(path.dirname(options.configPath), { recursive: true });
if (existsSync(options.configPath)) {
  copyFileSync(options.configPath, backupPathFor(options.configPath));
}
writeFileSync(options.configPath, updatedConfig, "utf8");

mkdirSync(options.binDir, { recursive: true });
for (const launcher of launchers) {
  writeFileSync(path.join(options.binDir, launcher.fileName), launcher.content, "utf8");
}

if (existsSync(options.manifestPath)) {
  copyFileSync(options.manifestPath, backupPathFor(options.manifestPath));
}
writeInstallationManifest(options.manifestPath, manifest);

const report = evaluateDefaultAccess({
  repoRoot: options.repoRoot,
  codexConfigPath: options.configPath,
  launcherBinDir: options.binDir,
  manifestPath: options.manifestPath,
  serverName: options.serverName
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
