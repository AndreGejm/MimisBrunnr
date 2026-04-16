import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COMPATIBILITY_LAUNCHER_NAMES = Object.freeze([
  "mimir",
  "mimir-cli",
  "mimis",
  "mimis-cli",
  "mimisbrunnr",
  "mimisbrunnr-cli",
  "mimirbrunnr",
  "mimirbrunnr-cli",
  "mimirsbrunnr",
  "mimirsbrunnr-cli",
  "brain",
  "brain-cli",
  "brain.CLI",
  "multiagentbrain",
  "multiagentbrain-cli",
  "multiagent-brain",
  "multi-agent-brain",
  "multi-agent-brain-cli",
  "mab"
]);

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
  return path.join(homeDir, ".mimir", "installation.json");
}

export function getDefaultWindowsLauncherBinDir() {
  if (process.env.APPDATA?.trim()) {
    return path.join(process.env.APPDATA, "npm");
  }

  return path.join(os.homedir(), "AppData", "Roaming", "npm");
}

export function getBuiltCliEntrypoint(repoRoot) {
  return path.join(repoRoot, "apps", "mimir-cli", "dist", "main.js");
}

export function getBuiltMcpEntrypoint(repoRoot) {
  return path.join(repoRoot, "apps", "mimir-mcp", "dist", "main.js");
}

export function getCliWrapperPath(repoRoot) {
  return path.join(repoRoot, "scripts", "launch-mimir-cli.mjs");
}

export function getMcpWrapperPath(repoRoot) {
  return path.join(repoRoot, "scripts", "launch-mimir-mcp.mjs");
}

export function getDockerToolsComposePath(repoRoot) {
  return path.join(repoRoot, "docker", "compose.tools.yml");
}

export function getDockerToolRegistryDir(repoRoot) {
  return path.join(repoRoot, "docker", "tool-registry");
}

const DOCKER_TOOL_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const DOCKER_TOOL_KINDS = new Set(["cli", "coding_agent", "repo_indexer", "mcp_server"]);
const DOCKER_TOOL_MOUNT_ACCESSES = new Set(["none", "read_only", "read_write"]);
const DOCKER_TOOL_MEMORY_POLICIES = new Set(["none", "session_only", "draft_note_only"]);

export function evaluateDockerToolAssets(repoRoot) {
  const composePath = getDockerToolsComposePath(repoRoot);
  const registryDir = getDockerToolRegistryDir(repoRoot);
  const manifestFiles = listDockerToolManifestFiles(registryDir);
  const composeExists = existsSync(composePath);
  const registryExists = existsSync(registryDir);
  const manifests = summarizeDockerToolManifests(registryDir, manifestFiles);
  const invalidManifestCount = manifests.filter((manifest) => manifest.status === "invalid").length;
  const tools = manifests
    .filter((manifest) => manifest.status === "valid")
    .map((manifest) => manifest.tool);

  return {
    reusable: composeExists && registryExists && manifestFiles.length > 0 && invalidManifestCount === 0,
    compose: {
      path: composePath,
      exists: composeExists
    },
    registry: {
      path: registryDir,
      exists: registryExists,
      manifestCount: manifestFiles.length,
      invalidManifestCount,
      manifestFiles,
      manifests,
      tools
    }
  };
}

