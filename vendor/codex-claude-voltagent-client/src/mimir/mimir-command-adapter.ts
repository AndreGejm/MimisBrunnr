import type {
  AssembleAgentContextRequest,
  AssembleContextPacketRequest,
  DraftNoteRequest,
  ExecuteCodingTaskRequest,
  ListAgentTracesRequest
} from "./command-types.js";
import type { MimirTransport } from "./mimir-transport.js";

export interface MimirCommandSurface {
  retrieveContext(args: AssembleAgentContextRequest): Promise<unknown>;
  getContextPacket(args: AssembleContextPacketRequest): Promise<unknown>;
  executeLocalCodingTask(args: ExecuteCodingTaskRequest): Promise<unknown>;
  listLocalAgentTraces(args: ListAgentTracesRequest): Promise<unknown>;
  draftMemoryNote(args: DraftNoteRequest): Promise<unknown>;
}

export class MimirCommandAdapter implements MimirCommandSurface {
  constructor(private readonly transport: MimirTransport) {}

  retrieveContext(args: AssembleAgentContextRequest) {
    return this.transport.callTool("assemble_agent_context", args);
  }

  getContextPacket(args: AssembleContextPacketRequest) {
    return this.transport.callTool("get_context_packet", args);
  }

  executeLocalCodingTask(args: ExecuteCodingTaskRequest) {
    return this.transport.callTool("execute_coding_task", args);
  }

  listLocalAgentTraces(args: ListAgentTracesRequest) {
    return this.transport.callTool("list_agent_traces", args);
  }

  draftMemoryNote(args: DraftNoteRequest) {
    return this.transport.callTool("draft_note", args);
  }
}
