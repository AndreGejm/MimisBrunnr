import { describe, expect, it, vi } from "vitest";
import {
  type AssembleAgentContextRequest,
  type AssembleContextPacketRequest,
  type DraftNoteRequest,
  type ExecuteCodingTaskRequest,
  type ListAgentTracesRequest
} from "../../src/mimir/command-types.js";
import { MimirCommandAdapter } from "../../src/mimir/mimir-command-adapter.js";

const actor = {
  actorId: "codex",
  actorRole: "retrieval",
  transport: "mcp",
  source: "test",
  requestId: "req-123",
  initiatedAt: "2026-04-24T15:00:00.000Z"
} as const;

describe("MimirCommandAdapter", () => {
  it("maps retrieveContext onto assemble_agent_context", async () => {
    const args: AssembleAgentContextRequest = {
      actor,
      query: "routing",
      budget: {
        maxTokens: 400,
        maxSources: 3,
        maxRawExcerpts: 1,
        maxSummarySentences: 4
      },
      corpusIds: ["general_notes"],
      includeTrace: true
    };
    const callTool = vi.fn(async (name: string, toolArgs: unknown) => {
      expect(name).toBe("assemble_agent_context");
      expect(toolArgs).toEqual(args);
      return { contextBlock: "ok" };
    });

    const adapter = new MimirCommandAdapter({ callTool });
    const result = await adapter.retrieveContext(args);

    expect(result).toEqual({ contextBlock: "ok" });
  });

  it("maps getContextPacket onto get_context_packet", async () => {
    const args: AssembleContextPacketRequest = {
      actor,
      intent: "implementation_guidance",
      budget: {
        maxTokens: 300,
        maxSources: 2,
        maxRawExcerpts: 1,
        maxSummarySentences: 2
      },
      candidates: [
        {
          noteType: "reference",
          score: 0.91,
          summary: "Adapter maps requests directly.",
          scope: "general_notes",
          qualifiers: ["task-2"],
          tags: ["artifact/adapter"],
          stalenessClass: "current",
          provenance: {
            noteId: "note-1",
            notePath: "general_notes/task-2.md",
            headingPath: ["Adapter"]
          }
        }
      ],
      includeRawExcerpts: false
    };
    const callTool = vi.fn(async (name: string, toolArgs: unknown) => {
      expect(name).toBe("get_context_packet");
      expect(toolArgs).toEqual(args);
      return { packet: { summary: "ok" } };
    });

    const adapter = new MimirCommandAdapter({ callTool });
    const result = await adapter.getContextPacket(args);

    expect(result).toEqual({ packet: { summary: "ok" } });
  });

  it("maps executeLocalCodingTask onto execute_coding_task", async () => {
    const args: ExecuteCodingTaskRequest = {
      actor: {
        ...actor,
        actorRole: "orchestrator"
      },
      taskType: "review",
      task: "Review the adapter diff",
      repoRoot: "F:/Dev/scripts/codex-claude-voltagent-client",
      filePath: "src/mimir/mimir-command-adapter.ts"
    };
    const callTool = vi.fn(async (name: string, toolArgs: unknown) => {
      expect(name).toBe("execute_coding_task");
      expect(toolArgs).toEqual(args);
      return { status: "success" };
    });

    const adapter = new MimirCommandAdapter({ callTool });
    const result = await adapter.executeLocalCodingTask(args);

    expect(result).toEqual({ status: "success" });
  });

  it("maps listLocalAgentTraces onto list_agent_traces", async () => {
    const args: ListAgentTracesRequest = {
      actor: {
        ...actor,
        actorRole: "operator"
      },
      requestId: "trace-123"
    };
    const callTool = vi.fn(async (name: string, toolArgs: unknown) => {
      expect(name).toBe("list_agent_traces");
      expect(toolArgs).toEqual(args);
      return { traces: [] };
    });

    const adapter = new MimirCommandAdapter({ callTool });
    const result = await adapter.listLocalAgentTraces(args);

    expect(result).toEqual({ traces: [] });
  });

  it("maps draftMemoryNote onto draft_note", async () => {
    const args: DraftNoteRequest = {
      actor: {
        ...actor,
        actorRole: "writer"
      },
      targetCorpus: "general_notes",
      noteType: "reference",
      title: "external client adds narrow adapter",
      sourcePrompt: "Capture the adapter surface.",
      supportingSources: [
        {
          noteId: "note-2",
          notePath: "general_notes/adapter.md",
          headingPath: ["Adapter"],
          excerpt: "The adapter forwards five methods."
        }
      ],
      bodyHints: ["adapter", "task-2"]
    };
    const callTool = vi.fn(async (name: string, toolArgs: unknown) => {
      expect(name).toBe("draft_note");
      expect(toolArgs).toEqual(args);
      return { draftNoteId: "draft-1" };
    });

    const adapter = new MimirCommandAdapter({ callTool });
    const result = await adapter.draftMemoryNote(args);

    expect(result).toEqual({ draftNoteId: "draft-1" });
  });

  it("does not expose Workspace or workspace_* methods", () => {
    const adapter = new MimirCommandAdapter({
      callTool: vi.fn()
    });

    expect("workspaceListSkills" in adapter).toBe(false);
    expect("workspaceActivateSkill" in adapter).toBe(false);
  });
});
