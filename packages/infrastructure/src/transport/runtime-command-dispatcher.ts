import type {
  AcceptNoteRequest,
  ActorContext,
  AssembleAgentContextRequest,
  AssembleContextPacketRequest,
  ListReviewQueueRequest,
  CheckAiToolsRequest,
  CreateRefreshDraftBatchRequest,
  CreateRefreshDraftRequest,
  CreateSessionArchiveRequest,
  DraftNoteRequest,
  ExecuteCodingTaskRequest,
  GetAiToolPackagePlanRequest,
  GetDecisionSummaryRequest,
  ImportResourceRequest,
  ListAgentTracesRequest,
  ListAiToolsRequest,
  ListContextTreeRequest,
  PromoteNoteRequest,
  QueryHistoryRequest,
  ReadReviewNoteRequest,
  ReadContextNodeRequest,
  RejectNoteRequest,
  RetrieveContextRequest,
  RuntimeCliCommandName,
  SearchSessionArchivesRequest,
  ServiceError,
  ShowToolOutputRequest,
  ValidateNoteRequest
} from "@mimir/contracts";
import type { ServiceContainer } from "../bootstrap/build-service-container.js";

type JsonRecord = Record<string, unknown>;

type RuntimeCommandHandler = (
  request: JsonRecord,
  container: ServiceContainer
) => Promise<unknown>;

const RUNTIME_COMMAND_HANDLERS: Record<RuntimeCliCommandName, RuntimeCommandHandler> = {
  "execute-coding-task": async (request, container) =>
    container.orchestrator.executeCodingTask(
      request as unknown as ExecuteCodingTaskRequest
    ),
  "list-agent-traces": async (request, container) =>
    container.orchestrator.listAgentTraces(
      request as unknown as ListAgentTracesRequest
    ),
  "show-tool-output": async (request, container) =>
    container.orchestrator.showToolOutput(
      request as unknown as ShowToolOutputRequest
    ),
  "list-ai-tools": async (request, container) =>
    container.orchestrator.listAiTools(
      request as unknown as ListAiToolsRequest
    ),
  "check-ai-tools": async (request, container) =>
    container.orchestrator.checkAiTools(
      request as unknown as CheckAiToolsRequest
    ),
  "tools-package-plan": async (request, container) =>
    container.orchestrator.getAiToolPackagePlan(
      request as unknown as GetAiToolPackagePlanRequest
    ),
  "search-context": async (request, container) =>
    container.orchestrator.searchContext(
      request as unknown as RetrieveContextRequest
    ),
  "search-session-archives": async (request, container) =>
    container.orchestrator.searchSessionArchives(
      request as unknown as SearchSessionArchivesRequest
    ),
  "assemble-agent-context": async (request, container) =>
    container.orchestrator.assembleAgentContext(
      request as unknown as AssembleAgentContextRequest
    ),
  "list-context-tree": async (request, container) =>
    container.orchestrator.listContextTree(
      request as unknown as ListContextTreeRequest
    ),
  "read-context-node": async (request, container) =>
    container.orchestrator.readContextNode(
      request as unknown as ReadContextNodeRequest
    ),
  "get-context-packet": async (request, container) =>
    container.orchestrator.getContextPacket(
      request as unknown as AssembleContextPacketRequest
    ),
  "fetch-decision-summary": async (request, container) =>
    container.orchestrator.fetchDecisionSummary(
      request as unknown as GetDecisionSummaryRequest
    ),
  "draft-note": async (request, container) =>
    container.orchestrator.draftNote(
      request as unknown as DraftNoteRequest
    ),
  "list-review-queue": async (request, container) => {
    const typedRequest = request as unknown as ListReviewQueueRequest;
    container.authPolicy.authorize("list_review_queue", typedRequest.actor);
    return container.services.reviewCommandService.listQueue(typedRequest);
  },
  "read-review-note": async (request, container) => {
    const typedRequest = request as unknown as ReadReviewNoteRequest;
    container.authPolicy.authorize("read_review_note", typedRequest.actor);
    return container.services.reviewCommandService.readNote(typedRequest);
  },
  "accept-note": async (request, container) => {
    const typedRequest = request as unknown as AcceptNoteRequest;
    container.authPolicy.authorize("accept_note", typedRequest.actor);
    return container.services.reviewCommandService.acceptNote(typedRequest);
  },
  "reject-note": async (request, container) => {
    const typedRequest = request as unknown as RejectNoteRequest;
    container.authPolicy.authorize("reject_note", typedRequest.actor);
    return container.services.reviewCommandService.rejectNote(typedRequest);
  },
  "create-refresh-draft": async (request, container) =>
    container.orchestrator.createRefreshDraft(
      request as unknown as CreateRefreshDraftRequest
    ),
  "create-refresh-drafts": async (request, container) =>
    container.orchestrator.createRefreshDraftBatch(
      request as unknown as CreateRefreshDraftBatchRequest
    ),
  "validate-note": async (request, container) =>
    container.orchestrator.validateNote(
      request as unknown as ValidateNoteRequest
    ),
  "promote-note": async (request, container) =>
    container.orchestrator.promoteNote(
      request as unknown as PromoteNoteRequest
    ),
  "import-resource": async (request, container) =>
    container.orchestrator.importResource(
      request as unknown as ImportResourceRequest
    ),
  "query-history": async (request, container) =>
    container.orchestrator.queryHistory(
      request as unknown as QueryHistoryRequest
    ),
  "create-session-archive": async (request, container) =>
    container.orchestrator.createSessionArchive(
      request as unknown as CreateSessionArchiveRequest
    )
};