function listDockerToolManifestFiles(registryDir) {
  if (!existsSync(registryDir)) {
    return [];
  }

  try {
    return readdirSync(registryDir)
      .filter((entry) => entry.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function summarizeDockerToolManifests(registryDir, manifestFiles) {
  return manifestFiles.map((fileName) =>
    summarizeDockerToolManifest(path.join(registryDir, fileName), fileName)
  );
}

function summarizeDockerToolManifest(filePath, fileName) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      fileName,
      status: "invalid",
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }

  const errors = [];
  const tool = buildDockerToolSummary(parsed, errors);
  if (errors.length > 0 || !tool) {
    return {
      fileName,
      status: "invalid",
      errors
    };
  }

  return {
    fileName,
    status: "valid",
    errors: [],
    tool
  };
}

function buildDockerToolSummary(value, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("manifest must be a JSON object");
    return null;
  }

  const manifest = value;
  const id = readRequiredPattern(manifest, "id", DOCKER_TOOL_ID_PATTERN, errors);
  const kind = readRequiredEnum(manifest, "kind", DOCKER_TOOL_KINDS, errors);
  const image = readRequiredString(manifest, "image", errors);
  const dockerProfile = readRequiredPattern(manifest, "dockerProfile", DOCKER_TOOL_ID_PATTERN, errors);
  const entrypoint = readRequiredStringArray(manifest, "entrypoint", errors);
  readRequiredString(manifest, "displayName", errors);
  readRequiredStringArray(manifest, "capabilities", errors);
  const mounts = readRequiredObject(manifest, "mounts", errors);
  const workspaceMount = mounts
    ? readRequiredEnum(mounts, "mounts.workspace", DOCKER_TOOL_MOUNT_ACCESSES, errors, "workspace")
    : undefined;
  const cacheMount = mounts
    ? readRequiredEnum(mounts, "mounts.cache", DOCKER_TOOL_MOUNT_ACCESSES, errors, "cache")
    : undefined;
  const mimisbrunnrMount = mounts
    ? readRequiredEnum(mounts, "mounts.mimisbrunnr", DOCKER_TOOL_MOUNT_ACCESSES, errors, "mimisbrunnr")
    : undefined;
  if (mimisbrunnrMount && mimisbrunnrMount !== "none") {
    errors.push("mounts.mimisbrunnr must be none");
  }

  const memoryWritePolicy = readRequiredEnum(
    manifest,
    "memoryWritePolicy",
    DOCKER_TOOL_MEMORY_POLICIES,
    errors
  );
  const allowedMimirCommands = readRequiredStringArray(
    manifest,
    "allowedMimirCommands",
    errors,
    "allowedMimirCommands",
    { allowEmpty: true }
  );
  readRequiredString(manifest, "authRole", errors);
  const requiresOperatorReview = readRequiredBoolean(manifest, "requiresOperatorReview", errors);
  const healthcheck = readRequiredObject(manifest, "healthcheck", errors);
  if (healthcheck) {
    readRequiredStringArray(healthcheck, "healthcheck.command", errors, "command");
  }

  if (errors.length > 0) {
    return null;
  }

  return {
    id,
    kind,
    image,
    dockerProfile,
    entrypoint,
    workspaceMount,
    cacheMount,
    memoryWritePolicy,
    allowedMimirCommands,
    requiresOperatorReview
  };
}

function readRequiredObject(record, field, errors, propertyName = field) {
  const value = record[propertyName];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${field} must be a JSON object`);
    return null;
  }

  return value;
}

function readRequiredString(record, field, errors, propertyName = field) {
  const value = record[propertyName];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${field} must be a non-empty string`);
    return undefined;
  }

  return value;
}

function readRequiredPattern(record, field, pattern, errors, propertyName = field) {
  const value = readRequiredString(record, field, errors, propertyName);
  if (value !== undefined && !pattern.test(value)) {
    errors.push(`${field} must match ${pattern}`);
  }

  return value;
}

function readRequiredEnum(record, field, allowedValues, errors, propertyName = field) {
  const value = readRequiredString(record, field, errors, propertyName);
  if (value !== undefined && !allowedValues.has(value)) {
    errors.push(`${field} must be one of ${[...allowedValues].join(", ")}`);
  }

  return value;
}

function readRequiredBoolean(record, field, errors, propertyName = field) {
  const value = record[propertyName];
  if (typeof value !== "boolean") {
    errors.push(`${field} must be a boolean`);
    return undefined;
  }

  return value;
}

function readRequiredStringArray(record, field, errors, propertyName = field, options = {}) {
  const value = record[propertyName];
  if (!Array.isArray(value)) {
    errors.push(`${field} must be a string array`);
    return undefined;
  }

  if (value.length === 0 && options.allowEmpty !== true) {
    errors.push(`${field} must be a non-empty string array`);
    return undefined;
  }

  const strings = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(`${field}[${index}] must be a non-empty string`);
      continue;
    }
    strings.push(item);
  }

  return strings;
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
  serverName = "mimir",
  pathValue = process.env.PATH ?? ""
}) {
  const cliWrapperPath = getCliWrapperPath(repoRoot);
  const mcpWrapperPath = getMcpWrapperPath(repoRoot);
  const launcherFiles = COMPATIBILITY_LAUNCHER_NAMES.map((name) => `${name}.cmd`).map((fileName) => ({
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

  const dockerTools = evaluateDockerToolAssets(repoRoot);

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
    dockerTools,
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
      "Run install-mimir-launchers.mjs or install-default-access.mjs and ensure the launcher bin directory is on PATH."
    );
  }

  if (!dockerTools.reusable) {
    report.recommendations.push(
      "Package reusable Docker tool assets: docker/compose.tools.yml and valid docker/tool-registry/*.json manifests."
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
      `Failed to build mimir entrypoint at ${entrypointPath}.`
    );
  }
}
