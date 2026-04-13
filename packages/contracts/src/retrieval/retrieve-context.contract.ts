import type {
  ContextPacket,
  ControlledTag,
  CorpusId,
  NoteType,
  QueryIntent
} from "@multi-agent-brain/domain";
import type { ActorContext } from "../common/actor-context.js";
import type { ContextBudget } from "../common/context-budget.js";
import type { ProvenanceRef } from "../common/provenance-ref.js";
import type { RetrievalTraceRef } from "../common/retrieval-trace-ref.js";

export type RetrieveContextStrategy = "flat" | "hierarchical";

export type RetrievalHealthStatus = "healthy" | "degraded" | "unhealthy";

export interface RetrievalHealthReport {
  status: RetrievalHealthStatus;
  lexicalCandidates: number;
  vectorCandidates: number;
  rerankedCandidates: number;
  deliveredCandidates: number;
  warnings: string[];
}

export interface RetrieveContextRequest {
  actor: ActorContext;
  query: string;
  budget: ContextBudget;
  corpusIds: CorpusId[];
  strategy?: RetrieveContextStrategy;
  intentHint?: QueryIntent;
  noteTypePriority?: NoteType[];
  tagFilters?: ControlledTag[];
  includeSuperseded?: boolean;
  requireEvidence?: boolean;
  includeTrace?: boolean;
}

export interface RetrieveContextResponse {
  packet: ContextPacket;
  candidateCounts: {
    lexical: number;
    vector: number;
    reranked: number;
    delivered: number;
  };
  provenance: ProvenanceRef[];
  retrievalHealth?: RetrievalHealthReport;
  trace?: RetrievalTraceRef;
}
