#!/usr/bin/env node
import path from "node:path";
import { configMap as configConfigMap, configCommands } from "./toolbox/families/config.mjs";
import {
  docCheck as documentDocCheck,
  documentCommands,
  extractHeadings as documentExtractHeadings,
  extractLinks as documentExtractLinks,
  extractText as documentExtractText
} from "./toolbox/families/documents.mjs";
import { csvProfile as dataCsvProfile, dataCommands } from "./toolbox/families/data.mjs";
import { cleanupCandidates as maintenanceCleanupCandidates, maintenanceCommands } from "./toolbox/families/maintenance.mjs";
import { mediaInfo as mediaMediaInfo, mediaCommands } from "./toolbox/families/media.mjs";
import { commandIndex as projectCommandIndex, diffSummary as projectDiffSummary, projectCommands } from "./toolbox/families/project.mjs";
import { chunkFile as textChunkFile, logSummary as textLogSummary, smartSearch as textSmartSearch, textCommands } from "./toolbox/families/text.mjs";
import { fileInventory as workspaceFileInventory, treeLite as workspaceTreeLite, workspaceCommands } from "./toolbox/families/workspace.mjs";
import { findToolByFamilyAndName, findToolById, readToolMetadata } from "./toolbox/registry.mjs";
import { truncate } from "./toolbox/shared/text.mjs";

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
  "config config-map",
  "maintenance cleanup-candidates",
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

function resolveRoot(flags) {
  return path.resolve(flags.root ? String(flags.root) : process.cwd());
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
    return configConfigMap(flags);
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
    return maintenanceCleanupCandidates(flags);
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
    config: configCommands,
    data: dataCommands,
    documents: documentCommands,
    maintenance: maintenanceCommands,
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
