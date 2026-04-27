import type { CompiledToolboxToolDescriptor } from "@mimir/contracts";
import type { ActorContext } from "@mimir/contracts";

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  defaultActorRole?: ActorContext["actorRole"];
}

const CONTROL_TOOL_DEFINITIONS: ReadonlyArray<McpToolDefinition> = [
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
    description: "Request toolbox activation in the current broker session and receive compatibility handoff details.",
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
    description: "Contract the current broker session back to its downgrade target.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        leaseToken: { type: "string" }
      }
    }
  }
];

const MIMIR_CORE_TOOL_DEFINITIONS: ReadonlyArray<McpToolDefinition> = [
  {
    name: "search_context",
    title: "Search Context",
    description: "Run bounded hybrid retrieval and return a context packet with provenance.",
    defaultActorRole: "retrieval",
    inputSchema: {
      type: "object",
      required: ["query", "corpusIds", "budget"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        query: { type: "string" },
        corpusIds: {
          type: "array",
          minItems: 1,
          items: { type: "string", enum: ["mimisbrunnr", "general_notes"] }
        },
        budget: {
          type: "object",
          required: ["maxTokens", "maxSources", "maxRawExcerpts", "maxSummarySentences"],
          properties: {
            maxTokens: { type: "number" },
            maxSources: { type: "number" },
            maxRawExcerpts: { type: "number" },
            maxSummarySentences: { type: "number" }
          }
        },
        intentHint: { type: "string" },
        noteTypePriority: { type: "array", items: { type: "string" } },
        tagFilters: { type: "array", items: { type: "string" } },
        includeSuperseded: { type: "boolean" },
        requireEvidence: { type: "boolean" },
        includeTrace: { type: "boolean" }
      }
    }
  },
  {
    name: "assemble_agent_context",
    title: "Assemble Agent Context",
    description: "Assemble a fenced local-agent context packet from canonical retrieval and optional non-authoritative session recall.",
    defaultActorRole: "retrieval",
    inputSchema: {
      type: "object",
      required: ["query", "corpusIds", "budget"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        query: { type: "string" },
        corpusIds: {
          type: "array",
          minItems: 1,
          items: { type: "string", enum: ["mimisbrunnr", "general_notes"] }
        },
        budget: {
          type: "object",
          required: ["maxTokens", "maxSources", "maxRawExcerpts", "maxSummarySentences"],
          properties: {
            maxTokens: { type: "number" },
            maxSources: { type: "number" },
            maxRawExcerpts: { type: "number" },
            maxSummarySentences: { type: "number" }
          }
        },
        includeTrace: { type: "boolean" },
        includeSessionArchives: { type: "boolean" },
        sessionId: { type: "string" },
        sessionLimit: { type: "number" },
        sessionMaxTokens: { type: "number" }
      }
    }
  },
  {
    name: "get_context_packet",
    title: "Get Context Packet",
    description: "Assemble a bounded context packet directly from ranked candidates and a retrieval budget.",
    defaultActorRole: "retrieval",
    inputSchema: {
      type: "object",
      required: ["intent", "budget", "candidates", "includeRawExcerpts"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        intent: {
          type: "string",
          enum: [
            "fact_lookup",
            "decision_lookup",
            "implementation_guidance",
            "architecture_recall",
            "status_timeline",
            "debugging"
          ]
        },
        budget: {
          type: "object",
          required: ["maxTokens", "maxSources", "maxRawExcerpts", "maxSummarySentences"],
          properties: {
            maxTokens: { type: "number" },
            maxSources: { type: "number" },
            maxRawExcerpts: { type: "number" },
            maxSummarySentences: { type: "number" }
          }
        },
        candidates: {
          type: "array",
          items: { type: "object", additionalProperties: true }
        },
        includeRawExcerpts: { type: "boolean" }
      }
    }
  },
  {
    name: "fetch_decision_summary",
    title: "Fetch Decision Summary",
    description: "Retrieve a bounded decision packet for a topic from canonical context.",
    defaultActorRole: "retrieval",
    inputSchema: {
      type: "object",
      required: ["topic", "budget"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        topic: { type: "string" },
        budget: {
          type: "object",
          required: ["maxTokens", "maxSources", "maxRawExcerpts", "maxSummarySentences"],
          properties: {
            maxTokens: { type: "number" },
            maxSources: { type: "number" },
            maxRawExcerpts: { type: "number" },
            maxSummarySentences: { type: "number" }
          }
        }
      }
    }
  },
  {
    name: "draft_note",
    title: "Draft Note",
    description: "Create a staging draft through the writer-only drafting service.",
    defaultActorRole: "writer",
    inputSchema: {
      type: "object",
      required: ["targetCorpus", "noteType", "title", "sourcePrompt", "supportingSources"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        targetCorpus: { type: "string", enum: ["mimisbrunnr", "general_notes"] },
        noteType: { type: "string" },
        title: { type: "string" },
        sourcePrompt: { type: "string" },
        supportingSources: { type: "array", items: { type: "object" } },
        frontmatterOverrides: { type: "object" },
        bodyHints: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "create_session_archive",
    title: "Create Session Archive",
    description: "Persist an immutable non-authoritative session archive without creating drafts or canonical notes.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      required: ["sessionId", "messages"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        sessionId: { type: "string" },
        messages: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["role", "content"],
            additionalProperties: false,
            properties: {
              role: {
                type: "string",
                enum: ["system", "user", "assistant", "tool"]
              },
              content: { type: "string" }
            }
          }
        }
      }
    }
  }
];

const ROUTABLE_TOOL_DEFINITIONS = new Map(
  [...CONTROL_TOOL_DEFINITIONS, ...MIMIR_CORE_TOOL_DEFINITIONS].map((tool) => [
    tool.name,
    tool
  ])
);

export function buildBrokerToolDefinitions(
  activeTools: ReadonlyArray<CompiledToolboxToolDescriptor>
): McpToolDefinition[] {
  const activeToolIds = new Set(activeTools.map((tool) => tool.toolId));
  return [...CONTROL_TOOL_DEFINITIONS, ...MIMIR_CORE_TOOL_DEFINITIONS].filter(
    (tool) => activeToolIds.has(tool.name)
  );
}

export function getToolDefinition(name: string): McpToolDefinition | undefined {
  return ROUTABLE_TOOL_DEFINITIONS.get(name);
}

export function isControlTool(name: string): boolean {
  return CONTROL_TOOL_DEFINITIONS.some((tool) => tool.name === name);
}
