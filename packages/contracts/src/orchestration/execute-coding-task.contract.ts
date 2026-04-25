import type { ActorContext } from "../common/actor-context.js";
import type { ContextBudget } from "../common/context-budget.js";
import type { PaidExecutionTelemetry } from "../common/paid-execution-telemetry.js";
import type { CorpusId } from "@mimir/domain";

export type CodingTaskType =
  | "triage"
  | "review"
  | "draft_patch"
  | "generate_tests"
  | "summarize_diff"
  | "propose_fix";

export interface CodingValidationResult {
  success: boolean;
  step: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  metadata?: Record<string, unknown>;
}

export interface CodingMemoryContextRequest {
  query?: string;
  corpusIds?: CorpusId[];
  budget?: ContextBudget;
  includeSessionArchives?: boolean;
  sessionId?: string;
  includeTrace?: boolean;
}

export interface CodingMemoryContextStatus {
  requested: boolean;
  included: boolean;
  retrievalHealth?: {
    status?: string;
  };
  traceIncluded?: boolean;
  tokenEstimate?: number;
  truncated?: boolean;
  errorMessage?: string;
}

export interface ExecuteCodingTaskRequest {
  actor: ActorContext;
  taskType: CodingTaskType;
  task: string;
  context?: string;
  memoryContext?: CodingMemoryContextRequest;
  memoryContextStatus?: CodingMemoryContextStatus;
  repoRoot?: string;
  filePath?: string;
  symbolName?: string;
  diffText?: string;
  pytestTarget?: string;
  lintTarget?: string;
}

export type CodingAdvisoryRecommendedAction =
  | "retry_local"
  | "manual_followup"
  | "external_escalation";

export interface CodingAdvisoryResult {
  invoked: boolean;
  modelRole: "coding_advisory";
  providerId: string;
  modelId?: string;
  recommendedAction: CodingAdvisoryRecommendedAction;
  summary: string;
  suggestedChecks: string[];
  telemetry?: PaidExecutionTelemetry;
}

export interface ExecuteCodingTaskResponse {
  status: "success" | "fail" | "escalate";
  reason: string;
  toolUsed?: string;
  attempts: number;
  localResult?: Record<string, unknown>;
  validations?: CodingValidationResult[];
  escalationMetadata?: Record<string, unknown>;
  codingAdvisory?: CodingAdvisoryResult;
}
