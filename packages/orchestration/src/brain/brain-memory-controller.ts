import type {
  AuditHistoryService,
  NoteValidationService,
  PromotionOrchestratorService,
  StagingDraftService
} from "@multi-agent-brain/application";
import type {
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
    private readonly auditHistoryService: AuditHistoryService
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

  async queryHistory(
    request: QueryHistoryRequest
  ) {
    return this.auditHistoryService.queryHistory(request);
  }
}
