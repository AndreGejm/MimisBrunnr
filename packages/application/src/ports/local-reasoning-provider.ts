import type {
  AnswerabilityDisposition,
  QueryIntent
} from "@multi-agent-brain/domain";
import type { ContextCandidate } from "@multi-agent-brain/contracts";

export interface LocalReasoningProvider {
  readonly providerId: string;
  classifyIntent(query: string): Promise<QueryIntent>;
  assessAnswerability(input: {
    query: string;
    intent: QueryIntent;
    candidates: ContextCandidate[];
  }): Promise<AnswerabilityDisposition>;
  summarizeUncertainty(query: string, evidence: string[]): Promise<string>;
}
