type JsonRecord = Record<string, unknown>;

const ACTOR_ROLES = new Set([
  "retrieval",
  "writer",
  "orchestrator",
  "system",
  "operator"
]);
const CORPORA = new Set(["context_brain", "general_notes"]);
const NOTE_TYPES = new Set([
  "decision",
  "constraint",
  "bug",
  "investigation",
  "runbook",
  "architecture",
  "glossary",
  "handoff",
  "reference",
  "policy"
]);
const NOTE_LIFECYCLE_STATES = new Set([
  "draft",
  "staged",
  "validated",
  "promoted",
  "superseded",
  "rejected",
  "archived"
]);
const CONTEXT_OWNER_SCOPES = new Set([
  "context_brain",
  "general_notes",
  "imports",
  "sessions",
  "system"
]);
const CONTEXT_AUTHORITY_STATES = new Set([
  "canonical",
  "staging",
  "derived",
  "imported",
  "session",
  "extracted"
]);
const QUERY_INTENTS = new Set([
  "fact_lookup",
  "decision_lookup",
  "implementation_guidance",
  "architecture_recall",
  "status_timeline",
  "debugging"
]);
const RETRIEVAL_STRATEGIES = new Set(["flat", "hierarchical"]);
const CODING_TASK_TYPES = new Set([
  "triage",
  "review",
  "draft_patch",
  "generate_tests",
  "summarize_diff",
  "propose_fix"
]);
const STALENESS_CLASSES = new Set(["current", "stale", "superseded"]);
const TEMPORAL_REFRESH_STATES = new Set([
  "expired",
  "future_dated",
  "expiring_soon"
]);

export class TransportValidationError extends Error {
  constructor(
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "TransportValidationError";
  }

  toServiceError(): {
    code: "validation_failed";
    message: string;
    details?: Record<string, unknown>;
  } {
    return {
      code: "validation_failed",
      message: this.message,
      details: this.details
    };
  }
}

