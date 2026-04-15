import { AuditHistoryService } from "./audit-history-service.js";
import { RetrieveContextService } from "./retrieve-context-service.js";
import type {
  GetDecisionSummaryRequest,
  GetDecisionSummaryResponse,
  ServiceResult
} from "@mimir/contracts";

type DecisionSummaryErrorCode = "summary_failed";

export class DecisionSummaryService {
  constructor(
    private readonly retrieveContextService: RetrieveContextService,
    private readonly auditHistoryService?: AuditHistoryService
  ) {}

  async getDecisionSummary(
    request: GetDecisionSummaryRequest
  ): Promise<ServiceResult<GetDecisionSummaryResponse, DecisionSummaryErrorCode>> {
    const retrieval = await this.retrieveContextService.retrieveContext({
      actor: request.actor,
      query: request.topic,
      budget: request.budget,
      corpusIds: ["mimisbrunnr"],
      intentHint: "decision_lookup",
      noteTypePriority: ["decision", "constraint", "architecture", "reference", "policy"],
      includeSuperseded: false,
      requireEvidence: true
    });

    if (!retrieval.ok) {
      await this.auditHistoryService?.recordAction({
        actionType: "fetch_decision_summary",
        actorId: request.actor.actorId,
        actorRole: request.actor.actorRole,
        source: request.actor.source,
        toolName: request.actor.toolName,
        occurredAt: new Date().toISOString(),
        outcome: "rejected",
        affectedNoteIds: [],
        affectedChunkIds: [],
        detail: {
          topic: request.topic,
          reason: retrieval.error.message
        }
      });

      return {
        ok: false,
        error: {
          code: "summary_failed",
          message: "Failed to produce a decision summary.",
          details: retrieval.error.details
        }
      };
    }

    await this.auditHistoryService?.recordAction({
      actionType: "fetch_decision_summary",
      actorId: request.actor.actorId,
      actorRole: request.actor.actorRole,
      source: request.actor.source,
      toolName: request.actor.toolName,
      occurredAt: new Date().toISOString(),
      outcome: "accepted",
      affectedNoteIds: retrieval.data.packet.evidence.map((source) => source.noteId),
      affectedChunkIds: retrieval.data.packet.evidence
        .flatMap((source) => (source.chunkId ? [source.chunkId] : [])),
      detail: {
        topic: request.topic,
        candidateCounts: retrieval.data.candidateCounts
      }
    });

    return {
      ok: true,
      data: {
        decisionPacket: retrieval.data.packet
      }
    };
  }
}
