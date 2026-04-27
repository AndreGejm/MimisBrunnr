#!/usr/bin/env node

import process from "node:process";

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  drain();
});

function drain() {
  while (true) {
    const separator = buffer.indexOf("\r\n\r\n");
    if (separator === -1) {
      return;
    }

    const header = buffer.subarray(0, separator).toString("utf8");
    const match = header.match(/^Content-Length:\s*(\d+)$/im);
    if (!match) {
      send({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Missing Content-Length header."
        }
      });
      buffer = Buffer.alloc(0);
      return;
    }

    const contentLength = Number.parseInt(match[1], 10);
    const totalLength = separator + 4 + contentLength;
    if (buffer.length < totalLength) {
      return;
    }

    const payload = buffer.subarray(separator + 4, totalLength).toString("utf8");
    buffer = buffer.subarray(totalLength);

    let message;
    try {
      message = JSON.parse(payload);
    } catch {
      send({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Invalid JSON payload."
        }
      });
      continue;
    }

    handle(message);
  }
}

function handle(message) {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.method === "notifications/initialized") {
    return;
  }

  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id ?? null,
      result: {
        protocolVersion:
          typeof message.params?.protocolVersion === "string"
            ? message.params.protocolVersion
            : "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "local-stdio-peer-fixture",
          version: "0.1.0"
        }
      }
    });
    return;
  }

  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id ?? null,
      result: {
        tools: [
          {
            name: "temp_peer_echo",
            title: "Temp Peer Echo",
            description: "Echo a message from the local stdio peer fixture.",
            inputSchema: {
              type: "object",
              required: ["message"],
              additionalProperties: false,
              properties: {
                message: {
                  type: "string"
                }
              }
            }
          }
        ]
      }
    });
    return;
  }

  if (message.method === "tools/call") {
    if (message.params?.name !== "temp_peer_echo") {
      send({
        jsonrpc: "2.0",
        id: message.id ?? null,
        error: {
          code: -32601,
          message: `Unsupported tool '${String(message.params?.name ?? "")}'.`
        }
      });
      return;
    }

    const echoed =
      typeof message.params?.arguments?.message === "string"
        ? message.params.arguments.message
        : "";
    send({
      jsonrpc: "2.0",
      id: message.id ?? null,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                echoed,
                source: "local-stdio-peer-fixture"
              },
              null,
              2
            )
          }
        ],
        structuredContent: {
          echoed,
          source: "local-stdio-peer-fixture"
        },
        isError: false
      }
    });
    return;
  }

  send({
    jsonrpc: "2.0",
    id: message.id ?? null,
    error: {
      code: -32601,
      message: `Method '${String(message.method ?? "")}' is not supported.`
    }
  });
}

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  process.stdout.write(Buffer.concat([header, body]));
}
