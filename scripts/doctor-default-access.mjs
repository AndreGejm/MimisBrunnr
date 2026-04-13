#!/usr/bin/env node

import process from "node:process";

import {
  evaluateDefaultAccess,
  getDefaultCodexConfigPath,
  getDefaultInstallationManifestPath,
  getDefaultWindowsLauncherBinDir,
  getRepoRootFromScript
} from "./lib/default-access.mjs";

function parseArgs(argv) {
  const options = {
    binDir: getDefaultWindowsLauncherBinDir(),
    configPath: getDefaultCodexConfigPath(),
    json: false,
    manifestPath: getDefaultInstallationManifestPath(),
    repoRoot: getRepoRootFromScript(import.meta.url),
    serverName: "multiagentbrain"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      options.json = true;
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

function renderHumanReport(report) {
  return [
    `status: ${report.status}`,
    `repoRoot: ${report.repoRoot}`,
    `codexMcp: ${report.codexMcp.configured ? "configured" : "missing"} (${report.codexMcp.configPath})`,
    `launchers: ${report.launchers.files.every((item) => item.exists) ? "installed" : "missing"} (${report.launchers.binDir})`,
    `launchersOnPath: ${report.launchers.onPath ? "yes" : "no"}`,
    `manifest: ${report.manifest.exists ? "present" : "missing"} (${report.manifest.path})`,
    report.recommendations.length > 0
      ? `next: ${report.recommendations.join(" ")}`
      : "next: no action needed"
  ].join("\n");
}

const options = parseArgs(process.argv.slice(2));
const report = evaluateDefaultAccess({
  repoRoot: options.repoRoot,
  codexConfigPath: options.configPath,
  launcherBinDir: options.binDir,
  manifestPath: options.manifestPath,
  serverName: options.serverName
});

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

process.stdout.write(`${renderHumanReport(report)}\n`);
