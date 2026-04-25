import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

const server = new McpServer({
  name: "example-fake-mimir-mcp-server",
  version: "1.0.0"
});

server.registerTool(
  "assemble_agent_context",
  {
    description: "Return a deterministic fake context payload.",
    inputSchema: {
      query: z.string()
    },
    outputSchema: {
      contextBlock: z.string()
    }
  },
  async ({ query }) => ({
    structuredContent: {
      contextBlock: `context:${query}`
    },
    content: [
      {
        type: "text",
        text: `context:${query}`
      }
    ]
  })
);

async function main() {
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
