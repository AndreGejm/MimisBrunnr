#!/usr/bin/env node
import { parseArgs } from "./toolbox/cli/args.mjs";
import { COMMANDS } from "./toolbox/cli/catalog.mjs";
import { describeToolCommand, listToolsCommand, runRegisteredToolCommand } from "./toolbox/cli/commands.mjs";
import { formatPayload } from "./toolbox/cli/format.mjs";
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
import { resolveRoot } from "./toolbox/shared/args.mjs";
import { baseEnvelope } from "./toolbox/shared/output.mjs";

async function dispatchToolCommand(command, flags, positional) {
  if (command === "list-tools") {
    return listToolsCommand(flags);
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

async function run(parsed) {
  const { command, flags, positional } = parsed;
  if (!command || command === "help" || command === "--help") {
    return baseEnvelope("help", process.cwd(), {
      usage: "node \"AI tools/scripts/ai-tools.mjs\" <command> [args] [--json]",
      commands: COMMANDS
    });
  }

  if (command === "describe") {
    return describeToolCommand(flags, positional);
  }
  if (command === "run") {
    return runRegisteredToolCommand(flags, positional, dispatchToolCommand);
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
  const parsed = parseArgs(process.argv.slice(2));
  const payload = await run(parsed);
  process.stdout.write(formatPayload(payload, parsed.flags));
  process.exit(payload.errors.length > 0 ? 1 : 0);
} catch (error) {
  const root = process.cwd();
  process.stdout.write(`${JSON.stringify(baseEnvelope("ai-tools", root, {}, [], [error instanceof Error ? error.message : String(error)]), null, 2)}\n`);
  process.exit(1);
}
