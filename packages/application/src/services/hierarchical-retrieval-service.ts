import { AuditHistoryService } from "./audit-history-service.js";
import {
  DEFAULT_CONTEXT_BUDGET,
  type AssembleContextPacketRequest,
  type ContextCandidate,
  type PaidExecutionTelemetry,
  type RetrievalHealthReport,
  type RetrieveContextRequest,
  type RetrieveContextResponse,
  type ServiceResult
} from "@mimir/contracts";
import type { QueryIntent } from "@mimir/domain";
import type { EmbeddingProvider } from "../ports/embedding-provider.js";
import type { LexicalIndex } from "../ports/lexical-index.js";
import type { LocalReasoningProvider } from "../ports/local-reasoning-provider.js";
import type { MetadataControlStore } from "../ports/metadata-control-store.js";
import type { RerankerProvider } from "../ports/reranker-provider.js";
import type { VectorIndex } from "../ports/vector-index.js";
import { ContextPacketService } from "./context-packet-service.js";
import { LexicalRetrievalService } from "./lexical-retrieval-service.js";
import { QueryIntentService } from "./query-intent-service.js";
import { RankingFusionService } from "./ranking-fusion-service.js";
import {
  buildRetrieveContextCacheKey,
  type RetrieveContextCache
} from "./retrieve-context-cache.js";
import { RetrievalTraceService } from "./retrieval-trace-service.js";
import { VectorRetrievalService } from "./vector-retrieval-service.js";
import { buildPaidExecutionAuditDetail } from "./paid-execution-audit-helper.js";

type RetrieveContextErrorCode = "retrieval_failed";

export class HierarchicalRetrievalService {
  private readonly queryIntentService: QueryIntentService;
  private readonly lexicalRetrievalService: LexicalRetrievalService;
  private readonly vectorRetrievalService: VectorRetrievalService;
  private readonly rankingFusionService: RankingFusionService;
  private readonly contextPacketService: ContextPacketService;
  private readonly retrievalTraceService: RetrievalTraceService;

