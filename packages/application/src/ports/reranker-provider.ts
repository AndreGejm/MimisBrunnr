import type { QueryIntent } from "@multi-agent-brain/domain";
import type { ContextCandidate } from "@multi-agent-brain/contracts";

export interface RerankerProvider {
  readonly providerId: string;
  rerankCandidates(input: {
    query: string;
    intent: QueryIntent;
    candidates: ContextCandidate[];
    limit: number;
  }): Promise<ContextCandidate[]>;
}
