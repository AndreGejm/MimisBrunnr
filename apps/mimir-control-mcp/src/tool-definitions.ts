export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOL_DEFINITIONS: ReadonlyArray<McpToolDefinition> = [
  {
    name: "list_toolboxes",
    title: "List Toolboxes",
    description: "List available toolbox intents before activating peer MCP tools.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: "describe_toolbox",
    title: "Describe Toolbox",
    description: "Describe one toolbox and its allowed and denied categories.",
    inputSchema: {
      type: "object",
      required: ["toolboxId"],
      additionalProperties: false,
      properties: {
        toolboxId: { type: "string" }
      }
    }
  },
  {
    name: "request_toolbox_activation",
    title: "Request Toolbox Activation",
    description: "Request an approved toolbox session handoff.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        requestedToolbox: { type: "string" },
        requiredCategories: {
          type: "array",
          items: { type: "string" }
        },
        actorRole: {
          type: "string",
          enum: ["retrieval", "writer", "orchestrator", "system", "operator"]
        },
        taskSummary: { type: "string" },
        clientId: { type: "string" },
        approval: {
          type: "object",
          additionalProperties: false,
          properties: {
            grantedBy: { type: "string" },
            grantedAt: { type: "string" },
            reason: { type: "string" },
            toolboxId: { type: "string" }
          }
        }
      }
    }
  },
  {
    name: "list_active_toolbox",
    title: "List Active Toolbox",
    description: "Report the current active toolbox profile and client overlay.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: "list_active_tools",
    title: "List Active Tools",
    description: "List active tool descriptors after profile and overlay filtering.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: "deactivate_toolbox",
    title: "Deactivate Toolbox",
    description: "Return the downgrade target for leaving the current toolbox profile.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        leaseToken: { type: "string" }
      }
    }
  }
];

export function getToolDefinition(name: string): McpToolDefinition | undefined {
  return MCP_TOOL_DEFINITIONS.find((tool) => tool.name === name);
}
