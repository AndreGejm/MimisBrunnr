import type { ActorContext } from "../common/actor-context.js";

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

export interface ExecuteCodingTaskRequest {
  actor: ActorContext;
  taskType: CodingTaskType;
  task: string;
  context?: string;
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
