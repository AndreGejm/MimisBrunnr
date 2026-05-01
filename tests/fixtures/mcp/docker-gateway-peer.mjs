#!/usr/bin/env node

import process from "node:process";

function writeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  process.stdout.write(Buffer.concat([header, body]));
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

  while (true) {
    const separator = buffer.indexOf("\r\n\r\n");
    if (separator === -1) {
      break;
    }

    const header = buffer.subarray(0, separator).toString("utf8");
    const match = header.match(/^Content-Length:\s*(\d+)$/im);
    if (!match) {
      buffer = Buffer.alloc(0);
      return;
    }

    const length = Number.parseInt(match[1], 10);
    const totalLength = separator + 4 + length;
    if (buffer.length < totalLength) {
      break;
    }

    const payload = JSON.parse(
      buffer.subarray(separator + 4, totalLength).toString("utf8")
    );
    buffer = buffer.subarray(totalLength);
    handleMessage(payload);
  }
});

function handleMessage(message) {
  switch (message.method) {
    case "initialize":
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "docker-gateway-peer-fixture",
            version: "1.0.0"
          }
        }
      });
      return;
    case "tools/list":
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "temp_docker_search",
              title: "Temp Docker Search",
              description: "Searches via the fake Docker gateway peer.",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string"
                  }
                },
                required: ["query"],
                additionalProperties: false
              }
            }
          ]
        }
      });
      return;
    case "tools/call": {
      const query = String(message.params?.arguments?.query ?? "");
      writeMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: `docker gateway echo: ${query}`
            }
          ],
          structuredContent: {
            query,
            source: "docker-gateway-peer-fixture",
            gatewayArgs: process.argv.slice(2)
          },
          isError: false
        }
      });
      return;
    }
    default:
      writeMessage({
        jsonrpc: "2.0",
        id: message.id ?? null,
        error: {
          code: -32601,
          message: `Unsupported method '${message.method}'.`
        }
      });
  }
}
