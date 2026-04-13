import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function toTomlSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getRepoRootFromScript(importMetaUrl) {
  const scriptPath = fileURLToPath(importMetaUrl);
  return path.resolve(path.dirname(scriptPath), "..");
}

export function getDefaultCodexConfigPath() {
  return path.join(os.homedir(), ".codex", "config.toml");
}

export function getDefaultInstallationManifestPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".multiagentbrain", "installation.json");
}

export function getDefaultWindowsLauncherBinDir() {
  if (process.env.APPDATA?.trim()) {
    return path.join(process.env.APPDATA, "npm");
  }

  return path.join(os.homedir(), "AppData", "Roaming", "npm");
}

export function getBuiltCliEntrypoint(repoRoot) {
  return path.join(repoRoot, "apps", "brain-cli", "dist", "main.js");
}

export function getBuiltMcpEntrypoint(repoRoot) {
  return path.join(repoRoot, "apps", "brain-mcp", "dist", "main.js");
}

export function getCliWrapperPath(repoRoot) {
  return path.join(repoRoot, "scripts", "launch-brain-cli.mjs");
}

export function getMcpWrapperPath(repoRoot) {
  return path.join(repoRoot, "scripts", "launch-brain-mcp.mjs");
}

export function renderCodexMcpServerBlock(name, command, args) {
  const renderedArgs = args.map((value) => toTomlSingleQuoted(value)).join(", ");
  return [
    `[mcp_servers.${name}]`,
    `command = ${toTomlSingleQuoted(command)}`,
    `args = [${renderedArgs}]`,
    ""
  ].join("\n");
}

export function upsertCodexMcpServerBlock(configText, name, command, args) {
  const normalized = normalizeNewlines(configText);
  const trimmedConfig = normalized.trimEnd();
  const block = renderCodexMcpServerBlock(name, command, args).trimEnd();
  const sectionHeader = `[mcp_servers.${name}]`;
  const blockStart = trimmedConfig.indexOf(sectionHeader);

  if (blockStart >= 0) {
    const remainder = trimmedConfig.slice(blockStart + sectionHeader.length);
    const nextSectionOffset = remainder.search(/\n\[[^\n]+\]/);
    const blockEnd =
      nextSectionOffset === -1
        ? trimmedConfig.length
        : blockStart + sectionHeader.length + nextSectionOffset;
    const prefix = trimmedConfig.slice(0, blockStart);
    const suffix = trimmedConfig.slice(blockEnd).replace(/^\n+/, "\n");
    return `${prefix}${block}${suffix}\n`;
  }

  const mcpRootRegex = /^\[mcp_servers\]\s*$/m;
  if (mcpRootRegex.test(trimmedConfig)) {
    return `${trimmedConfig.replace(mcpRootRegex, `[mcp_servers]\n${block}`)}\n`;
  }

  const prefix = trimmedConfig.length > 0 ? `${trimmedConfig}\n\n` : "";
  return `${prefix}[mcp_servers]\n${block}\n`;
}

export function hasCodexMcpServerBlock(configText, name) {
  return new RegExp(`^\\[mcp_servers\\.${escapeRegex(name)}\\]\\s*$`, "m").test(
    normalizeNewlines(configText)
  );
}

export function renderWindowsCmdShim(nodeExecutable, targetScript) {
  return [
    "@echo off",
    `\"${nodeExecutable}\" \"${targetScript}\" %*`,
    ""
  ].join("\r\n");
}

export function getCorepackCommand() {
  return process.platform === "win32" ? "corepack.cmd" : "corepack";
}

export function pathContainsBinDir(pathValue, binDir) {
  if (!pathValue?.trim()) {
    return false;
  }

  const normalizedTarget = path.resolve(binDir).toLowerCase();
  return pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => path.resolve(entry).toLowerCase() === normalizedTarget);
}

export function buildInstallationManifest({
  repoRoot,
  manifestPath,
  codexConfigPath,
  launcherBinDir,
  launcherNames,
  serverName,
  nodeExecutable = process.execPath,
  installedAt = new Date().toISOString(),
  pathValue = process.env.PATH ?? ""
}) {
  return {
    schemaVersion: 1,
    installation: {
      installedAt,
      repoRoot,
      nodeExecutable,
      codexConfigPath,
      launcherBinDir,
      launcherNames,
      serverName,
      manifestPath,
      cliWrapperPath: getCliWrapperPath(repoRoot),
      mcpWrapperPath: getMcpWrapperPath(repoRoot),
      launcherBinOnPath: pathContainsBinDir(pathValue, launcherBinDir)
    }
  };
}

