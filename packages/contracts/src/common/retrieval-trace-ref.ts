import type {
  RetrievalTraceCandidateCounts,
  RetrievalTraceEvent,
  RetrievalTracePacketDiff,
  RetrievalTraceStrategy
} from "@mimir/domain";

export interface RetrievalTraceRef {
  strategy: RetrievalTraceStrategy;
  events: RetrievalTraceEvent[];
  candidateCounts: RetrievalTraceCandidateCounts;
  packetDiff: RetrievalTracePacketDiff;
}
