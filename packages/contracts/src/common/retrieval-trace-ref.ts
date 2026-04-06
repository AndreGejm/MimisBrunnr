import type {
  RetrievalTraceCandidateCounts,
  RetrievalTraceEvent,
  RetrievalTracePacketDiff,
  RetrievalTraceStrategy
} from "@multi-agent-brain/domain";

export interface RetrievalTraceRef {
  strategy: RetrievalTraceStrategy;
  events: RetrievalTraceEvent[];
  candidateCounts: RetrievalTraceCandidateCounts;
  packetDiff: RetrievalTracePacketDiff;
}
