import {
  RUNTIME_COMMAND_DEFINITIONS,
  type ActorRole
} from "@mimir/contracts";
import { AUDIT_ACTION_TYPES } from "@mimir/domain";

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  defaultActorRole: ActorRole;
  inputSchema: Record<string, unknown>;
}

const UNORDERED_MCP_TOOL_DEFINITIONS: ReadonlyArray<McpToolDefinition> = [
  {
    name: "execute_coding_task",
    title: "Execute Coding Task",
    description: "Run a coding-domain task through the vendored safety-gated coding runtime.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      required: ["taskType", "task"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        taskType: {
          type: "string",
          enum: ["triage", "review", "draft_patch", "generate_tests", "summarize_diff", "propose_fix"]
        },
        task: { type: "string" },
        context: { type: "string" },
        memoryContext: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string" },
            corpusIds: {
              type: "array",
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
            includeSessionArchives: { type: "boolean" },
            sessionId: { type: "string" },
            includeTrace: { type: "boolean" }
          }
        },
        repoRoot: { type: "string" },
        filePath: { type: "string" },
        symbolName: { type: "string" },
        diffText: { type: "string" },
        pytestTarget: { type: "string" },
        lintTarget: { type: "string" }
      }
    }
  },
  {
    name: "list_agent_traces",
    title: "List Agent Traces",
    description: "List compact operational traces for one local-agent request.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      required: ["requestId"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        requestId: { type: "string" }
      }
    }
  },
  {
    name: "show_tool_output",
    title: "Show Tool Output",
    description: "Read a full spilled local-agent tool output by output id.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      required: ["outputId"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        outputId: { type: "string" }
      }
    }
  },
  {
    name: "list_ai_tools",
    title: "List AI Tools",
    description: "List read-only Docker AI tool manifests from the registry.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        ids: { type: "array", items: { type: "string" } },
        includeEnvironment: { type: "boolean" },
        includeRuntime: { type: "boolean" }
      }
    }
  },
  {
    name: "check_ai_tools",
    title: "Check AI Tools",
    description: "Validate Docker AI tool manifests and return per-file check results without executing tools.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        ids: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "tools_package_plan",
    title: "Tools Package Plan",
    description: "Build a reusable Docker package plan for registered AI tools without executing tools.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        ids: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "search_context",
    title: "Search Context",
    description: "Run bounded hybrid retrieval and return a context packet with provenance.",
    defaultActorRole: "retrieval",
    inputSchema: {
      type: "object",
      required: ["query", "corpusIds"],
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
    name: "search_session_archives",
    title: "Search Session Archives",
    description: "Search immutable non-authoritative session archives for bounded recall.",
    defaultActorRole: "retrieval",
    inputSchema: {
      type: "object",
      required: ["query"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        query: { type: "string" },
        sessionId: { type: "string" },
        limit: { type: "number" },
        maxTokens: { type: "number" }
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
      required: ["query", "corpusIds"],
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
    name: "list_context_tree",
    title: "List Context Tree",
    description: "List namespace nodes without mutating authority state.",
    defaultActorRole: "retrieval",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        ownerScope: { type: "string" },
        authorityStates: {
          type: "array",
          items: { type: "string" }
        }
      }
    }
  },
  {
    name: "read_context_node",
    title: "Read Context Node",
    description: "Read a namespace node without mutating authority state.",
    defaultActorRole: "retrieval",
    inputSchema: {
      type: "object",
      required: ["uri"],
      additionalProperties: true,
      properties: {
        uri: { type: "string" }
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
          items: {
            type: "object",
            required: [
              "noteType",
              "score",
              "summary",
              "scope",
              "qualifiers",
              "tags",
              "stalenessClass",
              "provenance"
            ],
            additionalProperties: true,
            properties: {
              noteType: { type: "string" },
              score: { type: "number" },
              summary: { type: "string" },
              rawText: { type: "string" },
              scope: { type: "string" },
              qualifiers: { type: "array", items: { type: "string" } },
              tags: { type: "array", items: { type: "string" } },
              stalenessClass: {
                type: "string",
                enum: ["current", "stale", "superseded"]
              },
              provenance: {
                type: "object",
                required: ["noteId", "notePath", "headingPath"],
                additionalProperties: true,
                properties: {
                  noteId: { type: "string" },
                  chunkId: { type: "string" },
                  notePath: { type: "string" },
                  headingPath: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              }
            }
          }
        },
        includeRawExcerpts: { type: "boolean" }
      }
    }
  },
  {
    name: "create_refresh_draft",
    title: "Create Refresh Draft",
    description: "Create a governed staging refresh draft for an expired or expiring current-state canonical note.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      required: ["noteId"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        noteId: { type: "string" },
        asOf: { type: "string" },
        expiringWithinDays: { type: "number" },
        bodyHints: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "create_refresh_drafts",
    title: "Create Refresh Drafts",
    description: "Create a bounded batch of governed staging refresh drafts from current temporal-validity candidates.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        asOf: { type: "string" },
        expiringWithinDays: { type: "number" },
        corpusId: { type: "string", enum: ["mimisbrunnr", "general_notes"] },
        limitPerCategory: { type: "number" },
        maxDrafts: { type: "number" },
        sourceStates: {
          type: "array",
          items: {
            type: "string",
            enum: ["expired", "future_dated", "expiring_soon"]
          }
        },
        bodyHints: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "import_resource",
    title: "Import Resource",
    description: "Record a controlled import job without writing canonical memory.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      required: ["sourcePath", "importKind"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        sourcePath: { type: "string" },
        importKind: { type: "string" }
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
    name: "list_review_queue",
    title: "List Review Queue",
    description: "List active staging notes for thin review frontends without moving files directly.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        targetCorpus: { type: "string", enum: ["mimisbrunnr", "general_notes"] },
        includeRejected: { type: "boolean" }
      }
    }
  },
  {
    name: "read_review_note",
    title: "Read Review Note",
    description: "Read one staging note for thin review frontends without direct vault access.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      required: ["draftNoteId"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        draftNoteId: { type: "string" }
      }
    }
  },
  {
    name: "accept_note",
    title: "Accept Note",
    description: "Accept one staging note and promote it through the governed review flow.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      required: ["draftNoteId"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        draftNoteId: { type: "string" }
      }
    }
  },
  {
    name: "reject_note",
    title: "Reject Note",
    description: "Reject one staging note through the governed review flow without moving files directly.",
    defaultActorRole: "operator",
    inputSchema: {
      type: "object",
      required: ["draftNoteId"],
      additionalProperties: true,
      properties: {
        actor: { type: "object" },
        draftNoteId: { type: "string" },
        reviewNotes: { type: "string" }
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
      required: ["topic"],
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
        targetCorpus: { type: "string", enum: ["mimisbrunnr", "general_notes"] },
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
        targetCorpus: { type: "string", enum: ["mimisbrunnr", "general_notes"] },
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
        actorId: { type: "string" },
        actionType: {
          type: "string",
          enum: [...AUDIT_ACTION_TYPES]
        },
        noteId: { type: "string" },
        source: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        limit: { type: "number" }
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
const MCP_TOOL_ORDER = new Map<string, number>(
  RUNTIME_COMMAND_DEFINITIONS.map((command, index) => [command.name, index])
);

export const MCP_TOOL_DEFINITIONS: ReadonlyArray<McpToolDefinition> = [
  ...UNORDERED_MCP_TOOL_DEFINITIONS
].sort((left, right) =>
  (MCP_TOOL_ORDER.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
  (MCP_TOOL_ORDER.get(right.name) ?? Number.MAX_SAFE_INTEGER)
);

export function getToolDefinition(name: string): McpToolDefinition | undefined {
  return MCP_TOOL_DEFINITIONS.find((tool) => tool.name === name);
}
