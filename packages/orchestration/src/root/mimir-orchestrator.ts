import {
  DEFAULT_CONTEXT_BUDGET,
  type AssembleAgentContextRequest,
  type AssembleAgentContextResponse,
  type AssembleContextPacketRequest,
  type AssembleContextPacketResponse,
  type CheckAiToolsRequest,
  type CheckAiToolsResponse,
  type CreateSessionArchiveRequest,
  type CreateRefreshDraftBatchRequest,
  type CreateRefreshDraftRequest,
  type DraftNoteRequest,
  type ExecuteCodingTaskRequest,
  type ExecuteCodingTaskResponse,
  type GetDecisionSummaryRequest,
  type GetAiToolPackagePlanRequest,
  type GetAiToolPackagePlanResponse,
  type ImportResourceRequest,
  type ListAgentTracesRequest,
  type ListAgentTracesResponse,
  type ListAiToolsRequest,
  type ListAiToolsResponse,
  type PromoteNoteRequest,
  type QueryHistoryRequest,
  type RetrieveContextRequest,
  type SearchSessionArchivesRequest,
  type ServiceResult,
  type ShowToolOutputRequest,
  type ShowToolOutputResponse,
  type ValidateNoteRequest,
  type ValidateNoteResponse
} from "@mimir/contracts";
import type { ActorAuthorizationPolicy } from "./actor-authorization-policy.js";
import type { MimisbrunnrDomainController } from "../mimisbrunnr/mimisbrunnr-domain-controller.js";
import type { CodingDomainController } from "../coding/coding-domain-controller.js";
import type { ModelRoleRegistry } from "../model-roles/model-role-registry.js";
import type { RoleProviderRegistry } from "../model-roles/provider-registry.js";
import type { OrchestratorCommand, TaskFamilyRouter } from "../routing/task-family-router.js";

interface AiToolRegistry {
  listTools(request: Pick<ListAiToolsRequest, "ids" | "includeEnvironment" | "includeRuntime">): ListAiToolsResponse;
  checkTools(request: Pick<CheckAiToolsRequest, "ids">): CheckAiToolsResponse;
  getPackagePlan(request: Pick<GetAiToolPackagePlanRequest, "ids">): GetAiToolPackagePlanResponse;
}

export class MimirOrchestrator {
  constructor(
    private readonly router: TaskFamilyRouter,
    private readonly mimisbrunnrController: MimisbrunnrDomainController,
    private readonly codingController: CodingDomainController,
    private readonly actorAuthorizationPolicy: ActorAuthorizationPolicy,
    readonly modelRoleRegistry: ModelRoleRegistry,
    readonly providerRegistry: RoleProviderRegistry,
    private readonly toolRegistry: AiToolRegistry
  ) {}

  async searchContext(
    request: RetrieveContextRequest
  ) {
    this.assertAuthorized("search_context", request.actor);
    this.assertMimisbrunnrRoute("search_context");
    return this.mimisbrunnrController.searchContext(request);
  }

  async searchSessionArchives(
    request: SearchSessionArchivesRequest
  ) {
    this.assertAuthorized("search_session_archives", request.actor);
    this.assertMimisbrunnrRoute("search_session_archives");
    return this.mimisbrunnrController.searchSessionArchives(request);
  }

  async fetchDecisionSummary(
    request: GetDecisionSummaryRequest
  ) {
    this.assertAuthorized("fetch_decision_summary", request.actor);
    this.assertMimisbrunnrRoute("fetch_decision_summary");
    return this.mimisbrunnrController.fetchDecisionSummary(request);
  }

  async getContextPacket(
    request: AssembleContextPacketRequest
  ): Promise<AssembleContextPacketResponse> {
    this.assertAuthorized("get_context_packet", request.actor);
    this.assertMimisbrunnrRoute("get_context_packet");
    return this.mimisbrunnrController.getContextPacket(request);
  }

  async assembleAgentContext(
    request: AssembleAgentContextRequest
  ): Promise<ServiceResult<AssembleAgentContextResponse>> {
    this.assertAuthorized("assemble_agent_context", request.actor);
    this.assertMimisbrunnrRoute("assemble_agent_context");
    return this.mimisbrunnrController.assembleAgentContext(request);
  }