export function validateTransportRequest(
  commandName: string,
  payload: JsonRecord
): JsonRecord {
  const normalizedCommand = normalizeCommandName(commandName);
  const actor = payload.actor === undefined
    ? undefined
    : validateActorOverride(payload.actor, "actor");

  switch (normalizedCommand) {
    case "execute-coding-task":
      return {
        actor,
        taskType: requireEnum(payload.taskType, "taskType", CODING_TASK_TYPES),
        task: requireString(payload.task, "task"),
        context: optionalString(payload.context, "context"),
        repoRoot: optionalString(payload.repoRoot, "repoRoot"),
        filePath: optionalString(payload.filePath, "filePath"),
        symbolName: optionalString(payload.symbolName, "symbolName"),
        diffText: optionalString(payload.diffText, "diffText"),
        pytestTarget: optionalString(payload.pytestTarget, "pytestTarget"),
        lintTarget: optionalString(payload.lintTarget, "lintTarget")
      };
    case "search-context":
      return {
        actor,
        query: requireString(payload.query, "query"),
        budget: validateBudget(payload.budget, "budget"),
        corpusIds: requireEnumArray(payload.corpusIds, "corpusIds", CORPORA, { minItems: 1 }),
        strategy: optionalEnum(payload.strategy, "strategy", RETRIEVAL_STRATEGIES),
        intentHint: optionalEnum(payload.intentHint, "intentHint", QUERY_INTENTS),
        noteTypePriority: optionalEnumArray(payload.noteTypePriority, "noteTypePriority", NOTE_TYPES),
        tagFilters: optionalStringArray(payload.tagFilters, "tagFilters"),
        includeSuperseded: optionalBoolean(payload.includeSuperseded, "includeSuperseded"),
        requireEvidence: optionalBoolean(payload.requireEvidence, "requireEvidence")
      };
    case "list-context-tree":
      return {
        actor,
        ownerScope: optionalEnum(payload.ownerScope, "ownerScope", CONTEXT_OWNER_SCOPES),
        authorityStates: optionalEnumArray(
          payload.authorityStates,
          "authorityStates",
          CONTEXT_AUTHORITY_STATES
        )
      };
    case "read-context-node":
      return {
        actor,
        uri: requireString(payload.uri, "uri")
      };
    case "get-context-packet":
      return {
        actor,
        intent: requireEnum(payload.intent, "intent", QUERY_INTENTS),
        budget: validateBudget(payload.budget, "budget"),
        candidates: validateCandidates(payload.candidates, "candidates"),
        includeRawExcerpts: requireBoolean(payload.includeRawExcerpts, "includeRawExcerpts")
      };
    case "fetch-decision-summary":
      return {
        actor,
        topic: requireString(payload.topic, "topic"),
        budget: validateBudget(payload.budget, "budget")
      };
    case "draft-note":
      return {
        actor,
        targetCorpus: requireEnum(payload.targetCorpus, "targetCorpus", CORPORA),
        noteType: requireEnum(payload.noteType, "noteType", NOTE_TYPES),
        title: requireString(payload.title, "title"),
        sourcePrompt: requireString(payload.sourcePrompt, "sourcePrompt"),
        supportingSources: validateSupportingSources(payload.supportingSources, "supportingSources"),
        frontmatterOverrides: optionalFrontmatterOverrides(payload.frontmatterOverrides, "frontmatterOverrides"),
        bodyHints: optionalStringArray(payload.bodyHints, "bodyHints")
      };
    case "create-refresh-draft":
      return {
        actor,
        noteId: requireString(payload.noteId, "noteId"),
        asOf: optionalString(payload.asOf, "asOf"),
        expiringWithinDays: optionalInteger(payload.expiringWithinDays, "expiringWithinDays", { min: 1 }),
        bodyHints: optionalStringArray(payload.bodyHints, "bodyHints")
      };
    case "create-refresh-drafts":
      return {
        actor,
        asOf: optionalString(payload.asOf, "asOf"),
        expiringWithinDays: optionalInteger(payload.expiringWithinDays, "expiringWithinDays", { min: 1 }),
        corpusId: optionalEnum(payload.corpusId, "corpusId", CORPORA),
        limitPerCategory: optionalInteger(payload.limitPerCategory, "limitPerCategory", { min: 1 }),
        maxDrafts: optionalInteger(payload.maxDrafts, "maxDrafts", { min: 1 }),
        sourceStates: optionalEnumArray(
          payload.sourceStates,
          "sourceStates",
          TEMPORAL_REFRESH_STATES
        ),
        bodyHints: optionalStringArray(payload.bodyHints, "bodyHints")
      };
    case "validate-note":
      return {
        actor,
        targetCorpus: requireEnum(payload.targetCorpus, "targetCorpus", CORPORA),
        notePath: requireString(payload.notePath, "notePath"),
        frontmatter: validateNoteFrontmatter(payload.frontmatter, "frontmatter"),
        body: requireString(payload.body, "body"),
        validationMode: requireEnum(payload.validationMode, "validationMode", new Set(["draft", "promotion"]))
      };
    case "promote-note":
      return {
        actor,
        draftNoteId: requireString(payload.draftNoteId, "draftNoteId"),
        targetCorpus: requireEnum(payload.targetCorpus, "targetCorpus", CORPORA),
        expectedDraftRevision: optionalString(payload.expectedDraftRevision, "expectedDraftRevision"),
        targetPath: optionalString(payload.targetPath, "targetPath"),
        promoteAsCurrentState: requireBoolean(payload.promoteAsCurrentState, "promoteAsCurrentState")
      };
    case "query-history":
      return {
        actor,
        noteId: optionalString(payload.noteId, "noteId"),
        since: optionalString(payload.since, "since"),
        until: optionalString(payload.until, "until"),
        limit: requireInteger(payload.limit, "limit", { min: 1 })
      };
    default:
      return payload;
  }
}

