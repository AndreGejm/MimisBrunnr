import type { EmbeddingProvider } from "../ports/embedding-provider.js";
import type { LexicalIndex } from "../ports/lexical-index.js";
import type { LocalReasoningProvider } from "../ports/local-reasoning-provider.js";
import type { MetadataControlStore } from "../ports/metadata-control-store.js";
import type { RerankerProvider } from "../ports/reranker-provider.js";
import type { VectorIndex } from "../ports/vector-index.js";
import { AuditHistoryService } from "./audit-history-service.js";
import {
  DEFAULT_CONTEXT_BUDGET,
  type ContextCandidate,
  type AssembleContextPacketRequest,
  type RetrieveContextRequest,
  type RetrieveContextResponse,
  type ServiceResult
} from "@multi-agent-brain/contracts";
import type { QueryIntent } from "@multi-agent-brain/domain";
import { ContextPacketService } from "./context-packet-service.js";
import { LexicalRetrievalService } from "./lexical-retrieval-service.js";
import { QueryIntentService } from "./query-intent-service.js";
import { RankingFusionService } from "./ranking-fusion-service.js";
import { VectorRetrievalService } from "./vector-retrieval-service.js";

type RetrieveContextErrorCode = "retrieval_failed";

export class RetrieveContextService {
  private readonly queryIntentService: QueryIntentService;
  private readonly lexicalRetrievalService: LexicalRetrievalService;
  private readonly vectorRetrievalService: VectorRetrievalService;
  private readonly rankingFusionService: RankingFusionService;
  private readonly contextPacketService: ContextPacketService;

  constructor(input: {
    lexicalIndex: LexicalIndex;
    metadataControlStore: MetadataControlStore;
    vectorIndex: VectorIndex;
    embeddingProvider?: EmbeddingProvider;
    localReasoningProvider?: LocalReasoningProvider;
    rerankerProvider?: RerankerProvider;
    auditHistoryService?: AuditHistoryService;
  }) {
    this.queryIntentService = new QueryIntentService(input.localReasoningProvider);
    this.lexicalRetrievalService = new LexicalRetrievalService(
      input.lexicalIndex,
      input.metadataControlStore
    );
    this.vectorRetrievalService = new VectorRetrievalService(
      input.vectorIndex,
      input.metadataControlStore,
      input.embeddingProvider
    );
    this.rankingFusionService = new RankingFusionService();
    this.contextPacketService = new ContextPacketService(input.metadataControlStore);
    this.auditHistoryService = input.auditHistoryService;
    this.rerankerProvider = input.rerankerProvider;
  }

  private readonly auditHistoryService?: AuditHistoryService;
  private readonly rerankerProvider?: RerankerProvider;

  async retrieveContext(
    request: RetrieveContextRequest
  ): Promise<ServiceResult<RetrieveContextResponse, RetrieveContextErrorCode>> {
    try {
      const budget = request.budget ?? DEFAULT_CONTEXT_BUDGET;
      const intent = await this.queryIntentService.classifyIntent(
        request.query,
        request.intentHint
      );
      const noteTypePriority =
        request.noteTypePriority ?? this.rankingFusionService.getNoteTypePriority(intent);
      const stageOneLimit = Math.max(20, budget.maxSources * 10);

      const [lexicalCandidates, vectorCandidates] = await Promise.all([
        this.lexicalRetrievalService.search(request, noteTypePriority, stageOneLimit),
        this.vectorRetrievalService.search(request, noteTypePriority, stageOneLimit)
      ]);

      const fusedCandidates = this.rankingFusionService.rankCandidates({
        intent,
        lexicalCandidates,
        vectorCandidates,
        noteTypePriority,
        finalLimit: Math.max(8, budget.maxSources * 3)
      });
      const rankedCandidates = await this.rerankCandidates(
        request.query,
        intent,
        fusedCandidates,
        Math.max(6, budget.maxSources * 2)
      );

      const answerability = await this.queryIntentService.assessAnswerability(
        request.query,
        intent,
        rankedCandidates
      );

      const packetResponse = await this.contextPacketService.assemblePacket(
        {
          actor: request.actor,
          intent,
          budget,
          candidates: rankedCandidates,
          includeRawExcerpts: request.requireEvidence ?? false
        } satisfies AssembleContextPacketRequest,
        answerability
      );
      const packet = packetResponse.packet;

      const auditResult = await this.auditHistoryService?.recordAction({
        actionType: "retrieve_context",
        actorId: request.actor.actorId,
        actorRole: request.actor.actorRole,
        source: request.actor.source,
        toolName: request.actor.toolName,
        occurredAt: new Date().toISOString(),
        outcome: answerability === "local_answer" ? "accepted" : "partial",
        affectedNoteIds: packet.evidence.map((source) => source.noteId),
        affectedChunkIds: packet.evidence.flatMap((source) => (source.chunkId ? [source.chunkId] : [])),
        detail: {
          query: request.query,
          intent,
          answerability,
          budget,
          candidateCounts: {
            lexical: lexicalCandidates.length,
            vector: vectorCandidates.length,
            reranked: rankedCandidates.length
          }
        }
      });

      return {
        ok: true,
        data: {
          packet,
          candidateCounts: {
            lexical: lexicalCandidates.length,
            vector: vectorCandidates.length,
            reranked: rankedCandidates.length,
            delivered: packet.evidence.length
          },
          provenance: packet.evidence
        },
        warnings: auditResult && !auditResult.ok ? [auditResult.error.message] : undefined
      };
    } catch (error) {
      await this.auditHistoryService?.recordAction({
        actionType: "retrieve_context",
        actorId: request.actor.actorId,
        actorRole: request.actor.actorRole,
        source: request.actor.source,
        toolName: request.actor.toolName,
        occurredAt: new Date().toISOString(),
        outcome: "rejected",
        affectedNoteIds: [],
        affectedChunkIds: [],
        detail: {
          query: request.query,
          reason: error instanceof Error ? error.message : String(error)
        }
      });
      return {
        ok: false,
        error: {
          code: "retrieval_failed",
          message: "Failed to retrieve bounded local context.",
          details: {
            reason: error instanceof Error ? error.message : String(error)
          }
        }
      };
    }
  }

  private async rerankCandidates(
    query: string,
    intent: QueryIntent,
    candidates: ContextCandidate[],
    limit: number
  ): Promise<ContextCandidate[]> {
    if (!this.rerankerProvider || candidates.length <= limit) {
      return candidates.slice(0, limit);
    }

    try {
      return await this.rerankerProvider.rerankCandidates({
        query,
        intent,
        candidates,
        limit
      });
    } catch {
      return candidates.slice(0, limit);
    }
  }
}