export function writeInstallationManifest(manifestPath, manifest) {
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

export function readJsonFileIfExists(filePath) {
  if (!existsSync(filePath)) {
    return {
      exists: false,
      error: null,
      value: null
    };
  }

  try {
    return {
      exists: true,
      error: null,
      value: JSON.parse(readFileSync(filePath, "utf8"))
    };
  } catch (error) {
    return {
      exists: true,
      error: error instanceof Error ? error.message : String(error),
      value: null
    };
  }
}

export function readTextFileIfExists(filePath) {
  if (!existsSync(filePath)) {
    return "";
  }

  return readFileSync(filePath, "utf8");
}

export function evaluateDefaultAccess({
  repoRoot,
  codexConfigPath = getDefaultCodexConfigPath(),
  launcherBinDir = getDefaultWindowsLauncherBinDir(),
  manifestPath = getDefaultInstallationManifestPath(),
  serverName = "multiagentbrain",
  pathValue = process.env.PATH ?? ""
}) {
  const cliWrapperPath = getCliWrapperPath(repoRoot);
  const mcpWrapperPath = getMcpWrapperPath(repoRoot);
  const launcherFiles = ["multiagentbrain.cmd", "mab.cmd"].map((fileName) => ({
    fileName,
    path: path.join(launcherBinDir, fileName),
    exists: existsSync(path.join(launcherBinDir, fileName))
  }));
  const configText = readTextFileIfExists(codexConfigPath);
  const manifest = readJsonFileIfExists(manifestPath);
  const builtCliEntrypoint = getBuiltCliEntrypoint(repoRoot);
  const builtMcpEntrypoint = getBuiltMcpEntrypoint(repoRoot);
  const launchersInstalled = launcherFiles.every((launcher) => launcher.exists);
  const launchersOnPath = pathContainsBinDir(pathValue, launcherBinDir);
  const codexConfigured = hasCodexMcpServerBlock(configText, serverName);

  const report = {
    status: "degraded",
    repoRoot,
    wrappers: {
      cli: {
        path: cliWrapperPath,
        exists: existsSync(cliWrapperPath)
      },
      mcp: {
        path: mcpWrapperPath,
        exists: existsSync(mcpWrapperPath)
      }
    },
    builtEntrypoints: {
      cli: {
        path: builtCliEntrypoint,
        exists: existsSync(builtCliEntrypoint)
      },
      mcp: {
        path: builtMcpEntrypoint,
        exists: existsSync(builtMcpEntrypoint)
      }
    },
    codexMcp: {
      configPath: codexConfigPath,
      exists: existsSync(codexConfigPath),
      serverName,
      configured: codexConfigured
    },
    launchers: {
      binDir: launcherBinDir,
      onPath: launchersOnPath,
      files: launcherFiles
    },
    manifest: {
      path: manifestPath,
      exists: manifest.exists,
      valid: manifest.exists && manifest.error === null,
      error: manifest.error,
      content: manifest.value
    },
    recommendations: []
  };

  const fullyInstalled =
    report.wrappers.cli.exists &&
    report.wrappers.mcp.exists &&
    report.builtEntrypoints.cli.exists &&
    report.builtEntrypoints.mcp.exists &&
    report.codexMcp.configured &&
    launchersInstalled &&
    launchersOnPath &&
    report.manifest.valid;

  const nothingInstalled =
    !report.codexMcp.configured && !launchersInstalled && !report.manifest.exists;

  if (fullyInstalled) {
    report.status = "healthy";
  } else if (nothingInstalled) {
    report.status = "unavailable";
  }

  if (!report.codexMcp.configured) {
    report.recommendations.push("Run install-default-codex-mcp.mjs or install-default-access.mjs.");
  }

  if (!launchersInstalled || !launchersOnPath) {
    report.recommendations.push(
      "Run install-multiagentbrain-launchers.mjs or install-default-access.mjs and ensure the launcher bin directory is on PATH."
    );
  }

  if (!report.manifest.exists) {
    report.recommendations.push("Write the fixed install manifest via install-default-access.mjs.");
  } else if (!report.manifest.valid) {
    report.recommendations.push("Repair the fixed install manifest via install-default-access.mjs.");
  }

  return report;
}

export function ensureBuiltEntrypoint(repoRoot, entrypointPath) {
  if (existsSync(entrypointPath)) {
    return;
  }

  const build = spawnSync(getCorepackCommand(), ["pnpm", "build"], {
    cwd: repoRoot,
    stdio: "inherit"
  });

  if (build.error) {
    throw build.error;
  }

  if (build.status !== 0 || !existsSync(entrypointPath)) {
    throw new Error(
      `Failed to build MultiAgentBrain entrypoint at ${entrypointPath}.`
    );
  }
}