export async function dispatchRuntimeCommand(
  command: RuntimeCliCommandName,
  request: JsonRecord,
  container: ServiceContainer
): Promise<unknown> {
  const actor = request.actor as ActorContext | undefined;
  if (actor) {
    container.toolboxSessionPolicyEnforcer.authorize(command, actor);
  }
  return RUNTIME_COMMAND_HANDLERS[command](request, container);
}

export function getSupportedRuntimeDispatchCommandNames(): RuntimeCliCommandName[] {
  return Object.keys(RUNTIME_COMMAND_HANDLERS) as RuntimeCliCommandName[];
}

export function getRuntimeCommandHttpStatus(
  command: RuntimeCliCommandName,
  result: unknown
): number {
  switch (command) {
    case "execute-coding-task":
      return mapCodingStatusToStatusCode(
        (result as { status: "success" | "fail" | "escalate" }).status
      );
    case "show-tool-output":
      return (result as { found: boolean }).found ? 200 : 404;
    case "validate-note":
      return (result as { valid: boolean }).valid ? 200 : 422;
    case "list-agent-traces":
    case "list-ai-tools":
    case "check-ai-tools":
    case "tools-package-plan":
    case "list-context-tree":
    case "get-context-packet":
      return 200;
    case "search-context":
    case "search-session-archives":
    case "assemble-agent-context":
    case "read-context-node":
    case "fetch-decision-summary":
    case "draft-note":
    case "list-review-queue":
    case "read-review-note":
    case "accept-note":
    case "reject-note":
    case "create-refresh-draft":
    case "create-refresh-drafts":
    case "promote-note":
    case "import-resource":
    case "query-history":
    case "create-session-archive": {
      const serviceResult = result as { ok: boolean; error?: ServiceError };
      return serviceResult.ok ? 200 : mapServiceErrorToStatus(serviceResult.error);
    }
  }
}

function mapServiceErrorToStatus(error: ServiceError | undefined): number {
  switch (error?.code) {
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "revision_conflict":
    case "duplicate_detected":
      return 409;
    case "validation_failed":
      return 422;
    default:
      return 500;
  }
}

function mapCodingStatusToStatusCode(
  status: "success" | "fail" | "escalate"
): number {
  switch (status) {
    case "success":
      return 200;
    case "fail":
      return 422;
    case "escalate":
      return 409;
  }
}
