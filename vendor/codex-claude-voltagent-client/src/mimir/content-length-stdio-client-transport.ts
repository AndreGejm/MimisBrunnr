import { spawn, type ChildProcess, type IOType } from "node:child_process";
import type { Stream } from "node:stream";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export interface ContentLengthStdioServerParameters {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stderr?: IOType | Stream | number;
}

function serializeMessage(message: JSONRPCMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");

  return Buffer.concat([header, body]);
}

function parseContentLength(headers: string): number | null {
  const match = headers.match(/^Content-Length:\s*(\d+)$/im);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

export class ContentLengthStdioClientTransport implements Transport {
  private processHandle: ChildProcess | undefined;
  private readBuffer = Buffer.alloc(0);

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;

  constructor(private readonly server: ContentLengthStdioServerParameters) {}

  async start(): Promise<void> {
    if (this.processHandle) {
      throw new Error(
        "ContentLengthStdioClientTransport already started. If using Client, connect() starts it automatically."
      );
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.server.command, this.server.args ?? [], {
        cwd: this.server.cwd,
        env: this.server.env,
        stdio: ["pipe", "pipe", this.server.stderr ?? "inherit"],
        shell: false,
        windowsHide: process.platform === "win32"
      });

      this.processHandle = child;

      if (!child.stdin || !child.stdout) {
        reject(new Error("ContentLengthStdioClientTransport requires piped stdin/stdout."));
        return;
      }

      child.once("error", (error) => {
        reject(error);
        this.onerror?.(error);
      });

      child.once("spawn", () => {
        resolve();
      });

      child.once("close", () => {
        this.processHandle = undefined;
        this.onclose?.();
      });

      child.stdin.on("error", (error) => {
        this.onerror?.(error);
      });

      child.stdout.on("data", (chunk) => {
        this.readBuffer = Buffer.concat([
          this.readBuffer,
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        ]);
        this.drainReadBuffer();
      });

      child.stdout.on("error", (error) => {
        this.onerror?.(error);
      });
    });
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.processHandle?.stdin) {
        throw new Error("Not connected");
      }

      const payload = serializeMessage(message);

      if (this.processHandle.stdin.write(payload)) {
        resolve();
      } else {
        this.processHandle.stdin.once("drain", resolve);
      }
    });
  }

  async close(): Promise<void> {
    if (!this.processHandle) {
      this.readBuffer = Buffer.alloc(0);
      return;
    }

    const processToClose = this.processHandle;
    this.processHandle = undefined;

    const closePromise = new Promise<void>((resolve) => {
      processToClose.once("close", () => {
        resolve();
      });
    });

    try {
      processToClose.stdin?.end();
    } catch {
      // ignore
    }

    await Promise.race([
      closePromise,
      new Promise((resolve) => setTimeout(resolve, 2000).unref())
    ]);

    if (processToClose.exitCode === null) {
      try {
        processToClose.kill("SIGTERM");
      } catch {
        // ignore
      }

      await Promise.race([
        closePromise,
        new Promise((resolve) => setTimeout(resolve, 2000).unref())
      ]);
    }

    if (processToClose.exitCode === null) {
      try {
        processToClose.kill("SIGKILL");
      } catch {
        // ignore
      }
    }

    this.readBuffer = Buffer.alloc(0);
  }

  private drainReadBuffer(): void {
    while (true) {
      const separatorIndex = this.readBuffer.indexOf("\r\n\r\n");

      if (separatorIndex === -1) {
        return;
      }

      const headerText = this.readBuffer.subarray(0, separatorIndex).toString("utf8");
      const contentLength = parseContentLength(headerText);

      if (contentLength === null) {
        this.onerror?.(
          new Error("MCP response is missing a valid Content-Length header.")
        );
        this.readBuffer = Buffer.alloc(0);
        return;
      }

      const totalLength = separatorIndex + 4 + contentLength;

      if (this.readBuffer.length < totalLength) {
        return;
      }

      const payload = this.readBuffer
        .subarray(separatorIndex + 4, totalLength)
        .toString("utf8");
      this.readBuffer = this.readBuffer.subarray(totalLength);

      try {
        this.onmessage?.(JSON.parse(payload) as JSONRPCMessage);
      } catch (error) {
        this.onerror?.(
          error instanceof Error
            ? error
            : new Error(`Failed to parse MCP response: ${String(error)}`)
        );
      }
    }
  }
}
