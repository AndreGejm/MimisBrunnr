#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import process from "node:process";
import type {
  ActorContext,
  ActorRole,
  DraftNoteRequest,
  GetDecisionSummaryRequest,
  PromoteNoteRequest,
  QueryHistoryRequest,
  RetrieveContextRequest,
  ValidateNoteRequest
} from "@multi-agent-brain/contracts";
import { buildServiceContainer, loadEnvironment } from "@multi-agent-brain/infrastructure";

type CommandName =
  | "search-context"
  | "fetch-decision-summary"
  | "draft-note"
  | "validate-note"
  | "promote-note"
  | "query-history";

type JsonRecord = Record<string, unknown>;

interface ParsedCli {
  command?: CommandName;
  options: {
    help: boolean;
    pretty: boolean;
    stdin: boolean;
    inputPath?: string;
    inlineJson?: string;
  };
}

const COMMANDS: ReadonlyArray<CommandName> = [
  "search-context",
  "fetch-decision-summary",
  "draft-note",
  "validate-note",
  "promote-note",
  "query-history"
];

const DEFAULT_ACTOR_ROLE: Record<CommandName, ActorRole> = {
  "search-context": "retrieval",
  "fetch-decision-summary": "retrieval",
  "draft-note": "writer",
  "validate-note": "orchestrator",
  "promote-note": "orchestrator",
  "query-history": "operator"
};

async function main(): Promise<void> {
  const parsed = parseCli(process.argv.slice(2));

  if (parsed.options.help || !parsed.command) {
    printUsage();
    process.exitCode = parsed.command ? 0 : 1;
    return;
  }

  const container = buildServiceContainer(loadEnvironment());
  try {
    const request = await loadCommandPayload(parsed.options);
    const actor = buildActorContext(parsed.command, request.actor);
    const normalizedRequest = { ...request, actor };

    const result = await runCommand(parsed.command, normalizedRequest, container);
    writeJson(result, parsed.options.pretty);

    process.exitCode = shouldFailProcess(result, parsed.command) ? 1 : 0;
  } catch (error) {
    writeJson(
      {
        ok: false,
        error: {
          code: "cli_failed",
          message: error instanceof Error ? error.message : String(error)
        }
      },
      parsed.options.pretty
    );
    process.exitCode = 1;
  } finally {
    container.dispose();
  }
}

async function runCommand(
  command: CommandName,
  request: JsonRecord,
  container: ReturnType<typeof buildServiceContainer>
): Promise<unknown> {
  switch (command) {
    case "search-context":
      return container.services.retrieveContextService.retrieveContext(
        request as unknown as RetrieveContextRequest
      );
    case "fetch-decision-summary":
      return container.services.decisionSummaryService.getDecisionSummary(
        request as unknown as GetDecisionSummaryRequest
      );
    case "draft-note":
      return container.services.stagingDraftService.createDraft(
        request as unknown as DraftNoteRequest
      );
    case "validate-note":
      return container.services.noteValidationService.validate(
        request as unknown as ValidateNoteRequest
      );
    case "promote-note":
      return container.services.promotionOrchestratorService.promoteDraft(
        request as unknown as PromoteNoteRequest
      );
    case "query-history":
      return container.services.auditHistoryService.queryHistory(
        request as unknown as QueryHistoryRequest
      );
  }
}

function parseCli(argv: string[]): ParsedCli {
  const options: ParsedCli["options"] = {
    help: false,
    pretty: true,
    stdin: false
  };

  let command: CommandName | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }

    if (value === "--no-pretty") {
      options.pretty = false;
      continue;
    }

    if (value === "--pretty") {
      options.pretty = true;
      continue;
    }

    if (value === "--stdin") {
      options.stdin = true;
      continue;
    }

    if (value === "--input") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --input.");
      }
      options.inputPath = next;
      index += 1;
      continue;
    }

    if (value === "--json") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --json.");
      }
      options.inlineJson = next;
      index += 1;
      continue;
    }

    if (!command) {
      if (COMMANDS.includes(value as CommandName)) {
        command = value as CommandName;
        continue;
      }

      throw new Error(`Unknown command '${value}'.`);
    }

    throw new Error(`Unexpected argument '${value}'.`);
  }

  return { command, options };
}

async function loadCommandPayload(options: ParsedCli["options"]): Promise<JsonRecord> {
  const sources = [options.stdin, Boolean(options.inputPath), Boolean(options.inlineJson)].filter(Boolean);
  if (sources.length !== 1) {
    throw new Error("Provide exactly one request source: --stdin, --input <path>, or --json <payload>.");
  }

  if (options.stdin) {
    return parseJson(await readStdin());
  }

  if (options.inputPath) {
    return parseJson(await readFile(options.inputPath, "utf8"));
  }

  return parseJson(options.inlineJson ?? "");
}

function parseJson(value: string): JsonRecord {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Command input must be a JSON object.");
  }
  return parsed as JsonRecord;
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(String(chunk));
  }
  return chunks.join("");
}

function buildActorContext(command: CommandName, actor: unknown): ActorContext {
  const input = actor && typeof actor === "object" ? actor as Partial<ActorContext> : {};
  const now = new Date().toISOString();

  return {
    actorId: input.actorId ?? `${command}-cli`,
    actorRole: input.actorRole ?? DEFAULT_ACTOR_ROLE[command],
    transport: "cli",
    source: input.source ?? "brain-cli",
    requestId: input.requestId ?? randomUUID(),
    initiatedAt: input.initiatedAt ?? now,
    toolName: input.toolName ?? command
  };
}

function shouldFailProcess(result: unknown, command: CommandName): boolean {
  if (!result || typeof result !== "object") {
    return true;
  }

  if ("ok" in result && result.ok === false) {
    return true;
  }

  if (
    command === "validate-note" &&
    "valid" in result &&
    typeof result.valid === "boolean" &&
    result.valid === false
  ) {
    return true;
  }

  return false;
}

function writeJson(value: unknown, pretty: boolean): void {
  const rendered = JSON.stringify(value, null, pretty ? 2 : 0);
  process.stdout.write(`${rendered}\n`);
}

function printUsage(): void {
  const usage = `
brain-cli <command> [--input <file> | --stdin | --json <payload>] [--pretty | --no-pretty]

Commands:
  search-context   Run bounded retrieval through retrieveContextService
  fetch-decision-summary  Retrieve a bounded decision-focused packet
  draft-note       Create a staging draft through stagingDraftService
  validate-note    Run deterministic schema validation
  promote-note     Promote a staging draft through the orchestrator
  query-history    Query bounded audit history

Notes:
  - Input payloads are JSON objects shaped like the existing service contracts.
  - Actor context is optional in the payload; the CLI injects command-safe defaults.
  - Output is always JSON so later HTTP and MCP adapters can mirror the same response shape.
`.trim();

  process.stdout.write(`${usage}\n`);
}

await main();
