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

export interface RetrieveContextRequest {
  actor: ActorContext;
  query: string;
  budget: ContextBudget;
  corpusIds: CorpusId[];
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
  trace?: RetrievalTraceRef;
}
