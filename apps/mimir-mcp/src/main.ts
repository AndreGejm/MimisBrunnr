#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import process from "node:process";
import { toCliCommandName } from "@mimir/contracts";
import type {
  ActorContext,
  AssembleAgentContextRequest,
  CheckAiToolsRequest,
  CreateSessionArchiveRequest,
  CreateRefreshDraftBatchRequest,
  CreateRefreshDraftRequest,
  GetContextPacketToolRequest,
  DraftNoteRequest,
  ExecuteCodingTaskRequest,
  GetDecisionSummaryRequest,
  GetAiToolPackagePlanToolRequest,
  ImportResourceRequest,
  ListAgentTracesRequest,
  ListAiToolsRequest,
  ListContextTreeToolRequest,
  PromoteNoteRequest,
  QueryHistoryRequest,
  ReadContextNodeToolRequest,
  RetrieveContextRequest,
  SearchSessionArchivesRequest,
  ShowToolOutputRequest,
  ValidateNoteRequest
} from "@mimir/contracts";
import {
  ActorAuthorizationError,
  buildServiceContainer,
  dispatchRuntimeCommand,
  getAdministrativeFreshnessStatus,
  type ServiceContainer,
  loadEnvironment,
  TransportValidationError,
  validateAdministrativeFreshnessStatusRequest,
  validateTransportRequest
} from "@mimir/infrastructure";
import { MCP_TOOL_DEFINITIONS, getToolDefinition } from "./tool-definitions.js";

type JsonRpcId = string | number | null;
type JsonRecord = Record<string, unknown>;
type StdioFraming = "content-length" | "line";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

class ContentLengthTransport {
  private buffer = Buffer.alloc(0);
  private readonly listeners: Array<(message: unknown, framing: StdioFraming) => void> = [];

  constructor(
    input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream
  ) {
    input.on("data", (chunk) => {
      this.buffer = Buffer.concat([
        this.buffer,
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      ]);
      this.drain();
    });
  }

  onMessage(listener: (message: unknown, framing: StdioFraming) => void): void {
    this.listeners.push(listener);
  }

  send(message: unknown, framing: StdioFraming = "content-length"): void {
    const body = JSON.stringify(message);
    if (framing === "line") {
      this.output.write(`${body}\n`);
      return;
    }

    this.output.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  private drain(): void {
    while (true) {
      const headerText = this.buffer.toString("utf8", 0, Math.min(this.buffer.length, 256));
      if (/^Content-Length:/i.test(headerText)) {
        const separator = this.buffer.indexOf("\r\n\r\n");
        if (separator === -1) {
          return;
        }

        const header = this.buffer.toString("utf8", 0, separator);
        const match = header.match(/^Content-Length:\s*(\d+)$/im);
        if (!match) {
          throw new Error("Missing Content-Length header in MCP request.");
        }

        const contentLength = Number.parseInt(match[1], 10);
        const totalLength = separator + 4 + contentLength;
        if (this.buffer.length < totalLength) {
          return;
        }

        const parsed = JSON.parse(
          this.buffer.subarray(separator + 4, totalLength).toString("utf8")
        ) as unknown;
        this.buffer = this.buffer.subarray(totalLength);
        this.emit(parsed, "content-length");
        continue;
      }

      const lineBreakIndex = this.buffer.indexOf("\n");
      if (lineBreakIndex === -1) {
        return;
      }

      const line = this.buffer.toString("utf8", 0, lineBreakIndex).replace(/\r$/, "");
      this.buffer = this.buffer.subarray(lineBreakIndex + 1);
      const parsed = JSON.parse(line) as unknown;

      this.emit(parsed, "line");
    }
  }

  private emit(message: unknown, framing: StdioFraming): void {
    for (const listener of this.listeners) {
      void listener(message, framing);
    }
  }
}

let shuttingDown = false;

process.once("SIGINT", () => {
  shutdown(0);
});
process.once("SIGTERM", () => {
  shutdown(0);
});
process.stdin.once("end", () => {
  shutdown(0);
});
process.stdin.once("close", () => {
  shutdown(0);
});
process.stdin.resume();

if (process.stdin.readableEnded || process.stdin.destroyed) {
  shutdown(0);
}

const env = loadEnvironment();
let container: ServiceContainer | undefined;
const transport = new ContentLengthTransport(process.stdin, process.stdout);
const defaultSessionActor = loadDefaultSessionActor();

transport.onMessage(async (message, framing) => {
  if (!isJsonRpcRequest(message)) {
    return;
  }

  if (!("id" in message)) {
    if (message.method === "notifications/initialized") {
      return;
    }
    return;
  }

  try {
    const response = await handleRequest(message);
    transport.send(response, framing);
  } catch (error) {
    transport.send(
      {
        jsonrpc: "2.0",
        id: message.id ?? null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error)
        }
      },
      framing
    );
  }
});

async function handleRequest(request: JsonRpcRequest): Promise<unknown> {
  switch (request.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          protocolVersion:
            typeof request.params?.protocolVersion === "string"
              ? request.params.protocolVersion
              : "2024-11-05",
          capabilities: {
            tools: {
              listChanged: false
            }
          },
          serverInfo: {
            name: "mimir-mcp",
            version: env.release.version
          }
        }
      };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          tools: MCP_TOOL_DEFINITIONS.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        }
      };
    case "tools/call":
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: await callTool(
          String(request.params?.name ?? ""),
          (request.params?.arguments as JsonRecord | undefined) ?? {}
        )
      };
    default:
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: {
          code: -32601,
          message: `Method '${request.method}' is not supported.`
        }
      };
  }
}

