import type {
  AuditHistoryService,
  NoteValidationService,
  PromotionOrchestratorService,
  StagingDraftService,
  TemporalRefreshService
} from "@multi-agent-brain/application";
import type {
  CreateRefreshDraftBatchRequest,
  CreateRefreshDraftRequest,
  DraftNoteRequest,
  PromoteNoteRequest,
  QueryHistoryRequest,
  ValidateNoteRequest,
  ValidateNoteResponse
} from "@multi-agent-brain/contracts";

export class BrainMemoryController {
  constructor(
    private readonly stagingDraftService: StagingDraftService,
    private readonly noteValidationService: NoteValidationService,
    private readonly promotionOrchestratorService: PromotionOrchestratorService,
    private readonly auditHistoryService: AuditHistoryService,
    private readonly temporalRefreshService: TemporalRefreshService
  ) {}

  async draftNote(
    request: DraftNoteRequest
  ) {
    return this.stagingDraftService.createDraft(request);
  }

  validateNote(request: ValidateNoteRequest): ValidateNoteResponse {
    return this.noteValidationService.validate(request);
  }

  async promoteNote(
    request: PromoteNoteRequest
  ) {
    return this.promotionOrchestratorService.promoteDraft(request);
  }

  async createRefreshDraft(
    request: CreateRefreshDraftRequest
  ) {
    return this.temporalRefreshService.createRefreshDraft(request);
  }

  async createRefreshDraftBatch(
    request: CreateRefreshDraftBatchRequest
  ) {
    return this.temporalRefreshService.createRefreshDraftBatch(request);
  }

  async queryHistory(
    request: QueryHistoryRequest
  ) {
    return this.auditHistoryService.queryHistory(request);
  }
}
