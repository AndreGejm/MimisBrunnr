import type { EmbeddingProvider } from "../ports/embedding-provider.js";
import type { LexicalIndex } from "../ports/lexical-index.js";
import type { LocalReasoningProvider } from "../ports/local-reasoning-provider.js";
import type { MetadataControlStore } from "../ports/metadata-control-store.js";
import type { VectorIndex } from "../ports/vector-index.js";
import {
  DEFAULT_CONTEXT_BUDGET,
  type AssembleContextPacketRequest,
  type RetrieveContextRequest,
  type RetrieveContextResponse,
  type ServiceResult
} from "@multi-agent-brain/contracts";
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
  }

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

      const rankedCandidates = this.rankingFusionService.rankCandidates({
        intent,
        lexicalCandidates,
        vectorCandidates,
        noteTypePriority,
        finalLimit: Math.max(6, budget.maxSources * 2)
      });

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

      return {
        ok: true,
        data: {
          packet: packetResponse.packet,
          candidateCounts: {
            lexical: lexicalCandidates.length,
            vector: vectorCandidates.length,
            reranked: rankedCandidates.length,
            delivered: packetResponse.packet.evidence.length
          },
          provenance: packetResponse.packet.evidence
        }
      };
    } catch (error) {
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
}
