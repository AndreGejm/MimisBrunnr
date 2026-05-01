#!/usr/bin/env node
import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  docCheck as documentDocCheck,
  documentCommands,
  extractHeadings as documentExtractHeadings,
  extractLinks as documentExtractLinks,
  extractText as documentExtractText
} from "./toolbox/families/documents.mjs";
import { csvProfile as dataCsvProfile, dataCommands } from "./toolbox/families/data.mjs";
import { mediaInfo as mediaMediaInfo, mediaCommands } from "./toolbox/families/media.mjs";
import { commandIndex as projectCommandIndex, diffSummary as projectDiffSummary, projectCommands } from "./toolbox/families/project.mjs";
import { chunkFile as textChunkFile, logSummary as textLogSummary, smartSearch as textSmartSearch, textCommands } from "./toolbox/families/text.mjs";
import { fileInventory as workspaceFileInventory, treeLite as workspaceTreeLite, workspaceCommands } from "./toolbox/families/workspace.mjs";
import { findToolByFamilyAndName, findToolById, readToolMetadata } from "./toolbox/registry.mjs";
import { isProbablyText, isSecretLikeFile, MAX_TEXT_FILE_BYTES, truncate } from "./toolbox/shared/text.mjs";

const DEFAULT_IGNORES = [
  ".git",
  ".pnpm-store",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
  "target"
];
const DEFAULT_MAX_ITEMS = 50;
const DEFAULT_MAX_CHARS = 240;
const DEFAULT_MAX_DEPTH = 4;
const COMMANDS = [
  "list-tools",
  "describe",
  "run",
  "workspace tree-lite",
  "workspace file-inventory",
  "text smart-search",
  "text chunk-file",
  "text log-summary",
  "documents extract-headings",
  "documents extract-links",
  "documents extract-text",
  "documents doc-check",
  "data csv-profile",
  "media media-info",
  "project diff-summary",
  "project command-index",
  "file-inventory",
  "tree-lite",
  "smart-search",
  "chunk-file",
  "log-summary",
  "diff-summary",
  "command-index",
  "config-map",
  "csv-profile",
  "extract-headings",
  "doc-check",
  "cleanup-candidates",
  "extract-text",
  "extract-links",
  "media-info"
];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {
    json: true,
    markdown: false,
    ignore: [],
    include: []
  };
  const positional = [];

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }

    const flag = value.slice(2);
    if (["json", "markdown", "dry-run"].includes(flag)) {
      flags[flag.replace("-", "")] = true;
      if (flag === "markdown") {
        flags.json = false;
      }
      continue;
    }

    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[flag] = true;
      continue;
    }

    index += 1;
    if (flag === "ignore" || flag === "include") {
      flags[flag].push(next);
    } else {
      flags[flag] = next;
    }
  }

  return { command, flags, positional };
}

