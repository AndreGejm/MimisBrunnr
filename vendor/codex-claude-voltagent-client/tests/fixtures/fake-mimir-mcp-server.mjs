import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

let assembleAgentContextCalls = 0;

const server = new McpServer({
  name: "fake-mimir-mcp-server",
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
      contextBlock: z.string(),
      invocationCount: z.number()
    }
  },
  async ({ query }) => {
    assembleAgentContextCalls += 1;

    return {
      structuredContent: {
        contextBlock: `context:${query}`,
        invocationCount: assembleAgentContextCalls
      },
      content: [
        {
          type: "text",
          text: `context:${query}`
        }
      ]
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
