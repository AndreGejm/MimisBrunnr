import type {
  AnswerabilityDisposition,
  QueryIntent
} from "@mimir/domain";
import type {
  ContextCandidate,
  PaidExecutionTelemetry
} from "@mimir/contracts";

export interface LocalReasoningProvider {
  readonly providerId: string;
  classifyIntent(query: string): Promise<QueryIntent>;
  assessAnswerability(input: {
    query: string;
    intent: QueryIntent;
    candidates: ContextCandidate[];
  }): Promise<AnswerabilityDisposition>;
  summarizeUncertainty(query: string, evidence: string[]): Promise<string>;
  consumePaidExecutionTelemetry?(): PaidExecutionTelemetry | undefined;
}