  async draftNote(
    request: DraftNoteRequest
  ) {
    this.assertAuthorized("draft_note", request.actor);
    this.assertMimisbrunnrRoute("draft_note");
    return this.mimisbrunnrController.draftNote(request);
  }

  async createSessionArchive(
    request: CreateSessionArchiveRequest
  ) {
    this.assertAuthorized("create_session_archive", request.actor);
    this.assertMimisbrunnrRoute("create_session_archive");
    return this.mimisbrunnrController.createSessionArchive(request);
  }

  async createRefreshDraft(
    request: CreateRefreshDraftRequest
  ) {
    this.assertAuthorized("create_refresh_draft", request.actor);
    this.assertMimisbrunnrRoute("create_refresh_draft");
    return this.mimisbrunnrController.createRefreshDraft(request);
  }

  async createRefreshDraftBatch(
    request: CreateRefreshDraftBatchRequest
  ) {
    this.assertAuthorized("create_refresh_drafts", request.actor);
    this.assertMimisbrunnrRoute("create_refresh_drafts");
    return this.mimisbrunnrController.createRefreshDraftBatch(request);
  }

  async importResource(
    request: ImportResourceRequest
  ) {
    this.assertAuthorized("import_resource", request.actor);
    this.assertMimisbrunnrRoute("import_resource");
    return this.mimisbrunnrController.importResource(request);
  }

  validateNote(request: ValidateNoteRequest): ValidateNoteResponse {
    this.assertAuthorized("validate_note", request.actor);
    this.assertMimisbrunnrRoute("validate_note");
    return this.mimisbrunnrController.validateNote(request);
  }

  async promoteNote(
    request: PromoteNoteRequest
  ) {
    this.assertAuthorized("promote_note", request.actor);
    this.assertMimisbrunnrRoute("promote_note");
    return this.mimisbrunnrController.promoteNote(request);
  }

  async queryHistory(
    request: QueryHistoryRequest
  ) {
    this.assertAuthorized("query_history", request.actor);
    this.assertMimisbrunnrRoute("query_history");
    return this.mimisbrunnrController.queryHistory(request);
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

  listAiTools(request: ListAiToolsRequest): ListAiToolsResponse {
    this.assertAuthorized("list_ai_tools", request.actor);
    const route = this.router.route("list_ai_tools");
    if (route.domain !== "coding") {
      throw new Error("AI tool registry route is misconfigured.");
    }

    return this.toolRegistry.listTools({
      ids: request.ids,
      includeEnvironment: request.includeEnvironment,
      includeRuntime: request.includeRuntime
    });
  }

  getAiToolPackagePlan(request: GetAiToolPackagePlanRequest): GetAiToolPackagePlanResponse {
    this.assertAuthorized("tools_package_plan", request.actor);
    const route = this.router.route("tools_package_plan");
    if (route.domain !== "coding") {
      throw new Error("AI tool package-plan route is misconfigured.");
    }

    return this.toolRegistry.getPackagePlan({ ids: request.ids });
  }

  checkAiTools(request: CheckAiToolsRequest): CheckAiToolsResponse {
    this.assertAuthorized("check_ai_tools", request.actor);
    const route = this.router.route("check_ai_tools");
    if (route.domain !== "coding") {
      throw new Error("AI tool check route is misconfigured.");
    }

    return this.toolRegistry.checkTools({ ids: request.ids });
  }

  private assertMimisbrunnrRoute(
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
    if (route.domain !== "mimisbrunnr") {
      throw new Error(`Command '${command}' is not routed to the mimisbrunnr domain.`);
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
    const assembledContext = await this.mimisbrunnrController.assembleAgentContext({
      actor: request.actor,
      query: contextQuery,
      corpusIds: request.memoryContext.corpusIds ?? ["mimisbrunnr", "general_notes"],
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
          `<agent-context source="mimisbrunnr" authority="unavailable">Failed to assemble memory context: ${assembledContext.error.message}</agent-context>`
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
