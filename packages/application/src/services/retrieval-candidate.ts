import type {
  ChunkRecord,
  PacketType,
  QueryIntent
} from "@mimir/domain";
import type { ContextCandidate } from "@mimir/contracts";

export interface ScoredChunkCandidate extends ContextCandidate {
  chunk: ChunkRecord;
  lexicalScore?: number;
  vectorScore?: number;
  fusedScore: number;
}

export function packetTypeForIntent(intent: QueryIntent): PacketType {
  switch (intent) {
    case "decision_lookup":
      return "decision";
    case "implementation_guidance":
    case "debugging":
    case "architecture_recall":
      return "implementation";
    case "status_timeline":
      return "timeline_status";
    case "fact_lookup":
    default:
      return "direct_answer";
  }
}
