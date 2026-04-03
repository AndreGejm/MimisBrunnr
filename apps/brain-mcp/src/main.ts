#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import process from "node:process";
import type {
  ActorContext,
  DraftNoteRequest,
  GetDecisionSummaryRequest,
  PromoteNoteRequest,
  QueryHistoryRequest,
  RetrieveContextRequest,
  ValidateNoteRequest
} from "@multi-agent-brain/contracts";
import { buildServiceContainer, loadEnvironment } from "@multi-agent-brain/infrastructure";
import { MCP_TOOL_DEFINITIONS, getToolDefinition } from "./tool-definitions.js";

type JsonRpcId = string | number | null;
type JsonRecord = Record<string, unknown>;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

class ContentLengthTransport {
  private buffer = Buffer.alloc(0);
  private readonly listeners: Array<(message: unknown) => void> = [];

  constructor(
    input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream
  ) {
    input.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      this.drain();
    });
  }

  onMessage(listener: (message: unknown) => void): void {
    this.listeners.push(listener);
  }

  send(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
    this.output.write(Buffer.concat([header, body]));
  }

  private drain(): void {
    while (true) {
      const separator = this.buffer.indexOf("\r\n\r\n");
      if (separator === -1) {
        return;
      }

      const headerText = this.buffer.subarray(0, separator).toString("utf8");
      const contentLength = parseContentLength(headerText);
      if (contentLength === null) {
        throw new Error("MCP request is missing a valid Content-Length header.");
      }

      const totalLength = separator + 4 + contentLength;
      if (this.buffer.length < totalLength) {
        return;
      }

      const payload = this.buffer
        .subarray(separator + 4, totalLength)
        .toString("utf8");
      this.buffer = this.buffer.subarray(totalLength);

      const parsed = JSON.parse(payload) as unknown;
      for (const listener of this.listeners) {
        void listener(parsed);
      }
    }
  }
}

const container = buildServiceContainer(loadEnvironment());
const transport = new ContentLengthTransport(process.stdin, process.stdout);

process.once("SIGINT", () => {
  container.dispose();
  process.exit(0);
});
process.once("SIGTERM", () => {
  container.dispose();
  process.exit(0);
});

transport.onMessage(async (message) => {
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
    transport.send(response);
  } catch (error) {
    transport.send({
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error)
      }
    });
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
            name: "multi-agent-brain-mcp",
            version: "0.1.0"
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

  const request = {
    ...args,
    actor: buildActorContext(tool.name, tool.defaultActorRole, args.actor)
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
}

async function runTool(name: string, request: JsonRecord): Promise<unknown> {
  switch (name) {
    case "search_context":
      return container.services.retrieveContextService.retrieveContext(
        request as unknown as RetrieveContextRequest
      );
    case "draft_note":
      return container.services.stagingDraftService.createDraft(
        request as unknown as DraftNoteRequest
      );
    case "fetch_decision_summary":
      return container.services.decisionSummaryService.getDecisionSummary(
        request as unknown as GetDecisionSummaryRequest
      );
    case "validate_note":
      return container.services.noteValidationService.validate(
        request as unknown as ValidateNoteRequest
      );
    case "promote_note":
      return container.services.promotionOrchestratorService.promoteDraft(
        request as unknown as PromoteNoteRequest
      );
    case "query_history":
      return container.services.auditHistoryService.queryHistory(
        request as unknown as QueryHistoryRequest
      );
    default:
      return {
        ok: false,
        error: {
          code: "tool_not_found",
          message: `Tool '${name}' is not supported by this MCP server.`
        }
      };
  }
}

function buildActorContext(
  toolName: string,
  defaultRole: ActorContext["actorRole"],
  actor: unknown
): ActorContext {
  const input = actor && typeof actor === "object" ? actor as Partial<ActorContext> : {};
  const now = new Date().toISOString();

  return {
    actorId: input.actorId ?? `${toolName}-mcp`,
    actorRole: input.actorRole ?? defaultRole,
    transport: "mcp",
    source: input.source ?? "brain-mcp",
    requestId: input.requestId ?? randomUUID(),
    initiatedAt: input.initiatedAt ?? now,
    toolName: input.toolName ?? toolName
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

function parseContentLength(headers: string): number | null {
  const match = headers.match(/^Content-Length:\s*(\d+)$/im);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function isToolError(result: unknown): boolean {
  if (!result || typeof result !== "object") {
    return true;
  }

  return "ok" in result && result.ok === false;
}