  constructor(input: {
    lexicalIndex: LexicalIndex;
    metadataControlStore: MetadataControlStore;
    vectorIndex: VectorIndex;
    embeddingProvider?: EmbeddingProvider;
    localReasoningProvider?: LocalReasoningProvider;
    paidEscalationProvider?: LocalReasoningProvider;
    rerankerProvider?: RerankerProvider;
    auditHistoryService?: AuditHistoryService;
    retrieveContextCache?: RetrieveContextCache;
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
    this.retrievalTraceService = new RetrievalTraceService();
    this.auditHistoryService = input.auditHistoryService;
    this.rerankerProvider = input.rerankerProvider;
    this.paidEscalationProvider = input.paidEscalationProvider;
    this.vectorIndex = input.vectorIndex;
    this.retrieveContextCache = input.retrieveContextCache;
  }

  private readonly auditHistoryService?: AuditHistoryService;
  private readonly paidEscalationProvider?: LocalReasoningProvider;
  private readonly rerankerProvider?: RerankerProvider;
  private readonly vectorIndex: VectorIndex;
  private readonly retrieveContextCache?: RetrieveContextCache;

  async retrieveContext(
    request: RetrieveContextRequest
  ): Promise<ServiceResult<RetrieveContextResponse, RetrieveContextErrorCode>> {
    try {
      const cacheKey = buildRetrieveContextCacheKey(request, "hierarchical");
      const cached = await this.readCachedResponse(request, cacheKey);
      if (cached) {
        return cached;
      }

      const budget = request.budget ?? DEFAULT_CONTEXT_BUDGET;
      const intent = await this.queryIntentService.classifyIntent(
        request.query,
        request.intentHint
      );
      const noteTypePriority =
        request.noteTypePriority ?? this.rankingFusionService.getNoteTypePriority(intent);
      const stageOneLimit = request.tagFilters?.length
        ? Math.max(40, budget.maxSources * 20)
        : Math.max(20, budget.maxSources * 10);

      const [lexicalCandidates, vectorCandidates] = await Promise.all([
        this.lexicalRetrievalService.search(request, noteTypePriority, stageOneLimit),
        this.vectorRetrievalService.search(request, noteTypePriority, stageOneLimit)
      ]);

      const fusedCandidates = this.rankingFusionService.rankCandidates({
        intent,
        lexicalCandidates,
        vectorCandidates,
        noteTypePriority,
        finalLimit: Math.max(8, budget.maxSources * 3),
        tagFilters: request.tagFilters
      });
      const rankedCandidates = await this.rerankCandidates(
        request.query,
        intent,
        fusedCandidates,
        Math.max(6, budget.maxSources * 2)
      );
      const hierarchicalCandidates = selectHierarchicalCandidates(
        rankedCandidates,
        Math.max(1, budget.maxSources)
      );

      const answerability = await this.queryIntentService.assessAnswerability(
        request.query,
        intent,
        hierarchicalCandidates
      );

      const packetResponse = await this.contextPacketService.assemblePacket(
        {
          actor: request.actor,
          intent,
          budget,
          candidates: hierarchicalCandidates,
          includeRawExcerpts: request.requireEvidence ?? false
        } satisfies AssembleContextPacketRequest,
        answerability
      );
      const packet = packetResponse.packet;
      const warnings: string[] = [];
      const selectedCandidates = selectDeliveredCandidates(
        hierarchicalCandidates,
        packet.evidence
      );
      const vectorHealth = this.vectorIndex.getHealthSnapshot?.();
      if (vectorHealth?.status === "degraded") {
        warnings.push("Vector retrieval is degraded; lexical retrieval remains active.");
      }
      warnings.push(...buildFreshnessWarnings(selectedCandidates));
      const escalation = await this.summarizeEscalationUncertainty(
        request.query,
        answerability,
        hierarchicalCandidates
      );
      if (escalation.summary) {
        packet.uncertainties = mergeUncertainties(
          packet.uncertainties,
          escalation.summary
        );
        warnings.push("Paid escalation provider enriched the uncertainty summary.");
      } else if (answerability === "needs_escalation" && !this.paidEscalationProvider) {
        warnings.push("No paid escalation provider is configured for follow-up reasoning.");
      }

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
          paidEscalation: {
            configured: Boolean(this.paidEscalationProvider),
            used: Boolean(escalation.summary),
            telemetry: buildPaidExecutionAuditDetail(escalation.telemetry)
          },
          vectorHealth,
          freshness: summarizeFreshness(selectedCandidates),
          budget,
          candidateCounts: {
            lexical: lexicalCandidates.length,
            vector: vectorCandidates.length,
            reranked: hierarchicalCandidates.length
          }
        }
      });

      const trace = request.includeTrace
        ? this.retrievalTraceService.buildTrace(
            {
              intent,
              lexicalCount: lexicalCandidates.length,
              vectorCount: vectorCandidates.length,
              fusedCount: fusedCandidates.length,
              rerankedCount: hierarchicalCandidates.length,
              deliveredCount: packet.evidence.length,
              packetEvidence: packet.evidence
            },
            "hierarchical"
          )
        : undefined;
      const responseWarnings = collectWarnings(
        warnings,
        auditResult && !auditResult.ok ? [auditResult.error.message] : []
      );
      const retrievalHealth = buildRetrievalHealthReport({
        lexicalCandidates: lexicalCandidates.length,
        vectorCandidates: vectorCandidates.length,
        rerankedCandidates: hierarchicalCandidates.length,
        deliveredCandidates: packet.evidence.length,
        vectorHealthStatus: vectorHealth?.status,
        warnings: responseWarnings ?? []
      });

      const data: RetrieveContextResponse = {
        packet,
        candidateCounts: {
          lexical: lexicalCandidates.length,
          vector: vectorCandidates.length,
          reranked: hierarchicalCandidates.length,
          delivered: packet.evidence.length
        },
        provenance: packet.evidence,
        retrievalHealth,
        trace
      };
      this.retrieveContextCache?.set(cacheKey, {
        data,
        warnings: responseWarnings
      });

