import type { QueryIntent } from "@mimir/domain";
import type { ContextCandidate } from "@mimir/contracts";

export interface RerankerProvider {
  readonly providerId: string;
  rerankCandidates(input: {
    query: string;
    intent: QueryIntent;
    candidates: ContextCandidate[];
    limit: number;
  }): Promise<ContextCandidate[]>;
}
