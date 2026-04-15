import type { RerankerProvider } from "@mimir/application";
import type { ContextCandidate } from "@mimir/contracts";
import type { QueryIntent } from "@mimir/domain";

export class HeuristicRerankerProvider implements RerankerProvider {
  readonly providerId = "heuristic-reranker";

  async rerankCandidates(input: {
    query: string;
    intent: QueryIntent;
    candidates: ContextCandidate[];
    limit: number;
  }): Promise<ContextCandidate[]> {
    return [...input.candidates]
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit);
  }
}