      return {
        ok: true,
        data,
        warnings: responseWarnings
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

  private async readCachedResponse(
    request: RetrieveContextRequest,
    cacheKey: string
  ): Promise<ServiceResult<RetrieveContextResponse, RetrieveContextErrorCode> | undefined> {
    const cached = this.retrieveContextCache?.get(cacheKey);
    if (!cached) {
      return undefined;
    }

    const data = structuredClone(cached.data);
    const auditResult = await this.auditHistoryService?.recordAction({
      actionType: "retrieve_context",
      actorId: request.actor.actorId,
      actorRole: request.actor.actorRole,
      source: request.actor.source,
      toolName: request.actor.toolName,
      occurredAt: new Date().toISOString(),
      outcome: data.packet.answerability === "local_answer" ? "accepted" : "partial",
      affectedNoteIds: data.packet.evidence.map((source) => source.noteId),
      affectedChunkIds: data.packet.evidence.flatMap((source) => (source.chunkId ? [source.chunkId] : [])),
      detail: {
        query: request.query,
        answerability: data.packet.answerability,
        budget: request.budget ?? DEFAULT_CONTEXT_BUDGET,
        cacheHit: true,
        candidateCounts: data.candidateCounts
      }
    });
    const responseWarnings = collectWarnings(
      cached.warnings ?? data.retrievalHealth?.warnings ?? [],
      auditResult && !auditResult.ok ? [auditResult.error.message] : []
    );
    if (data.retrievalHealth) {
      data.retrievalHealth = {
        ...data.retrievalHealth,
        warnings: responseWarnings ?? []
      };
    }

    return {
      ok: true,
      data,
      warnings: responseWarnings
    };
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

  private async summarizeEscalationUncertainty(
    query: string,
    answerability: RetrieveContextResponse["packet"]["answerability"],
    candidates: ContextCandidate[]
  ): Promise<{
    summary?: string;
    telemetry?: PaidExecutionTelemetry;
  }> {
    if (answerability === "local_answer") {
      return {};
    }

    if (!this.paidEscalationProvider) {
      return {
        telemetry: {
          providerId: "disabled",
          timeoutMs: 0,
          outcomeClass: "disabled",
          fallbackApplied: false,
          retryCount: 0,
          errorCode: "no_paid_provider_configured"
        }
      };
    }

    const evidence = candidates.slice(0, 4).map((candidate) =>
      `${candidate.noteType} (${candidate.stalenessClass}, ${candidate.score.toFixed(2)}): ${candidate.summary}`
    );

    try {
      const summary = await this.paidEscalationProvider.summarizeUncertainty(query, evidence);
      return {
        summary,
        telemetry: this.paidEscalationProvider.consumePaidExecutionTelemetry?.()
      };
    } catch {
      return {
        telemetry: this.paidEscalationProvider.consumePaidExecutionTelemetry?.()
      };
    }
  }
}

function selectHierarchicalCandidates(
  candidates: readonly ContextCandidate[],
  limit: number
): ContextCandidate[] {
  const buckets = new Map<string, ContextCandidate[]>();
  const scopeOrder: string[] = [];

  for (const candidate of candidates) {
    const scope = candidate.scope.trim() || "unspecified";
    const bucket = buckets.get(scope);
    if (bucket) {
      bucket.push(candidate);
    } else {
      buckets.set(scope, [candidate]);
      scopeOrder.push(scope);
    }
  }

  const selected: ContextCandidate[] = [];
  let progress = true;
  while (selected.length < limit && progress) {
    progress = false;
    for (const scope of scopeOrder) {
      const bucket = buckets.get(scope);
      if (!bucket || bucket.length === 0 || selected.length >= limit) {
        continue;
      }

      selected.push(bucket.shift() as ContextCandidate);
      progress = true;
    }
  }

  return selected.slice(0, limit);
}

function collectWarnings(...groups: Array<ReadonlyArray<string>>): string[] | undefined {
  const warnings = [...new Set(groups.flat().map((warning) => warning.trim()).filter(Boolean))];
  return warnings.length > 0 ? warnings : undefined;
}

function buildRetrievalHealthReport(input: {
  lexicalCandidates: number;
  vectorCandidates: number;
  rerankedCandidates: number;
  deliveredCandidates: number;
  vectorHealthStatus?: string;
  warnings: string[];
}): RetrievalHealthReport {
  const vectorDegraded =
    input.vectorHealthStatus === "degraded" || input.vectorCandidates === 0;
  const status = input.deliveredCandidates === 0
    ? "unhealthy"
    : vectorDegraded
      ? "degraded"
      : "healthy";

  return {
    status,
    lexicalCandidates: input.lexicalCandidates,
    vectorCandidates: input.vectorCandidates,
    rerankedCandidates: input.rerankedCandidates,
    deliveredCandidates: input.deliveredCandidates,
    warnings: input.warnings
  };
}

function mergeUncertainties(existing: string[], summary: string): string[] {
  return [...new Set([...existing, summary].map((value) => value.trim()).filter(Boolean))];
}

function selectDeliveredCandidates(
  candidates: readonly ContextCandidate[],
  evidence: RetrieveContextResponse["packet"]["evidence"]
): ContextCandidate[] {
  const evidenceChunkIds = new Set(
    evidence.map((item) => item.chunkId).filter(Boolean)
  );
  const evidenceNoteIds = new Set(evidence.map((item) => item.noteId));

  return candidates.filter((candidate) => {
    if (
      candidate.provenance.chunkId &&
      evidenceChunkIds.has(candidate.provenance.chunkId)
    ) {
      return true;
    }

    return evidenceNoteIds.has(candidate.provenance.noteId);
  });
}

function buildFreshnessWarnings(candidates: readonly ContextCandidate[]): string[] {
  const today = currentDateIso();
  const expiringSoonWindowEnd = addDaysIso(today, 14);
  const expired = [...new Set(
    candidates
      .filter((candidate) => Boolean(candidate.validUntil && candidate.validUntil < today))
      .map((candidate) => candidate.provenance.noteId)
  )];
  const futureDated = [...new Set(
    candidates
      .filter((candidate) => Boolean(candidate.validFrom && candidate.validFrom > today))
      .map((candidate) => candidate.provenance.noteId)
  )];
  const expiringSoon = [...new Set(
    candidates
      .filter((candidate) =>
        Boolean(
          candidate.validUntil &&
          candidate.validUntil >= today &&
          candidate.validUntil <= expiringSoonWindowEnd
        )
      )
      .map((candidate) => candidate.provenance.noteId)
  )];

  const warnings: string[] = [];
  if (expired.length > 0) {
    warnings.push(
      `Retrieved evidence includes ${expired.length} expired note(s): ${expired.join(", ")}.`
    );
  }

  if (futureDated.length > 0) {
    warnings.push(
      `Retrieved evidence includes ${futureDated.length} not-yet-valid note(s): ${futureDated.join(", ")}.`
    );
  }

  if (expiringSoon.length > 0) {
    warnings.push(
      `Retrieved evidence includes ${expiringSoon.length} note(s) expiring within 14 days: ${expiringSoon.join(", ")}.`
    );
  }

  return warnings;
}

function summarizeFreshness(candidates: readonly ContextCandidate[]): {
  expiredNoteIds: string[];
  futureDatedNoteIds: string[];
  expiringSoonNoteIds: string[];
} {
  const today = currentDateIso();
  const expiringSoonWindowEnd = addDaysIso(today, 14);
  return {
    expiredNoteIds: [...new Set(
      candidates
        .filter((candidate) => Boolean(candidate.validUntil && candidate.validUntil < today))
        .map((candidate) => candidate.provenance.noteId)
    )],
    futureDatedNoteIds: [...new Set(
      candidates
        .filter((candidate) => Boolean(candidate.validFrom && candidate.validFrom > today))
        .map((candidate) => candidate.provenance.noteId)
    )],
    expiringSoonNoteIds: [...new Set(
      candidates
        .filter((candidate) =>
          Boolean(
            candidate.validUntil &&
            candidate.validUntil >= today &&
            candidate.validUntil <= expiringSoonWindowEnd
          )
        )
        .map((candidate) => candidate.provenance.noteId)
    )]
  };
}

function currentDateIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
