import type {
  AuditHistoryService,
  NoteValidationService,
  PromotionOrchestratorService,
  SessionArchiveService,
  StagingDraftService,
  TemporalRefreshService
} from "@mimir/application";
import type {
  CreateSessionArchiveRequest,
  CreateRefreshDraftBatchRequest,
  CreateRefreshDraftRequest,
  DraftNoteRequest,
  PromoteNoteRequest,
  QueryHistoryRequest,
  SearchSessionArchivesRequest,
  ValidateNoteRequest,
  ValidateNoteResponse
} from "@mimir/contracts";

export class MimisbrunnrMemoryController {
  constructor(
    private readonly stagingDraftService: StagingDraftService,
    private readonly noteValidationService: NoteValidationService,
    private readonly promotionOrchestratorService: PromotionOrchestratorService,
    private readonly sessionArchiveService: SessionArchiveService,
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

  async createSessionArchive(
    request: CreateSessionArchiveRequest
  ) {
    return this.sessionArchiveService.createArchive(request);
  }

  async searchSessionArchives(
    request: SearchSessionArchivesRequest
  ) {
    return this.sessionArchiveService.searchArchives(request);
  }

  async queryHistory(
    request: QueryHistoryRequest
  ) {
    return this.auditHistoryService.queryHistory(request);
  }
}
