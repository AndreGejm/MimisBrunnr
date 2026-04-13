#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildInstallationManifest,
  getCliWrapperPath,
  getDefaultCodexConfigPath,
  getDefaultInstallationManifestPath,
  getDefaultWindowsLauncherBinDir,
  getRepoRootFromScript,
  renderWindowsCmdShim,
  writeInstallationManifest
} from "./lib/default-access.mjs";

function parseArgs(argv) {
  const options = {
    binDir: getDefaultWindowsLauncherBinDir(),
    dryRun: false,
    manifestPath: getDefaultInstallationManifestPath()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") {
      options.dryRun = true;
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
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));
const repoRoot = getRepoRootFromScript(import.meta.url);
const wrapperPath = getCliWrapperPath(repoRoot);
const shims = [
  {
    fileName: "multiagentbrain.cmd",
    content: renderWindowsCmdShim(process.execPath, wrapperPath)
  },
  {
    fileName: "mab.cmd",
    content: renderWindowsCmdShim(process.execPath, wrapperPath)
  }
];
const manifest = buildInstallationManifest({
  repoRoot,
  manifestPath: options.manifestPath,
  codexConfigPath: getDefaultCodexConfigPath(),
  launcherBinDir: options.binDir,
  launcherNames: shims.map((shim) => shim.fileName.replace(/\.cmd$/i, "")),
  serverName: "multiagentbrain"
});

if (options.dryRun) {
  process.stdout.write(
    JSON.stringify(
      {
        binDir: options.binDir,
        files: shims.map((shim) => shim.fileName),
        manifest
      },
      null,
      2
    )
  );
  process.stdout.write("\n");
  process.exit(0);
}

mkdirSync(options.binDir, { recursive: true });
for (const shim of shims) {
  writeFileSync(path.join(options.binDir, shim.fileName), shim.content, "utf8");
}
writeInstallationManifest(options.manifestPath, manifest);

process.stdout.write(
  `Installed launchers into ${options.binDir} and updated ${options.manifestPath}: ${shims
    .map((shim) => shim.fileName)
    .join(", ")}\n`
);
