import type { RetrievalTraceRef } from "@multi-agent-brain/contracts";
import type { ContextPacketSource, QueryIntent } from "@multi-agent-brain/domain";

export interface BuildRetrievalTraceInput {
  intent: QueryIntent;
  lexicalCount: number;
  vectorCount: number;
  fusedCount: number;
  rerankedCount: number;
  deliveredCount: number;
  packetEvidence: readonly ContextPacketSource[];
}

export class RetrievalTraceService {
  buildFlatTrace(input: BuildRetrievalTraceInput): RetrievalTraceRef {
    const selectedEvidenceNoteIds = uniqueStrings(
      input.packetEvidence.map((candidate) => candidate.noteId)
    ).slice(0, 8);

    return {
      strategy: "flat",
      events: [
        {
          stage: "intent",
          message: `Classified query as ${input.intent}.`,
          data: { intent: input.intent }
        },
        {
          stage: "lexical",
          message: `Lexical retrieval produced ${input.lexicalCount} candidate(s).`,
          data: { lexicalCount: input.lexicalCount }
        },
        {
          stage: "vector",
          message: `Vector retrieval produced ${input.vectorCount} candidate(s).`,
          data: { vectorCount: input.vectorCount }
        },
        {
          stage: "fusion",
          message: `Fusion retained ${input.fusedCount} candidate(s).`,
          data: {
            lexicalCount: input.lexicalCount,
            vectorCount: input.vectorCount,
            fusedCount: input.fusedCount
          }
        },
        {
          stage: "rerank",
          message: `Reranking returned ${input.rerankedCount} candidate(s).`,
          data: { rerankedCount: input.rerankedCount }
        },
        {
          stage: "packet",
          message: `Packet delivered ${input.deliveredCount} evidence item(s).`,
          data: {
            deliveredCount: input.deliveredCount,
            selectedEvidenceNoteIds
          }
        }
      ],
      candidateCounts: {
        lexical: input.lexicalCount,
        vector: input.vectorCount,
        reranked: input.rerankedCount,
        delivered: input.deliveredCount
      },
      packetDiff: {
        deliveredEvidenceCount: input.deliveredCount,
        expandedEvidenceCount: Math.max(0, input.deliveredCount - input.rerankedCount),
        droppedCandidateCount: Math.max(0, input.rerankedCount - input.deliveredCount),
        selectedEvidenceNoteIds
      }
    };
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