function normalizeCommandName(commandName: string): string {
  return commandName.replace(/_/g, "-");
}

function validateActorOverride(value: unknown, field: string): JsonRecord {
  const actor = requireObject(value, field);
  return {
    actorId: optionalString(actor.actorId, `${field}.actorId`),
    actorRole: optionalEnum(actor.actorRole, `${field}.actorRole`, ACTOR_ROLES),
    source: optionalString(actor.source, `${field}.source`),
    requestId: optionalString(actor.requestId, `${field}.requestId`),
    initiatedAt: optionalString(actor.initiatedAt, `${field}.initiatedAt`),
    toolName: optionalString(actor.toolName, `${field}.toolName`),
    authToken: optionalString(actor.authToken, `${field}.authToken`)
  };
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

function validateCandidates(value: unknown, field: string): JsonRecord[] {
  const candidates = requireArray(value, field);
  return candidates.map((candidate, index) => {
    const itemField = `${field}[${index}]`;
    const record = requireObject(candidate, itemField);
    return {
      noteType: requireEnum(record.noteType, `${itemField}.noteType`, NOTE_TYPES),
      score: requireNumber(record.score, `${itemField}.score`),
      summary: requireString(record.summary, `${itemField}.summary`),
      rawText: optionalString(record.rawText, `${itemField}.rawText`),
      scope: requireString(record.scope, `${itemField}.scope`),
      qualifiers: requireStringArray(record.qualifiers, `${itemField}.qualifiers`),
      tags: requireStringArray(record.tags, `${itemField}.tags`),
      stalenessClass: requireEnum(record.stalenessClass, `${itemField}.stalenessClass`, STALENESS_CLASSES),
      provenance: validateProvenance(record.provenance, `${itemField}.provenance`)
    };
  });
}

function validateProvenance(value: unknown, field: string): JsonRecord {
  const provenance = requireObject(value, field);
  return {
    noteId: requireString(provenance.noteId, `${field}.noteId`),
    chunkId: optionalString(provenance.chunkId, `${field}.chunkId`),
    notePath: requireString(provenance.notePath, `${field}.notePath`),
    headingPath: requireStringArray(provenance.headingPath, `${field}.headingPath`)
  };
}

function validateSupportingSources(value: unknown, field: string): JsonRecord[] {
  const sources = requireArray(value, field);
  return sources.map((source, index) => {
    const itemField = `${field}[${index}]`;
    const record = requireObject(source, itemField);
    return {
      noteId: optionalString(record.noteId, `${itemField}.noteId`),
      notePath: requireString(record.notePath, `${itemField}.notePath`),
      headingPath: requireStringArray(record.headingPath, `${itemField}.headingPath`),
      excerpt: optionalString(record.excerpt, `${itemField}.excerpt`)
    };
  });
}

function optionalFrontmatterOverrides(value: unknown, field: string): JsonRecord | undefined {
  if (value === undefined) {
    return undefined;
  }

  const frontmatter = requireObject(value, field);
  return {
    noteId: optionalString(frontmatter.noteId, `${field}.noteId`),
    title: optionalString(frontmatter.title, `${field}.title`),
    project: optionalString(frontmatter.project, `${field}.project`),
    type: optionalEnum(frontmatter.type, `${field}.type`, NOTE_TYPES),
    status: optionalEnum(frontmatter.status, `${field}.status`, NOTE_LIFECYCLE_STATES),
    updated: optionalString(frontmatter.updated, `${field}.updated`),
    summary: optionalString(frontmatter.summary, `${field}.summary`),
    tags: optionalStringArray(frontmatter.tags, `${field}.tags`),
    scope: optionalString(frontmatter.scope, `${field}.scope`),
    corpusId: optionalEnum(frontmatter.corpusId, `${field}.corpusId`, CORPORA),
    currentState: optionalBoolean(frontmatter.currentState, `${field}.currentState`),
    validFrom: optionalString(frontmatter.validFrom, `${field}.validFrom`),
    validUntil: optionalString(frontmatter.validUntil, `${field}.validUntil`),
    supersedes: optionalStringArray(frontmatter.supersedes, `${field}.supersedes`),
    supersededBy: optionalString(frontmatter.supersededBy, `${field}.supersededBy`)
  };
}

function validateNoteFrontmatter(value: unknown, field: string): JsonRecord {
  const frontmatter = requireObject(value, field);
  return {
    noteId: requireString(frontmatter.noteId, `${field}.noteId`),
    title: requireString(frontmatter.title, `${field}.title`),
    project: requireString(frontmatter.project, `${field}.project`),
    type: requireEnum(frontmatter.type, `${field}.type`, NOTE_TYPES),
    status: requireEnum(frontmatter.status, `${field}.status`, NOTE_LIFECYCLE_STATES),
    updated: requireString(frontmatter.updated, `${field}.updated`),
    summary: requireString(frontmatter.summary, `${field}.summary`),
    tags: requireStringArray(frontmatter.tags, `${field}.tags`),
    scope: requireString(frontmatter.scope, `${field}.scope`),
    corpusId: requireEnum(frontmatter.corpusId, `${field}.corpusId`, CORPORA),
    currentState: requireBoolean(frontmatter.currentState, `${field}.currentState`),
    validFrom: optionalString(frontmatter.validFrom, `${field}.validFrom`),
    validUntil: optionalString(frontmatter.validUntil, `${field}.validUntil`),
    supersedes: optionalStringArray(frontmatter.supersedes, `${field}.supersedes`),
    supersededBy: optionalString(frontmatter.supersededBy, `${field}.supersededBy`)
  };
}

function requireObject(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(field, "must be a JSON object");
  }

  return value as JsonRecord;
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw validationError(field, "must be an array");
  }

  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw validationError(field, "must be a non-empty string");
  }

  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireString(value, field);
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw validationError(field, "must be a boolean");
  }

  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireBoolean(value, field);
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw validationError(field, "must be a finite number");
  }

  return value;
}

