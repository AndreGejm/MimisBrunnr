import type { ImportOrchestrationService } from "@mimir/application";
import type {
  AssembleAgentContextRequest,
  AssembleContextPacketRequest,
  AssembleContextPacketResponse,
  CreateSessionArchiveRequest,
  CreateRefreshDraftBatchRequest,
  CreateRefreshDraftRequest,
  DraftNoteRequest,
  GetDecisionSummaryRequest,
  ImportResourceRequest,
  ListContextTreeRequest,
  PromoteNoteRequest,
  QueryHistoryRequest,
  ReadContextNodeRequest,
  RetrieveContextRequest,
  SearchSessionArchivesRequest,
  ValidateNoteRequest,
  ValidateNoteResponse
} from "@mimir/contracts";
import type { MimisbrunnrMemoryController } from "./mimisbrunnr-memory-controller.js";
import type { MimisbrunnrRetrievalController } from "./mimisbrunnr-retrieval-controller.js";

export class MimisbrunnrDomainController {
  constructor(
    private readonly retrievalController: MimisbrunnrRetrievalController,
    private readonly memoryController: MimisbrunnrMemoryController,
    private readonly importOrchestrationService: ImportOrchestrationService
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

  async assembleAgentContext(
    request: AssembleAgentContextRequest
  ) {
    return this.retrievalController.assembleAgentContext(request);
  }

  async listContextTree(
    request: ListContextTreeRequest
  ) {
    return this.retrievalController.listContextTree(request);
  }

  async readContextNode(
    request: ReadContextNodeRequest
  ) {
    return this.retrievalController.readContextNode(request);
  }

  async draftNote(
    request: DraftNoteRequest
  ) {
    return this.memoryController.draftNote(request);
  }

  async createSessionArchive(
    request: CreateSessionArchiveRequest
  ) {
    return this.memoryController.createSessionArchive(request);
  }

  async searchSessionArchives(
    request: SearchSessionArchivesRequest
  ) {
    return this.memoryController.searchSessionArchives(request);
  }

  async createRefreshDraft(
    request: CreateRefreshDraftRequest
  ) {
    return this.memoryController.createRefreshDraft(request);
  }

  async createRefreshDraftBatch(
    request: CreateRefreshDraftBatchRequest
  ) {
    return this.memoryController.createRefreshDraftBatch(request);
  }

  async importResource(
    request: ImportResourceRequest
  ) {
    return this.importOrchestrationService.importResource(request);
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
