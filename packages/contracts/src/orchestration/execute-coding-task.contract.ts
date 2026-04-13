import type { ActorContext } from "../common/actor-context.js";
import type { ContextBudget } from "../common/context-budget.js";
import type { CorpusId } from "@multi-agent-brain/domain";

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

export interface ExecuteCodingTaskRequest {
  actor: ActorContext;
  taskType: CodingTaskType;
  task: string;
  context?: string;
  memoryContext?: CodingMemoryContextRequest;
  repoRoot?: string;
  filePath?: string;
  symbolName?: string;
  diffText?: string;
  pytestTarget?: string;
  lintTarget?: string;
}

export interface ExecuteCodingTaskResponse {
  status: "success" | "fail" | "escalate";
  reason: string;
  toolUsed?: string;
  attempts: number;
  localResult?: Record<string, unknown>;
  validations?: CodingValidationResult[];
  escalationMetadata?: Record<string, unknown>;
}
