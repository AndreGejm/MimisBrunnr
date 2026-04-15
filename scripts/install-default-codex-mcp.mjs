#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildInstallationManifest,
  getDefaultInstallationManifestPath,
  getDefaultWindowsLauncherBinDir,
  getMcpWrapperPath,
  getDefaultCodexConfigPath,
  getRepoRootFromScript,
  upsertCodexMcpServerBlock,
  writeInstallationManifest
} from "./lib/default-access.mjs";

function parseArgs(argv) {
  const options = {
    configPath: getDefaultCodexConfigPath(),
    dryRun: false,
    manifestPath: getDefaultInstallationManifestPath(),
    serverName: "mimir"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (value === "--config") {
      options.configPath = argv[index + 1];
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

function backupPathFor(configPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${configPath}.${stamp}.bak`;
}

const options = parseArgs(process.argv.slice(2));
const repoRoot = getRepoRootFromScript(import.meta.url);
const wrapperPath = getMcpWrapperPath(repoRoot);
const original = existsSync(options.configPath)
  ? readFileSync(options.configPath, "utf8")
  : "";
const updated = upsertCodexMcpServerBlock(
  original,
  options.serverName,
  process.execPath,
  [wrapperPath]
);
const manifest = buildInstallationManifest({
  repoRoot,
  manifestPath: options.manifestPath,
  codexConfigPath: options.configPath,
  launcherBinDir: getDefaultWindowsLauncherBinDir(),
  launcherNames: ["mimir"],
  serverName: options.serverName
});

if (options.dryRun) {
  process.stdout.write(
    JSON.stringify(
      {
        config: updated,
        manifest
      },
      null,
      2
    )
  );
  process.stdout.write("\n");
  process.exit(0);
}

mkdirSync(path.dirname(options.configPath), { recursive: true });
if (existsSync(options.configPath)) {
  copyFileSync(options.configPath, backupPathFor(options.configPath));
}
writeFileSync(options.configPath, updated, "utf8");
writeInstallationManifest(options.manifestPath, manifest);
process.stdout.write(
  `Configured Codex MCP server '${options.serverName}' in ${options.configPath} and updated ${options.manifestPath}\n`
);