async function callTool(name: string, args: JsonRecord): Promise<unknown> {
  const tool = getToolDefinition(name);
  if (!tool) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: false,
              error: {
                code: "tool_not_found",
                message: `Tool '${name}' is not supported by this MCP server.`
              }
            },
            null,
            2
          )
        }
      ],
      isError: true
    };
  }

  try {
    if (name === "freshness_status") {
      const result = await getAdministrativeFreshnessStatus(
        getContainer(),
        buildActorContext(
          "view_freshness_status",
          tool.defaultActorRole,
          args.actor
        ),
        validateAdministrativeFreshnessStatusRequest(args, {
          allowCorpusAliases: true
        })
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ],
        structuredContent: result,
        isError: isToolError(result)
      };
    }

    const validatedArgs = validateTransportRequest(tool.name, args);
    const request = {
      ...validatedArgs,
      actor: buildActorContext(tool.name, tool.defaultActorRole, validatedArgs.actor)
    };
    const result = await runTool(name, request);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ],
      structuredContent: result,
      isError: isToolError(result)
    };
  } catch (error) {
    const serviceError =
      error instanceof TransportValidationError
        ? error.toServiceError()
        : error instanceof ActorAuthorizationError
          ? error.toServiceError()
          : {
              code: "tool_failed",
              message: error instanceof Error ? error.message : String(error)
            };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: false, error: serviceError }, null, 2)
        }
      ],
      structuredContent: {
        ok: false,
        error: serviceError
      },
      isError: true
    };
  }
}

async function runTool(name: string, request: JsonRecord): Promise<unknown> {
  const commandName = toCliCommandName(name);
  if (!commandName) {
    return {
      ok: false,
      error: {
        code: "tool_not_found",
        message: `No runtime command is registered for MCP tool '${name}'.`
      }
    };
  }

  return dispatchRuntimeCommand(commandName, request, getContainer());
}

function getContainer(): ServiceContainer {
  if (!container) {
    container = buildServiceContainer(env);
  }

  return container;
}

function buildActorContext(
  toolName: string,
  defaultRole: ActorContext["actorRole"],
  actor: unknown
): ActorContext {
  const input = actor && typeof actor === "object" ? actor as Partial<ActorContext> : {};
  const now = new Date().toISOString();
  const sessionPolicyToken =
    input.sessionPolicyToken ??
    process.env.MAB_TOOLBOX_SESSION_POLICY_TOKEN?.trim() ??
    undefined;

  if (defaultSessionActor) {
    return {
      actorId: defaultSessionActor.actorId,
      actorRole: defaultSessionActor.actorRole,
      transport: "mcp",
      source: defaultSessionActor.source,
      requestId: input.requestId ?? randomUUID(),
      initiatedAt: input.initiatedAt ?? now,
      toolName: input.toolName ?? toolName,
      authToken: defaultSessionActor.authToken,
      sessionPolicyToken,
      toolboxSessionMode:
        input.toolboxSessionMode ??
        (process.env.MAB_TOOLBOX_ACTIVE_PROFILE
          ? process.env.MAB_TOOLBOX_ACTIVE_PROFILE === "bootstrap"
            ? "toolbox-bootstrap"
            : "toolbox-activated"
          : "legacy-direct"),
      toolboxClientId:
        input.toolboxClientId ??
        process.env.MAB_TOOLBOX_CLIENT_ID?.trim() ??
        undefined,
      toolboxProfileId:
        input.toolboxProfileId ??
        process.env.MAB_TOOLBOX_ACTIVE_PROFILE?.trim() ??
        undefined
    };
  }

  return {
    actorId: input.actorId ?? `${toolName}-mcp`,
    actorRole: input.actorRole ?? defaultRole,
    transport: "mcp",
    source: input.source ?? "mimir-mcp",
    requestId: input.requestId ?? randomUUID(),
    initiatedAt: input.initiatedAt ?? now,
    toolName: input.toolName ?? toolName,
    authToken: input.authToken,
    sessionPolicyToken,
    toolboxSessionMode:
      input.toolboxSessionMode ??
      (process.env.MAB_TOOLBOX_ACTIVE_PROFILE
        ? process.env.MAB_TOOLBOX_ACTIVE_PROFILE === "bootstrap"
          ? "toolbox-bootstrap"
          : "toolbox-activated"
        : "legacy-direct"),
    toolboxClientId:
      input.toolboxClientId ??
      process.env.MAB_TOOLBOX_CLIENT_ID?.trim() ??
      undefined,
    toolboxProfileId:
      input.toolboxProfileId ??
      process.env.MAB_TOOLBOX_ACTIVE_PROFILE?.trim() ??
      undefined
  };
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return Boolean(
    value &&
      typeof value === "object" &&
      "jsonrpc" in value &&
      "method" in value
  );
}

function isToolError(result: unknown): boolean {
  if (!result || typeof result !== "object") {
    return true;
  }

  return "ok" in result && result.ok === false;
}

function loadDefaultSessionActor():
  | Pick<ActorContext, "actorId" | "actorRole" | "authToken" | "source">
  | undefined {
  const actorId = process.env.MAB_MCP_DEFAULT_ACTOR_ID?.trim();
  const actorRole = process.env.MAB_MCP_DEFAULT_ACTOR_ROLE?.trim() as
    | ActorContext["actorRole"]
    | undefined;
  const authToken = process.env.MAB_MCP_DEFAULT_ACTOR_AUTH_TOKEN?.trim();
  const source =
    process.env.MAB_MCP_DEFAULT_SOURCE?.trim() || "mimir-mcp-session";

  if (!actorId || !actorRole || !authToken) {
    return undefined;
  }

  return {
    actorId,
    actorRole,
    authToken,
    source
  };
}

function shutdown(exitCode: number): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  container?.dispose();
  process.exit(exitCode);
}
