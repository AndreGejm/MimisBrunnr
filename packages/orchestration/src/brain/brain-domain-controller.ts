import type {
  AssembleContextPacketRequest,
  AssembleContextPacketResponse,
  CreateRefreshDraftRequest,
  DraftNoteRequest,
  GetDecisionSummaryRequest,
  PromoteNoteRequest,
  QueryHistoryRequest,
  RetrieveContextRequest,
  ValidateNoteRequest,
  ValidateNoteResponse
} from "@multi-agent-brain/contracts";
import type { BrainMemoryController } from "./brain-memory-controller.js";
import type { BrainRetrievalController } from "./brain-retrieval-controller.js";

export class BrainDomainController {
  constructor(
    private readonly retrievalController: BrainRetrievalController,
    private readonly memoryController: BrainMemoryController
  ) {}

  async searchContext(
    request: RetrieveContextRequest
  ) {
    return this.retrievalController.searchContext(request);
  }

  async fetchDecisionSummary(
    request: GetDecisionSummaryRequest
  ) {
    return this.retrievalController.fetchDecisionSummary(request);
  }

  async getContextPacket(
    request: AssembleContextPacketRequest
  ): Promise<AssembleContextPacketResponse> {
    return this.retrievalController.getContextPacket(request);
  }

  async draftNote(
    request: DraftNoteRequest
  ) {
    return this.memoryController.draftNote(request);
  }

  async createRefreshDraft(
    request: CreateRefreshDraftRequest
  ) {
    return this.memoryController.createRefreshDraft(request);
  }

  validateNote(request: ValidateNoteRequest): ValidateNoteResponse {
    return this.memoryController.validateNote(request);
  }

  async promoteNote(
    request: PromoteNoteRequest
  ) {
    return this.memoryController.promoteNote(request);
  }

  async queryHistory(
    request: QueryHistoryRequest
  ) {
    return this.memoryController.queryHistory(request);
  }
}