function requireInteger(
  value: unknown,
  field: string,
  options: { min?: number } = {}
): number {
  const numberValue = requireNumber(value, field);
  if (!Number.isInteger(numberValue)) {
    throw validationError(field, "must be an integer");
  }

  if (options.min !== undefined && numberValue < options.min) {
    throw validationError(field, `must be greater than or equal to ${options.min}`);
  }

  return numberValue;
}

function optionalInteger(
  value: unknown,
  field: string,
  options: { min?: number } = {}
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireInteger(value, field, options);
}

function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>
): T {
  const stringValue = requireString(value, field);
  if (!allowedValues.has(stringValue as T)) {
    throw validationError(field, `must be one of: ${[...allowedValues].join(", ")}`);
  }

  return stringValue as T;
}

function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireEnum(value, field, allowedValues);
}

function requireStringArray(
  value: unknown,
  field: string
): string[] {
  const values = requireArray(value, field);
  return values.map((item, index) => requireString(item, `${field}[${index}]`));
}

function optionalStringArray(
  value: unknown,
  field: string
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireStringArray(value, field);
}

function requireEnumArray<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>,
  options: { minItems?: number } = {}
): T[] {
  const values = requireArray(value, field);
  if (options.minItems !== undefined && values.length < options.minItems) {
    throw validationError(field, `must contain at least ${options.minItems} item(s)`);
  }

  return values.map((item, index) =>
    requireEnum(item, `${field}[${index}]`, allowedValues)
  );
}

function optionalEnumArray<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>
): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireEnumArray(value, field, allowedValues);
}

function validationError(field: string, problem: string): TransportValidationError {
  return new TransportValidationError(
    `Invalid request field '${field}': ${problem}.`,
    { field, problem }
  );
}
