import type {
  AssembleContextPacketRequest,
  AssembleContextPacketResponse,
  CreateRefreshDraftBatchRequest,
  CreateRefreshDraftRequest,
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
import type { ActorAuthorizationPolicy } from "./actor-authorization-policy.js";
import type { BrainDomainController } from "../brain/brain-domain-controller.js";
import type { CodingDomainController } from "../coding/coding-domain-controller.js";
import type { ModelRoleRegistry } from "../model-roles/model-role-registry.js";
import type { RoleProviderRegistry } from "../model-roles/provider-registry.js";
import type { OrchestratorCommand, TaskFamilyRouter } from "../routing/task-family-router.js";

export class MultiAgentOrchestrator {
  constructor(
    private readonly router: TaskFamilyRouter,
    private readonly brainController: BrainDomainController,
    private readonly codingController: CodingDomainController,
    private readonly actorAuthorizationPolicy: ActorAuthorizationPolicy,
    readonly modelRoleRegistry: ModelRoleRegistry,
    readonly providerRegistry: RoleProviderRegistry
  ) {}

  async searchContext(
    request: RetrieveContextRequest
  ) {
    this.assertAuthorized("search_context", request.actor);
    this.assertBrainRoute("search_context");
    return this.brainController.searchContext(request);
  }

  async fetchDecisionSummary(
    request: GetDecisionSummaryRequest
  ) {
    this.assertAuthorized("fetch_decision_summary", request.actor);
    this.assertBrainRoute("fetch_decision_summary");
    return this.brainController.fetchDecisionSummary(request);
  }

  async getContextPacket(
    request: AssembleContextPacketRequest
  ): Promise<AssembleContextPacketResponse> {
    this.assertAuthorized("get_context_packet", request.actor);
    this.assertBrainRoute("get_context_packet");
    return this.brainController.getContextPacket(request);
  }

  async draftNote(
    request: DraftNoteRequest
  ) {
    this.assertAuthorized("draft_note", request.actor);
    this.assertBrainRoute("draft_note");
    return this.brainController.draftNote(request);
  }

  async createRefreshDraft(
    request: CreateRefreshDraftRequest
  ) {
    this.assertAuthorized("create_refresh_draft", request.actor);
    this.assertBrainRoute("create_refresh_draft");
    return this.brainController.createRefreshDraft(request);
  }

  async createRefreshDraftBatch(
    request: CreateRefreshDraftBatchRequest
  ) {
    this.assertAuthorized("create_refresh_drafts", request.actor);
    this.assertBrainRoute("create_refresh_drafts");
    return this.brainController.createRefreshDraftBatch(request);
  }

  validateNote(request: ValidateNoteRequest): ValidateNoteResponse {
    this.assertAuthorized("validate_note", request.actor);
    this.assertBrainRoute("validate_note");
    return this.brainController.validateNote(request);
  }

  async promoteNote(
    request: PromoteNoteRequest
  ) {
    this.assertAuthorized("promote_note", request.actor);
    this.assertBrainRoute("promote_note");
    return this.brainController.promoteNote(request);
  }

  async queryHistory(
    request: QueryHistoryRequest
  ) {
    this.assertAuthorized("query_history", request.actor);
    this.assertBrainRoute("query_history");
    return this.brainController.queryHistory(request);
  }

  async executeCodingTask(
    request: ExecuteCodingTaskRequest
  ): Promise<ExecuteCodingTaskResponse> {
    this.assertAuthorized("execute_coding_task", request.actor);
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
      | "create_refresh_draft"
      | "create_refresh_drafts"
      | "validate_note"
      | "promote_note"
      | "query_history"
  ): void {
    const route = this.router.route(command);
    if (route.domain !== "brain") {
      throw new Error(`Command '${command}' is not routed to the brain domain.`);
    }
  }

  private assertAuthorized(
    command: OrchestratorCommand,
    actor: RetrieveContextRequest["actor"]
  ): void {
    this.actorAuthorizationPolicy.authorize(command, actor);
  }
}
