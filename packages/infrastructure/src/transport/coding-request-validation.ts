import {
  optionalBoolean,
  optionalEnumArray,
  optionalString,
  requireEnum,
  requireInteger,
  requireObject,
  requireString,
  type JsonRecord
} from "./request-field-validation.js";

const CORPORA = new Set(["mimisbrunnr", "general_notes"]);
const CORPUS_ALIASES = new Map<string, string>([
  ["brain", "mimisbrunnr"],
  ["context_brain", "mimisbrunnr"],
  ["mimir_brunnr", "mimisbrunnr"],
  ["mimir-brunnr", "mimisbrunnr"],
  ["mimirbrunnr", "mimisbrunnr"],
  ["mimirsbrunn", "mimisbrunnr"],
  ["mimirsbrunnr", "mimisbrunnr"],
  ["mimis", "mimisbrunnr"],
  ["mimisbrunn", "mimisbrunnr"],
  ["multi agent brain", "mimisbrunnr"],
  ["multi-agent-brain", "mimisbrunnr"],
  ["multiagentbrain", "mimisbrunnr"]
]);
const CONTEXT_ALIAS_OPTIONS = { aliases: CORPUS_ALIASES };
const CODING_TASK_TYPES = new Set([
  "triage",
  "review",
  "draft_patch",
  "generate_tests",
  "summarize_diff",
  "propose_fix"
]);

export function validateExecuteCodingTaskRequest(
  payload: JsonRecord,
  actor: JsonRecord | undefined
): JsonRecord {
  return {
    actor,
    taskType: requireEnum(payload.taskType, "taskType", CODING_TASK_TYPES),
    task: requireString(payload.task, "task"),
    context: optionalString(payload.context, "context"),
    memoryContext: validateCodingMemoryContext(payload.memoryContext, "memoryContext"),
    repoRoot: optionalString(payload.repoRoot, "repoRoot"),
    filePath: optionalString(payload.filePath, "filePath"),
    symbolName: optionalString(payload.symbolName, "symbolName"),
    diffText: optionalString(payload.diffText, "diffText"),
    pytestTarget: optionalString(payload.pytestTarget, "pytestTarget"),
    lintTarget: optionalString(payload.lintTarget, "lintTarget")
  };
}

export function validateListAgentTracesRequest(
  payload: JsonRecord,
  actor: JsonRecord | undefined
): JsonRecord {
  return {
    actor,
    requestId: requireString(payload.requestId, "requestId")
  };
}

export function validateShowToolOutputRequest(
  payload: JsonRecord,
  actor: JsonRecord | undefined
): JsonRecord {
  return {
    actor,
    outputId: requireString(payload.outputId, "outputId")
  };
}

function validateCodingMemoryContext(value: unknown, field: string): JsonRecord | undefined {
  if (value === undefined) {
    return undefined;
  }

  const memoryContext = requireObject(value, field);
  return {
    query: optionalString(memoryContext.query, `${field}.query`),
    corpusIds: optionalEnumArray(
      memoryContext.corpusIds,
      `${field}.corpusIds`,
      CORPORA,
      CONTEXT_ALIAS_OPTIONS
    ),
    budget: optionalBudget(memoryContext.budget, `${field}.budget`),
    includeSessionArchives: optionalBoolean(
      memoryContext.includeSessionArchives,
      `${field}.includeSessionArchives`
    ),
    sessionId: optionalString(memoryContext.sessionId, `${field}.sessionId`),
    includeTrace: optionalBoolean(memoryContext.includeTrace, `${field}.includeTrace`)
  };
}

function optionalBudget(value: unknown, field: string): JsonRecord | undefined {
  if (value === undefined) {
    return undefined;
  }

  return validateBudget(value, field);
}

function validateBudget(value: unknown, field: string): JsonRecord {
  const budget = requireObject(value, field);
  return {
    maxTokens: requireInteger(budget.maxTokens, `${field}.maxTokens`, { min: 1 }),
    maxSources: requireInteger(budget.maxSources, `${field}.maxSources`, { min: 1 }),
    maxRawExcerpts: requireInteger(budget.maxRawExcerpts, `${field}.maxRawExcerpts`, { min: 0 }),
    maxSummarySentences: requireInteger(budget.maxSummarySentences, `${field}.maxSummarySentences`, { min: 0 })
  };
}