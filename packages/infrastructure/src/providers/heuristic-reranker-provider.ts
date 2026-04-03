import type { RerankerProvider } from "@multi-agent-brain/application";
import type { ContextCandidate } from "@multi-agent-brain/contracts";
import type { QueryIntent } from "@multi-agent-brain/domain";

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
