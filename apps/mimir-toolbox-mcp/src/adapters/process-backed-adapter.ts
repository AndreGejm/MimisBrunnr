import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  BrokerPeerToolDefinition,
  ToolboxBackendAdapter,
  ToolboxBackendHealth
} from "./toolbox-backend-adapter.js";

type JsonRpcId = string | number | null;

interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: Record<string, unknown>;
}

interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
  };
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

function isJsonRpcErrorResponse(response: JsonRpcResponse): response is JsonRpcErrorResponse {
  return "error" in response;
}

class ContentLengthJsonRpcClient {
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<
    JsonRpcId,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  constructor(
    private readonly child: ChildProcessWithoutNullStreams
  ) {
    child.stdout.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      this.drain();
    });
    child.once("error", (error) => {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.failPending(reason);
    });
    child.once("close", () => {
      const error = new Error("Process-backed MCP server closed.");
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  async request(
    method: string,
    params?: Record<string, unknown>
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const message = {
      jsonrpc: "2.0" as const,
      id,
      method,
      ...(params ? { params } : {})
    };

    const response = new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.send(message);
    return response;
  }

  private send(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
    this.child.stdin.write(Buffer.concat([header, body]));
  }

  private drain(): void {
    while (true) {
      const separator = this.buffer.indexOf("\r\n\r\n");
      if (separator === -1) {
        return;
      }

      const headerText = this.buffer.subarray(0, separator).toString("utf8");
      const match = headerText.match(/^Content-Length:\s*(\d+)$/im);
      if (!match) {
        this.buffer = Buffer.alloc(0);
        return;
      }

      const contentLength = Number.parseInt(match[1], 10);
      const totalLength = separator + 4 + contentLength;
      if (this.buffer.length < totalLength) {
        return;
      }

      let payload: JsonRpcResponse;
      try {
        payload = JSON.parse(
          this.buffer.subarray(separator + 4, totalLength).toString("utf8")
        ) as JsonRpcResponse;
      } catch {
        this.buffer = Buffer.alloc(0);
        this.failPending(
          new Error("Process-backed MCP server emitted invalid JSON.")
        );
        this.child.kill("SIGTERM");
        return;
      }
      this.buffer = this.buffer.subarray(totalLength);

      if ("id" in payload && payload.id !== undefined) {
        const pending = this.pending.get(payload.id);
        if (pending) {
          this.pending.delete(payload.id);
          pending.resolve(payload);
        }
      }
    }
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export interface ProcessBackedToolboxBackendLaunch {
  command: string;
  args?: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
}

export class ProcessBackedToolboxBackendAdapter implements ToolboxBackendAdapter {
  readonly serverId: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private client: ContentLengthJsonRpcClient | null = null;
  private healthState: ToolboxBackendHealth = { status: "error", reason: "not_started" };
  private cachedTools: BrokerPeerToolDefinition[] | null = null;
  private childError: Error | null = null;

  constructor(
    serverId: string,
    private readonly launch: ProcessBackedToolboxBackendLaunch
  ) {
    this.serverId = serverId;
  }

  async start(): Promise<void> {
    if (this.client) {
      return;
    }

    const child = spawn(this.launch.command, this.launch.args ?? [], {
      cwd: this.launch.workingDirectory,
      env: {
        ...process.env,
        ...(this.launch.env ?? {})
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.once("error", (error) => {
      this.childError = error instanceof Error ? error : new Error(String(error));
      this.healthState = {
        status: "error",
        reason: this.childError.message
      };
    });
    child.stderr.resume();
    const client = new ContentLengthJsonRpcClient(child);

    try {
      const initialize = await withTimeout(
        client.request("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {}
        }),
        10_000,
        `Process-backed MCP server '${this.serverId}' timed out during initialize.`
      );
      if (this.childError) {
        throw this.childError;
      }
      if (isJsonRpcErrorResponse(initialize) && initialize.error) {
        throw new Error(initialize.error.message);
      }
      this.child = child;
      this.client = client;
      this.healthState = { status: "ready" };
      this.cachedTools = null;
    } catch (error) {
      this.healthState = {
        status: "error",
        reason: error instanceof Error ? error.message : String(error)
      };
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.cachedTools = null;
    if (!this.child) {
      this.client = null;
      return;
    }

    const child = this.child;
    this.child = null;
    this.client = null;
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("close", () => resolve());
      child.kill("SIGTERM");
    });
    this.healthState = { status: "error", reason: "stopped" };
  }

  async listTools(): Promise<BrokerPeerToolDefinition[]> {
    if (!this.client) {
      throw new Error(`Process-backed adapter '${this.serverId}' is not started.`);
    }
    if (this.cachedTools) {
      return this.cachedTools;
    }

    const response = await withTimeout(
      this.client.request("tools/list"),
      10_000,
      `Process-backed MCP server '${this.serverId}' timed out during tools/list.`
    );
    if (isJsonRpcErrorResponse(response) && response.error) {
      throw new Error(response.error.message);
    }
    const result = (response as JsonRpcSuccessResponse).result ?? {};
    const tools = Array.isArray(result.tools)
      ? result.tools
      : [];
    this.cachedTools = tools
      .filter((entry: unknown): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
      .map((entry: Record<string, unknown>) => ({
        name: String(entry.name ?? ""),
        title: typeof entry.title === "string" ? entry.title : undefined,
        description: typeof entry.description === "string" ? entry.description : undefined,
        inputSchema:
          entry.inputSchema && typeof entry.inputSchema === "object" && !Array.isArray(entry.inputSchema)
            ? entry.inputSchema as Record<string, unknown>
            : { type: "object", additionalProperties: true },
        serverId: this.serverId
      }));
    return this.cachedTools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error(`Process-backed adapter '${this.serverId}' is not started.`);
    }

    const response = await withTimeout(
      this.client.request("tools/call", {
        name,
        arguments: args
      }),
      30_000,
      `Process-backed MCP server '${this.serverId}' timed out during tools/call.`
    );
    if (isJsonRpcErrorResponse(response) && response.error) {
      throw new Error(response.error.message);
    }

    return (response as JsonRpcSuccessResponse).result ?? {};
  }

  health(): ToolboxBackendHealth {
    return this.healthState;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