function numberFlag(flags, name, fallback) {
  const value = Number(flags[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function resolveRoot(flags) {
  return path.resolve(flags.root ? String(flags.root) : process.cwd());
}

function toRelative(root, fullPath) {
  const relativePath = path.relative(root, fullPath);
  return relativePath === "" ? "." : relativePath.split(path.sep).join("/");
}

function baseEnvelope(tool, root, data = {}, warnings = [], errors = []) {
  return {
    tool,
    schema_version: "1.0",
    root,
    generated_at: new Date().toISOString(),
    data,
    warnings,
    errors
  };
}

async function assertReadableDirectory(root) {
  await access(root, constants.R_OK);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Root is not a directory: ${root}`);
  }
}

function buildIgnoreSet(flags) {
  return new Set([...DEFAULT_IGNORES, ...flags.ignore].filter(Boolean));
}

async function walk(root, flags, visitor) {
  const ignoreSet = buildIgnoreSet(flags);
  const ignoredDirs = new Set();
  const maxDepth = numberFlag(flags, "max-depth", DEFAULT_MAX_DEPTH);

  async function visitDirectory(currentPath, depth) {
    if (depth > maxDepth) {
      return;
    }

    const entries = await readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = toRelative(root, fullPath);
      if (entry.isDirectory() && ignoreSet.has(entry.name)) {
        ignoredDirs.add(entry.name);
        continue;
      }

      await visitor({
        fullPath,
        relativePath,
        entry,
        depth
      });

      if (entry.isDirectory()) {
        await visitDirectory(fullPath, depth + 1);
      }
    }
  }

  await visitDirectory(root, 0);
  return Array.from(ignoredDirs).sort();
}

async function readToolIndex() {
  return (await readToolMetadata()).map((tool) => ({
    id: tool.id,
    family: tool.family,
    name: tool.name,
    purpose: tool.purpose,
    description: tool.description,
    safe: tool.safe,
    mutates_files: tool.mutates_files,
    requires_git: tool.requires_git,
    requires_external_binaries: tool.requires_external_binaries,
    requires_network: tool.requires_network,
    reads_secrets: tool.reads_secrets,
    safety_level: tool.safety_level,
    stable_for_agent_use: tool.stable_for_agent_use,
    example: tool.example,
    status: tool.status
  }));
}

async function listTools(flags) {
  const root = resolveRoot(flags);
  return baseEnvelope("list-tools", root, {
    tools: await readToolIndex()
  });
}

function isConfigLikeFile(relativePath) {
  const fileName = path.basename(relativePath).toLowerCase();
  return (
    fileName.startsWith(".env") ||
    [
      "package.json",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "docker-compose.yml",
      "compose.yml",
      ".npmrc"
    ].includes(fileName) ||
    /\.(json|ya?ml|toml|ini|conf|config)$/iu.test(fileName)
  );
}

function extractEnvDefinitions(text) {
  const definitions = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line);
    if (match) {
      definitions.push(match[1]);
    }
  }
  return definitions;
}

function collectProcessEnvReferences(line) {
  const references = [];
  for (const match of line.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/gu)) {
    const tail = line.slice((match.index ?? 0) + match[0].length);
    references.push({ name: match[1], hasDefault: /^\s*(\?\?|\|\|)/u.test(tail) });
  }
  for (const match of line.matchAll(/process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/gu)) {
    const tail = line.slice((match.index ?? 0) + match[0].length);
    references.push({ name: match[1], hasDefault: /^\s*(\?\?|\|\|)/u.test(tail) });
  }
  return references;
}

async function configMap(flags) {
  const root = resolveRoot(flags);
  await assertReadableDirectory(root);
  const configFiles = new Set();
  const definitions = new Map();
  const references = new Map();

  await walk(root, flags, async ({ fullPath, relativePath, entry }) => {
    if (!entry.isFile()) {
      return;
    }

    if (isConfigLikeFile(relativePath)) {
      configFiles.add(relativePath);
    }

    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_TEXT_FILE_BYTES) {
      return;
    }

    if (isSecretLikeFile(relativePath)) {
      const text = await readFile(fullPath, "utf8");
      for (const name of extractEnvDefinitions(text)) {
        const files = definitions.get(name) ?? new Set();
        files.add(relativePath);
        definitions.set(name, files);
      }
      return;
    }

    const buffer = await readFile(fullPath);
    if (!isProbablyText(buffer)) {
      return;
    }

    const text = buffer.toString("utf8");
    for (const line of text.split(/\r?\n/u)) {
      for (const reference of collectProcessEnvReferences(line)) {
        const current = references.get(reference.name) ?? {
          name: reference.name,
          files: new Set(),
          has_default: false
        };
        current.files.add(relativePath);
        current.has_default = current.has_default || reference.hasDefault;
        references.set(reference.name, current);
      }
    }
  });

  const envVars = Array.from(new Set([...references.keys(), ...definitions.keys()])).sort().map((name) => {
    const reference = references.get(name);
    const definedIn = definitions.get(name);
    return {
      name,
      files: reference ? Array.from(reference.files).sort() : [],
      defined_in_files: definedIn ? Array.from(definedIn).sort() : [],
      has_default: reference?.has_default ?? false,
      required: reference ? !reference.has_default : false
    };
  });

  return baseEnvelope("config-map", root, {
    config_files: Array.from(configFiles).sort(),
    env_vars_referenced: envVars
  });
}

function classifyCleanupCandidate(relativePath, fileSizeBytes) {
  const normalized = relativePath.replace(/\\/gu, "/");
  const fileName = path.basename(normalized).toLowerCase();
  const extension = path.extname(fileName).toLowerCase();
  if (/^(tmp|temp|cache)\//iu.test(normalized) || [".tmp", ".temp", ".bak"].includes(extension)) {
    return {
      group: "safe_candidates",
      reason: "temporary_or_cache_file",
      path: normalized,
      size_bytes: fileSizeBytes
    };
  }
  if ([".log", ".old", ".orig"].includes(extension)) {
    return {
      group: "review_required",
      reason: "review_before_cleanup",
      path: normalized,
      size_bytes: fileSizeBytes
    };
  }
  return null;
}

async function cleanupCandidates(flags) {
  const root = resolveRoot(flags);
  await assertReadableDirectory(root);
  const maxItems = numberFlag(flags, "max-items", DEFAULT_MAX_ITEMS);
  const safeCandidates = [];
  const reviewRequired = [];

  await walk(root, flags, async ({ fullPath, relativePath, entry }) => {
    if (!entry.isFile()) {
      return;
    }
    const fileStat = await stat(fullPath);
    const candidate = classifyCleanupCandidate(relativePath, fileStat.size);
    if (!candidate) {
      return;
    }
    if (candidate.group === "safe_candidates") {
      safeCandidates.push(candidate);
    } else {
      reviewRequired.push(candidate);
    }
  });

  const byPath = (left, right) => left.path.localeCompare(right.path);
  return baseEnvelope("cleanup-candidates", root, {
    dry_run: true,
    deleted_files: 0,
    safe_candidates: safeCandidates.sort(byPath).slice(0, maxItems).map(({ group, ...candidate }) => candidate),
    review_required: reviewRequired.sort(byPath).slice(0, maxItems).map(({ group, ...candidate }) => candidate),
    never_delete: [".git", "node_modules", "state", "vault"]
  });
}

function toMarkdown(payload) {
  const lines = [`# ${payload.tool}`, "", `Root: ${payload.root}`, ""];
  if (Array.isArray(payload.data.tools)) {
    for (const tool of payload.data.tools) {
      lines.push(`- ${tool.name}: ${tool.purpose}`);
    }
  } else if (Array.isArray(payload.data.entries)) {
    for (const entry of payload.data.entries) {
      lines.push(`- ${entry.type}: ${entry.path}`);
    }
  } else if (Array.isArray(payload.data.matches)) {
    for (const match of payload.data.matches) {
      lines.push(`- ${match.path}:${match.line} (${match.score}) ${match.context}`);
    }
  } else if (Array.isArray(payload.data.chunks)) {
    for (const chunk of payload.data.chunks) {
      lines.push(`- ${chunk.id} ${chunk.lines} ${chunk.heading ?? "untitled"}: ${chunk.preview}`);
    }
  } else if (Array.isArray(payload.data.commands)) {
    for (const command of payload.data.commands) {
      lines.push(`- ${command.name}: ${command.command}`);
    }
  } else {
    lines.push("```json");
    lines.push(JSON.stringify(payload.data, null, 2));
    lines.push("```");
  }
  return `${lines.join("\n")}\n`;
}

async function dispatchToolCommand(command, flags, positional) {
  if (command === "list-tools") {
    return listTools(flags);
  }
  if (command === "file-inventory") {
    return workspaceFileInventory(flags);
  }
  if (command === "tree-lite") {
    return workspaceTreeLite(flags);
  }
  if (command === "smart-search") {
    return textSmartSearch(flags, positional);
  }
  if (command === "chunk-file") {
    return textChunkFile(flags, positional);
  }
  if (command === "log-summary") {
    return textLogSummary(flags, positional);
  }
  if (command === "diff-summary") {
    return projectDiffSummary(flags);
  }
  if (command === "command-index") {
    return projectCommandIndex(flags);
  }
  if (command === "config-map") {
    return configMap(flags);
  }
  if (command === "csv-profile") {
    return dataCsvProfile(flags, positional);
  }
  if (command === "extract-headings") {
    return documentExtractHeadings(flags, positional);
  }
  if (command === "doc-check") {
    return documentDocCheck(flags);
  }
  if (command === "cleanup-candidates") {
    return cleanupCandidates(flags);
  }
  if (command === "extract-text") {
    return documentExtractText(flags, positional);
  }
  if (command === "extract-links") {
    return documentExtractLinks(flags, positional);
  }
  if (command === "media-info") {
    return mediaMediaInfo(flags, positional);
  }
  return null;
}

async function dispatchFamilyCommand(command, flags, positional) {
  const familyCommands = {
    data: dataCommands,
    documents: documentCommands,
    media: mediaCommands,
    project: projectCommands,
    text: textCommands,
    workspace: workspaceCommands
  };
  const commands = familyCommands[command];
  if (!commands) {
    return null;
  }

  const [toolName, ...toolPositional] = positional;
  if (!toolName) {
    return baseEnvelope(command, resolveRoot(flags), {
      tools: Object.keys(commands).sort()
    }, [], [`Missing ${command} tool name`]);
  }

  const handler = commands[toolName];
  if (!handler) {
    return baseEnvelope(command, resolveRoot(flags), {}, [], [`Unknown ${command} tool: ${toolName}`]);
  }
  return handler(flags, toolPositional);
}

async function describeTool(flags, positional) {
  const root = resolveRoot(flags);
  const tool = positional.length >= 2
    ? await findToolByFamilyAndName(positional[0], positional[1])
    : await findToolById(positional[0]);

  if (!tool) {
    const lookup = positional.join(" ");
    return baseEnvelope("describe", root, {}, [], [`Unknown tool: ${lookup}`]);
  }

  return baseEnvelope("describe", root, {
    tool
  });
}

async function runRegisteredTool(flags, positional) {
  const [toolId, ...toolPositional] = positional;
  if (!toolId) {
    return baseEnvelope("run", resolveRoot(flags), {}, [], ["Missing tool id"]);
  }

  const tool = await findToolById(toolId);
  if (!tool) {
    return baseEnvelope("run", resolveRoot(flags), {}, [], [`Unknown tool: ${toolId}`]);
  }

  const result = await dispatchToolCommand(tool.name, flags, toolPositional);
  if (!result) {
    return baseEnvelope("run", resolveRoot(flags), {}, [], [`Registered tool has no launcher handler: ${toolId}`]);
  }
  return result;
}

async function run() {
  const { command, flags, positional } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || command === "--help") {
    return baseEnvelope("help", process.cwd(), {
      usage: "node \"AI tools/scripts/ai-tools.mjs\" <command> [args] [--json]",
      commands: COMMANDS
    });
  }

  if (command === "describe") {
    return describeTool(flags, positional);
  }
  if (command === "run") {
    return runRegisteredTool(flags, positional);
  }

  const familyResult = await dispatchFamilyCommand(command, flags, positional);
  if (familyResult) {
    return familyResult;
  }

  const commandResult = await dispatchToolCommand(command, flags, positional);
  if (commandResult) {
    return commandResult;
  }

  return baseEnvelope(command, resolveRoot(flags), {}, [], [`Unknown command: ${command}`]);
}

try {
  const payload = await run();
  process.stdout.write((payload.data && payload.data.markdown) || (parseArgs(process.argv.slice(2)).flags.markdown ? toMarkdown(payload) : `${JSON.stringify(payload, null, 2)}\n`));
  process.exit(payload.errors.length > 0 ? 1 : 0);
} catch (error) {
  const root = process.cwd();
  process.stdout.write(`${JSON.stringify(baseEnvelope("ai-tools", root, {}, [], [error instanceof Error ? error.message : String(error)]), null, 2)}\n`);
  process.exit(1);
}
