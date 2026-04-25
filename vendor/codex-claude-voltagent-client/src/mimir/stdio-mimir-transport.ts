import type { IOType } from "node:child_process";
import type { Stream } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ClientConfig } from "../config/schema.js";
import type { MimirTransport } from "./mimir-transport.js";
import {
  ContentLengthStdioClientTransport,
  type ContentLengthStdioServerParameters
} from "./content-length-stdio-client-transport.js";

export interface MimirClientInfo {
  name?: string;
  version?: string;
}

export interface StdioMimirTransportOptions {
  clientInfo?: MimirClientInfo;
  cwd?: string;
  env?: Record<string, string>;
  stderr?: IOType | Stream | number;
  requestTimeoutMs?: number;
  maxTotalTimeoutMs?: number;
}

export interface ConnectedMimirTransport {
  transport: MimirTransport;
  close(): Promise<void>;
}

type MimirSdkToolResult = Awaited<ReturnType<Client["callTool"]>>;

function resolveServerParameters(
  config: ClientConfig["mimir"],
  options: StdioMimirTransportOptions
): ContentLengthStdioServerParameters {
  const [command, ...commandArgs] = config.serverCommand;

  if (!command) {
    throw new Error("Mimir stdio transport requires a server command.");
  }

  return {
    command,
    args: [...commandArgs, ...config.serverArgs],
    cwd: options.cwd,
    env: options.env,
    stderr: options.stderr
  };
}

function readTextContent(result: MimirSdkToolResult): string | undefined {
  if (!("content" in result) || !Array.isArray(result.content)) {
    return undefined;
  }

  const text = result.content
    .filter(
      (item): item is { type: "text"; text: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string"
    )
    .map((item) => item.text)
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

function normalizeToolResult(result: MimirSdkToolResult): unknown {
  if ("isError" in result && result.isError) {
    throw new Error(readTextContent(result) ?? "Mimir tool call failed.");
  }

  if ("structuredContent" in result && result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  if ("toolResult" in result) {
    return result.toolResult;
  }

  const text = readTextContent(result);

  if (text === undefined) {
    return result;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function connectStdioMimirTransport(
  config: ClientConfig["mimir"],
  options: StdioMimirTransportOptions = {}
): Promise<ConnectedMimirTransport> {
  const client = new Client(
    {
      name: options.clientInfo?.name ?? "codex-claude-voltagent-client",
      version: options.clientInfo?.version ?? "0.1.0"
    },
    {
      capabilities: {}
    }
  );
  const sdkTransport = new ContentLengthStdioClientTransport(
    resolveServerParameters(config, options)
  );

  const requestTimeoutMs = options.requestTimeoutMs ?? 180000;
  const maxTotalTimeoutMs = options.maxTotalTimeoutMs ?? requestTimeoutMs;

  await client.connect(sdkTransport, {
    timeout: requestTimeoutMs,
    maxTotalTimeout: maxTotalTimeoutMs
  });

  return {
    transport: {
      async callTool(toolName, args) {
        const result = await client.callTool({
          name: toolName,
          arguments: args as unknown as Record<string, unknown>
        });

        return normalizeToolResult(result);
      }
    },
    async close() {
      await client.close();
    }
  };
}
