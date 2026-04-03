import type { ActorRole } from "@multi-agent-brain/contracts";

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  defaultActorRole: ActorRole;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOL_DEFINITIONS: ReadonlyArray<McpToolDefinition> = [
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
          items: { type: "string", enum: ["context_brain", "general_notes"] }
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
        requireEvidence: { type: "boolean" }
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
        targetCorpus: { type: "string", enum: ["context_brain", "general_notes"] },
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
    name: "validate_note",
    title: "Validate Note",
    description: "Run deterministic note schema validation without mutating state.",
    defaultActorRole: "orchestrator",
    inputSchema: {
      type: "object",
      required: ["targetCorpus", "notePath", "frontmatter", "body", "validationMode"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        targetCorpus: { type: "string", enum: ["context_brain", "general_notes"] },
        notePath: { type: "string" },
        frontmatter: { type: "object" },
        body: { type: "string" },
        validationMode: { type: "string", enum: ["draft", "promotion"] }
      }
    }
  },
  {
    name: "promote_note",
    title: "Promote Note",
    description: "Promote a staging draft into canonical memory through the deterministic orchestrator.",
    defaultActorRole: "orchestrator",
    inputSchema: {
      type: "object",
      required: ["draftNoteId", "targetCorpus", "promoteAsCurrentState"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        draftNoteId: { type: "string" },
        targetCorpus: { type: "string", enum: ["context_brain", "general_notes"] },
        expectedDraftRevision: { type: "string" },
        targetPath: { type: "string" },
        promoteAsCurrentState: { type: "boolean" }
      }
    }
  },
  {
    name: "query_history",
    title: "Query History",
    description: "Query bounded audit history for notes and promotion actions.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      required: ["limit"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        noteId: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        limit: { type: "number" }
      }
    }
  }
];

export function getToolDefinition(name: string): McpToolDefinition | undefined {
  return MCP_TOOL_DEFINITIONS.find((tool) => tool.name === name);
}
