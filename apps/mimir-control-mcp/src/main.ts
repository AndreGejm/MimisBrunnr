#!/usr/bin/env node

import process from "node:process";
import {
  buildMimirControlSurface,
  buildServiceContainer,
  SqliteToolboxSessionLeaseStore
} from "@mimir/infrastructure";
import { loadEnvironment } from "@mimir/infrastructure";
import { MCP_TOOL_DEFINITIONS, getToolDefinition } from "./tool-definitions.js";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRecord = Record<string, unknown>;

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
        this.buffer = Buffer.alloc(0);
        this.sendParseError("MCP request is missing a valid Content-Length header.");
        return;
      }

      const totalLength = separator + 4 + contentLength;
      if (this.buffer.length < totalLength) {
        return;
      }

      const payload = this.buffer
        .subarray(separator + 4, totalLength)
        .toString("utf8");
      this.buffer = this.buffer.subarray(totalLength);

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload) as unknown;
      } catch {
        this.sendParseError("MCP request body is not valid JSON.");
        continue;
      }
      for (const listener of this.listeners) {
        void listener(parsed);
      }
    }
  }

  private sendParseError(message: string): void {
    this.send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message
      }
    });
  }
}

const leaseStore = process.env.MAB_SQLITE_PATH?.trim()
  ? new SqliteToolboxSessionLeaseStore(process.env.MAB_SQLITE_PATH.trim())
  : undefined;
const serviceContainer = buildServiceContainer(loadEnvironment());
const control = buildMimirControlSurface({
  manifestDirectory:
    process.env.MAB_TOOLBOX_MANIFEST_DIR?.trim()
      || "docker/mcp",
  activeProfileId:
    process.env.MAB_TOOLBOX_ACTIVE_PROFILE?.trim()
      || "bootstrap",
  clientId:
    process.env.MAB_TOOLBOX_CLIENT_ID?.trim()
      || "codex",
  auditHistoryService: serviceContainer.services.auditHistoryService,
  leaseIssuer: process.env.MAB_TOOLBOX_LEASE_ISSUER?.trim() || "mimir-control",
  leaseAudience: process.env.MAB_TOOLBOX_LEASE_AUDIENCE?.trim() || "mimir-core",
  leaseIssuerSecret: process.env.MAB_TOOLBOX_LEASE_ISSUER_SECRET?.trim() || undefined,
  leaseStore
});

const transport = new ContentLengthTransport(process.stdin, process.stdout);
let shuttingDown = false;

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));
process.stdin.once("end", () => shutdown(0));
process.stdin.once("close", () => shutdown(0));

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
    transport.send(await handleRequest(message));
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
            name: "mimir-control-mcp",
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
    return failure("tool_not_found", `Tool '${name}' is not supported.`);
  }

  try {
    let result: unknown;
    switch (name) {
      case "list_toolboxes":
        result = await control.listToolboxes();
        break;
      case "describe_toolbox":
        result = await control.describeToolbox(String(args.toolboxId ?? ""));
        break;
      case "request_toolbox_activation":
        result = await control.requestToolboxActivation({
          requestedToolbox: optionalString(args.requestedToolbox),
          requiredCategories: optionalStringArray(args.requiredCategories),
          taskSummary: optionalString(args.taskSummary),
          clientId: optionalString(args.clientId)
        });
        break;
      case "list_active_toolbox":
        result = await control.listActiveToolbox();
        break;
      case "list_active_tools":
        result = await control.listActiveTools();
        break;
      case "deactivate_toolbox":
        result = await control.deactivateToolbox(optionalString(args.leaseToken));
        break;
      default:
        return failure("tool_not_found", `Tool '${name}' is not supported.`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ],
      structuredContent: result,
      isError: false
    };
  } catch (error) {
    return failure(
      "tool_failed",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function failure(code: string, message: string) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, error: { code, message } }, null, 2)
      }
    ],
    structuredContent: {
      ok: false,
      error: { code, message }
    },
    isError: true
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
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

function shutdown(exitCode: number): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  leaseStore?.close();
  serviceContainer.dispose();
  process.exit(exitCode);
}
