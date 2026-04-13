import type { CorpusId } from "@multi-agent-brain/domain";
import type { ActorContext } from "../common/actor-context.js";
import type { ContextBudget } from "../common/context-budget.js";
import type { RetrievalTraceRef } from "../common/retrieval-trace-ref.js";
import type { RetrievalHealthReport } from "./retrieve-context.contract.js";

export interface AssembleAgentContextRequest {
  actor: ActorContext;
  query: string;
  budget: ContextBudget;
  corpusIds: CorpusId[];
  includeTrace?: boolean;
  includeSessionArchives?: boolean;
  sessionId?: string;
  sessionLimit?: number;
  sessionMaxTokens?: number;
}

export interface AgentContextSourceSummary {
  source: "canonical_memory" | "session_archive";
  authority: "canonical" | "non_authoritative";
  count: number;
}

export interface AssembleAgentContextResponse {
  contextBlock: string;
  tokenEstimate: number;
  truncated: boolean;
  sourceSummary: AgentContextSourceSummary[];
  retrievalHealth?: RetrievalHealthReport;
  trace?: RetrievalTraceRef;
}
