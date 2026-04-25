import { homedir } from "node:os";
import { resolve } from "node:path";
import { createClaudeClient } from "../dist/index.js";
import {
  getExampleMimirConfig,
  getExampleMimirStdioOptions
} from "./example-mimir-stdio.js";

// Workspace skills stay local to the VoltAgent runtime.
// Durable memory retrieval and governed writes stay on the Mimir side.
// By default this example uses a checked-in stdio MCP stub so it runs in this repo.
// Override MIMIR_EXAMPLE_SERVER_COMMAND and MIMIR_EXAMPLE_SERVER_ARGS_JSON to point at a real server.
const client = await createClaudeClient({
  config: {
    mimir: getExampleMimirConfig(),
    skills: {
      rootPaths: [resolve(homedir(), ".codex/skills")]
    },
    models: {
      primary: "anthropic/claude-sonnet-4-20250514",
      fallback: []
    }
  },
  mimirStdio: getExampleMimirStdioOptions(),
  workflowMemoryAuthority: "client-operational"
});

const discoveredSkills = await client.runtime.workspace.skills?.discoverSkills();

console.log({
  route: client.classifyTaskRoute({
    needsWorkspaceSkill: true
  }),
  agentName: client.runtime.agent.name,
  discoveredSkills: discoveredSkills?.map((skill) => skill.name) ?? []
});

await client.close();
