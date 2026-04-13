import {
  DEFAULT_CONTEXT_BUDGET,
  type AssembleAgentContextRequest,
  type AssembleAgentContextResponse,
  type AssembleContextPacketRequest,
  type AssembleContextPacketResponse,
  type CreateSessionArchiveRequest,
  type CreateRefreshDraftBatchRequest,
  type CreateRefreshDraftRequest,
  type DraftNoteRequest,
  type ExecuteCodingTaskRequest,
  type ExecuteCodingTaskResponse,
  type GetDecisionSummaryRequest,
  type ImportResourceRequest,
  type ListAgentTracesRequest,
  type ListAgentTracesResponse,
  type PromoteNoteRequest,
  type QueryHistoryRequest,
  type RetrieveContextRequest,
  type SearchSessionArchivesRequest,
  type ServiceResult,
  type ShowToolOutputRequest,
  type ShowToolOutputResponse,
  type ValidateNoteRequest,
  type ValidateNoteResponse
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

  async searchSessionArchives(
    request: SearchSessionArchivesRequest
  ) {
    this.assertAuthorized("search_session_archives", request.actor);
    this.assertBrainRoute("search_session_archives");
    return this.brainController.searchSessionArchives(request);
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

  async assembleAgentContext(
    request: AssembleAgentContextRequest
  ): Promise<ServiceResult<AssembleAgentContextResponse>> {
    this.assertAuthorized("assemble_agent_context", request.actor);
    this.assertBrainRoute("assemble_agent_context");
    return this.brainController.assembleAgentContext(request);
  }

  async draftNote(
    request: DraftNoteRequest
  ) {
    this.assertAuthorized("draft_note", request.actor);
    this.assertBrainRoute("draft_note");
    return this.brainController.draftNote(request);
  }

  async createSessionArchive(
    request: CreateSessionArchiveRequest
  ) {
    this.assertAuthorized("create_session_archive", request.actor);
    this.assertBrainRoute("create_session_archive");
    return this.brainController.createSessionArchive(request);
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

  async importResource(
    request: ImportResourceRequest
  ) {
    this.assertAuthorized("import_resource", request.actor);
    this.assertBrainRoute("import_resource");
    return this.brainController.importResource(request);
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

    const executionRequest = await this.injectMemoryContext(request);
    return this.codingController.executeTask(executionRequest);
  }

  async listAgentTraces(
    request: ListAgentTracesRequest
  ): Promise<ListAgentTracesResponse> {
    this.assertAuthorized("list_agent_traces", request.actor);
    const route = this.router.route("list_agent_traces");
    if (route.domain !== "coding") {
      throw new Error("Agent trace route is misconfigured.");
    }

    return {
      traces: await this.codingController.listTraces(request.requestId)
    };
  }

  async showToolOutput(
    request: ShowToolOutputRequest
  ): Promise<ShowToolOutputResponse> {
    this.assertAuthorized("show_tool_output", request.actor);
    const route = this.router.route("show_tool_output");
    if (route.domain !== "coding") {
      throw new Error("Tool output route is misconfigured.");
    }

    const output = await this.codingController.showToolOutput(request.outputId);
    return output ? { found: true, output } : { found: false };
  }

  private assertBrainRoute(
    command:
      | "search_context"
      | "search_session_archives"
      | "assemble_agent_context"
      | "get_context_packet"
      | "fetch_decision_summary"
      | "draft_note"
      | "create_session_archive"
      | "create_refresh_draft"
      | "create_refresh_drafts"
      | "import_resource"
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

  private async injectMemoryContext(
    request: ExecuteCodingTaskRequest
  ): Promise<ExecuteCodingTaskRequest> {
    if (!request.memoryContext) {
      return request;
    }

    const { memoryContext, ...executionRequest } = request;
    const contextQuery = request.memoryContext.query ??
      [request.task, request.filePath, request.symbolName]
        .filter((value): value is string => Boolean(value?.trim()))
        .join(" ");
    const assembledContext = await this.brainController.assembleAgentContext({
      actor: request.actor,
      query: contextQuery,
      corpusIds: request.memoryContext.corpusIds ?? ["context_brain", "general_notes"],
      budget: request.memoryContext.budget ?? DEFAULT_CONTEXT_BUDGET,
      includeSessionArchives:
        request.memoryContext.includeSessionArchives ?? Boolean(request.memoryContext.sessionId),
      sessionId: request.memoryContext.sessionId,
      includeTrace: request.memoryContext.includeTrace
    });

    if (!assembledContext.ok) {
      return {
        ...executionRequest,
        memoryContextStatus: {
          requested: true,
          included: false,
          errorMessage: assembledContext.error.message
        },
        context: appendContextBlock(
          request.context,
          `<agent-context source="multi-agent-brain" authority="unavailable">Failed to assemble memory context: ${assembledContext.error.message}</agent-context>`
        )
      };
    }

    void memoryContext;
    return {
      ...executionRequest,
      memoryContextStatus: {
        requested: true,
        included: true,
        retrievalHealth: assembledContext.data.retrievalHealth
          ? { status: assembledContext.data.retrievalHealth.status }
          : undefined,
        traceIncluded: Boolean(assembledContext.data.trace),
        tokenEstimate: assembledContext.data.tokenEstimate,
        truncated: assembledContext.data.truncated
      },
      context: appendContextBlock(request.context, assembledContext.data.contextBlock)
    };
  }
}

function appendContextBlock(existingContext: string | undefined, contextBlock: string): string {
  const existing = existingContext?.trim();
  return existing ? `${existing}\n\n${contextBlock}` : contextBlock;
}
