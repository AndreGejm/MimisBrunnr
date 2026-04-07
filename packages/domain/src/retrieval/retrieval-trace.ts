export type RetrievalTraceStrategy = "flat" | "hierarchical";

export type RetrievalTraceStage =
  | "intent"
  | "lexical"
  | "vector"
  | "fusion"
  | "rerank"
  | "packet";

export interface RetrievalTraceEvent {
  stage: RetrievalTraceStage;
  message: string;
  data?: Record<string, unknown>;
}

export interface RetrievalTraceCandidateCounts {
  lexical: number;
  vector: number;
  reranked: number;
  delivered: number;
}

export interface RetrievalTracePacketDiff {
  deliveredEvidenceCount: number;
  expandedEvidenceCount: number;
  droppedCandidateCount: number;
  selectedEvidenceNoteIds: string[];
}

export interface RetrievalTrace {
  strategy: RetrievalTraceStrategy;
  events: RetrievalTraceEvent[];
  candidateCounts: RetrievalTraceCandidateCounts;
  packetDiff: RetrievalTracePacketDiff;
}
