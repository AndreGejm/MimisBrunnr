import type {
  AssembleContextPacketRequest,
  AssembleContextPacketResponse,
  DraftNoteRequest,
  ExecuteCodingTaskRequest,
  ExecuteCodingTaskResponse,
  GetDecisionSummaryRequest,
  PromoteNoteRequest,
  QueryHistoryRequest,
  RetrieveContextRequest,
  ValidateNoteRequest,
  ValidateNoteResponse
} from "@multi-agent-brain/contracts";
import type { BrainDomainController } from "../brain/brain-domain-controller.js";
import type { CodingDomainController } from "../coding/coding-domain-controller.js";
import type { ModelRoleRegistry } from "../model-roles/model-role-registry.js";
import type { RoleProviderRegistry } from "../model-roles/provider-registry.js";
import type { TaskFamilyRouter } from "../routing/task-family-router.js";

export class MultiAgentOrchestrator {
  constructor(
    private readonly router: TaskFamilyRouter,
    private readonly brainController: BrainDomainController,
    private readonly codingController: CodingDomainController,
    readonly modelRoleRegistry: ModelRoleRegistry,
    readonly providerRegistry: RoleProviderRegistry
  ) {}

  async searchContext(
    request: RetrieveContextRequest
  ) {
    this.assertBrainRoute("search_context");
    return this.brainController.searchContext(request);
  }

  async fetchDecisionSummary(
    request: GetDecisionSummaryRequest
  ) {
    this.assertBrainRoute("fetch_decision_summary");
    return this.brainController.fetchDecisionSummary(request);
  }

  async getContextPacket(
    request: AssembleContextPacketRequest
  ): Promise<AssembleContextPacketResponse> {
    this.assertBrainRoute("get_context_packet");
    return this.brainController.getContextPacket(request);
  }

  async draftNote(
    request: DraftNoteRequest
  ) {
    this.assertBrainRoute("draft_note");
    return this.brainController.draftNote(request);
  }

  validateNote(request: ValidateNoteRequest): ValidateNoteResponse {
    this.assertBrainRoute("validate_note");
    return this.brainController.validateNote(request);
  }

  async promoteNote(
    request: PromoteNoteRequest
  ) {
    this.assertBrainRoute("promote_note");
    return this.brainController.promoteNote(request);
  }

  async queryHistory(
    request: QueryHistoryRequest
  ) {
    this.assertBrainRoute("query_history");
    return this.brainController.queryHistory(request);
  }

  async executeCodingTask(
    request: ExecuteCodingTaskRequest
  ): Promise<ExecuteCodingTaskResponse> {
    const route = this.router.route("execute_coding_task");
    if (route.domain !== "coding") {
      throw new Error("Coding task route is misconfigured.");
    }

    return this.codingController.executeTask(request);
  }

  private assertBrainRoute(
    command:
      | "search_context"
      | "get_context_packet"
      | "fetch_decision_summary"
      | "draft_note"
      | "validate_note"
      | "promote_note"
      | "query_history"
  ): void {
    const route = this.router.route(command);
    if (route.domain !== "brain") {
      throw new Error(`Command '${command}' is not routed to the brain domain.`);
    }
  }
}
