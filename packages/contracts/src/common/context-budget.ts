export interface ContextBudget {
  maxTokens: number;
  maxSources: number;
  maxRawExcerpts: number;
  maxSummarySentences: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxTokens: 1200,
  maxSources: 4,
  maxRawExcerpts: 1,
  maxSummarySentences: 4
};
