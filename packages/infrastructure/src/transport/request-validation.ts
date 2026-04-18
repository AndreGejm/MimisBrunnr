import {
  RUNTIME_COMMAND_DEFINITIONS,
  toCliCommandName,
  type RuntimeCliCommandName
} from "@mimir/contracts";
import {
  AUDIT_ACTION_TYPES,
  type AuditActionType
} from "@mimir/domain";
import {
  optionalBoolean,
  optionalEnum,
  optionalEnumArray,
  optionalInteger,
  optionalString,
  optionalStringArray,
  requestValidationError,
  requireArray,
  requireBoolean,
  requireEnum,
  requireEnumArray,
  requireInteger,
  requireNumber,
  requireObject,
  requireString,
  requireStringArray,
  type JsonRecord
} from "./request-field-validation.js";
import {
  validateExecuteCodingTaskRequest,
  validateListAgentTracesRequest,
  validateShowToolOutputRequest
} from "./coding-request-validation.js";

const ACTOR_ROLES = new Set([
  "retrieval",
  "writer",
  "orchestrator",
  "system",
  "operator"
]);
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
  "mimisbrunnr",
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
const SESSION_ARCHIVE_MESSAGE_ROLES = new Set([
  "system",
  "user",
  "assistant",
  "tool"
]);
const STALENESS_CLASSES = new Set(["current", "stale", "superseded"]);
const TEMPORAL_REFRESH_STATES = new Set([
  "expired",
  "future_dated",
  "expiring_soon"
]);
const AUDIT_ACTION_TYPE_SET = new Set<AuditActionType>(AUDIT_ACTION_TYPES);

type TransportCommandValidator = (
  payload: JsonRecord,
  actor: JsonRecord | undefined
) => JsonRecord;

const TRANSPORT_COMMAND_VALIDATORS: Record<RuntimeCliCommandName, TransportCommandValidator> = {
  "execute-coding-task": validateExecuteCodingTaskRequest,
  "list-agent-traces": validateListAgentTracesRequest,
  "show-tool-output": validateShowToolOutputRequest,
  "list-ai-tools": (payload, actor) => ({
    actor,
    ids: optionalStringArray(payload.ids, "ids"),
    includeEnvironment: optionalBoolean(payload.includeEnvironment, "includeEnvironment"),
    includeRuntime: optionalBoolean(payload.includeRuntime, "includeRuntime")
  }),
  "check-ai-tools": (payload, actor) => ({
    actor,
    ids: optionalStringArray(payload.ids, "ids")
  }),
  "tools-package-plan": (payload, actor) => ({
    actor,
    ids: optionalStringArray(payload.ids, "ids")
  }),
  "search-context": (payload, actor) => ({
    actor,
    query: requireString(payload.query, "query"),
    budget: validateBudget(payload.budget, "budget"),
    corpusIds: requireEnumArray(payload.corpusIds, "corpusIds", CORPORA, { ...CONTEXT_ALIAS_OPTIONS, minItems: 1 }),
    strategy: optionalEnum(payload.strategy, "strategy", RETRIEVAL_STRATEGIES),
    intentHint: optionalEnum(payload.intentHint, "intentHint", QUERY_INTENTS),
    noteTypePriority: optionalEnumArray(payload.noteTypePriority, "noteTypePriority", NOTE_TYPES),
    tagFilters: optionalStringArray(payload.tagFilters, "tagFilters"),
    includeSuperseded: optionalBoolean(payload.includeSuperseded, "includeSuperseded"),
    requireEvidence: optionalBoolean(payload.requireEvidence, "requireEvidence"),
    includeTrace: optionalBoolean(payload.includeTrace, "includeTrace")
  }),
  "search-session-archives": (payload, actor) => ({
    actor,
    query: requireString(payload.query, "query"),
    sessionId: optionalString(payload.sessionId, "sessionId"),
    limit: optionalInteger(payload.limit, "limit", { min: 1 }),
    maxTokens: optionalInteger(payload.maxTokens, "maxTokens", { min: 1 })
  }),
  "assemble-agent-context": (payload, actor) => ({
    actor,
    query: requireString(payload.query, "query"),
    budget: validateBudget(payload.budget, "budget"),
    corpusIds: requireEnumArray(payload.corpusIds, "corpusIds", CORPORA, { ...CONTEXT_ALIAS_OPTIONS, minItems: 1 }),
    includeTrace: optionalBoolean(payload.includeTrace, "includeTrace"),
    includeSessionArchives: optionalBoolean(payload.includeSessionArchives, "includeSessionArchives"),
    sessionId: optionalString(payload.sessionId, "sessionId"),
    sessionLimit: optionalInteger(payload.sessionLimit, "sessionLimit", { min: 1 }),
    sessionMaxTokens: optionalInteger(payload.sessionMaxTokens, "sessionMaxTokens", { min: 1 })
  }),
  "list-context-tree": (payload, actor) => ({
    actor,
    ownerScope: optionalEnum(payload.ownerScope, "ownerScope", CONTEXT_OWNER_SCOPES, CONTEXT_ALIAS_OPTIONS),
    authorityStates: optionalEnumArray(
      payload.authorityStates,
      "authorityStates",
      CONTEXT_AUTHORITY_STATES
    )
  }),
  "read-context-node": (payload, actor) => ({
    actor,
    uri: requireString(payload.uri, "uri")
  }),
  "get-context-packet": (payload, actor) => ({
    actor,
    intent: requireEnum(payload.intent, "intent", QUERY_INTENTS),
    budget: validateBudget(payload.budget, "budget"),
    candidates: validateCandidates(payload.candidates, "candidates"),
    includeRawExcerpts: requireBoolean(payload.includeRawExcerpts, "includeRawExcerpts")
  }),
  "fetch-decision-summary": (payload, actor) => ({
    actor,
    topic: requireString(payload.topic, "topic"),
    budget: validateBudget(payload.budget, "budget")
  }),
  "draft-note": (payload, actor) => ({
    actor,
    targetCorpus: requireEnum(payload.targetCorpus, "targetCorpus", CORPORA, CONTEXT_ALIAS_OPTIONS),
    noteType: requireEnum(payload.noteType, "noteType", NOTE_TYPES),
    title: requireString(payload.title, "title"),
    sourcePrompt: requireString(payload.sourcePrompt, "sourcePrompt"),
    supportingSources: validateSupportingSources(payload.supportingSources, "supportingSources"),
    frontmatterOverrides: optionalFrontmatterOverrides(payload.frontmatterOverrides, "frontmatterOverrides"),
    bodyHints: optionalStringArray(payload.bodyHints, "bodyHints")
  }),
  "list-review-queue": (payload, actor) => ({
    actor,
    targetCorpus: optionalEnum(payload.targetCorpus, "targetCorpus", CORPORA, CONTEXT_ALIAS_OPTIONS),
    includeRejected: optionalBoolean(payload.includeRejected, "includeRejected")
  }),
  "read-review-note": (payload, actor) => ({
    actor,
    draftNoteId: requireString(payload.draftNoteId, "draftNoteId")
  }),
  "accept-note": (payload, actor) => ({
    actor,
    draftNoteId: requireString(payload.draftNoteId, "draftNoteId")
  }),
  "reject-note": (payload, actor) => ({
    actor,
    draftNoteId: requireString(payload.draftNoteId, "draftNoteId"),
    reviewNotes: optionalString(payload.reviewNotes, "reviewNotes")
  }),
  "create-refresh-draft": (payload, actor) => ({
    actor,
    noteId: requireString(payload.noteId, "noteId"),
    asOf: optionalString(payload.asOf, "asOf"),
    expiringWithinDays: optionalInteger(payload.expiringWithinDays, "expiringWithinDays", { min: 1 }),
    bodyHints: optionalStringArray(payload.bodyHints, "bodyHints")
  }),
  "create-refresh-drafts": (payload, actor) => ({
    actor,
    asOf: optionalString(payload.asOf, "asOf"),
    expiringWithinDays: optionalInteger(payload.expiringWithinDays, "expiringWithinDays", { min: 1 }),
    corpusId: optionalEnum(payload.corpusId, "corpusId", CORPORA, CONTEXT_ALIAS_OPTIONS),
    limitPerCategory: optionalInteger(payload.limitPerCategory, "limitPerCategory", { min: 1 }),
    maxDrafts: optionalInteger(payload.maxDrafts, "maxDrafts", { min: 1 }),
    sourceStates: optionalEnumArray(
      payload.sourceStates,
      "sourceStates",
      TEMPORAL_REFRESH_STATES
    ),
    bodyHints: optionalStringArray(payload.bodyHints, "bodyHints")
  }),
  "validate-note": (payload, actor) => ({
    actor,
    targetCorpus: requireEnum(payload.targetCorpus, "targetCorpus", CORPORA, CONTEXT_ALIAS_OPTIONS),
    notePath: requireString(payload.notePath, "notePath"),
    frontmatter: validateNoteFrontmatter(payload.frontmatter, "frontmatter"),
    body: requireString(payload.body, "body"),
    validationMode: requireEnum(payload.validationMode, "validationMode", new Set(["draft", "promotion"]))
  }),
  "promote-note": (payload, actor) => ({
    actor,
    draftNoteId: requireString(payload.draftNoteId, "draftNoteId"),
    targetCorpus: requireEnum(payload.targetCorpus, "targetCorpus", CORPORA, CONTEXT_ALIAS_OPTIONS),
    expectedDraftRevision: optionalString(payload.expectedDraftRevision, "expectedDraftRevision"),
    targetPath: optionalString(payload.targetPath, "targetPath"),
    promoteAsCurrentState: requireBoolean(payload.promoteAsCurrentState, "promoteAsCurrentState")
  }),
  "import-resource": (payload, actor) => ({
    actor,
    sourcePath: requireString(payload.sourcePath, "sourcePath"),
    importKind: requireString(payload.importKind, "importKind")
  }),
  "query-history": (payload, actor) => ({
    actor,
    actorId: optionalString(payload.actorId, "actorId"),
    actionType: optionalEnum(payload.actionType, "actionType", AUDIT_ACTION_TYPE_SET),
    noteId: optionalString(payload.noteId, "noteId"),
    source: optionalString(payload.source, "source"),
    since: optionalString(payload.since, "since"),
    until: optionalString(payload.until, "until"),
    limit: requireInteger(payload.limit, "limit", { min: 1 })
  }),
  "create-session-archive": (payload, actor) => ({
    actor,
    sessionId: requireString(payload.sessionId, "sessionId"),
    messages: validateSessionArchiveMessages(payload.messages, "messages")
  })
};

export function getSupportedTransportCommandNames(): RuntimeCliCommandName[] {
  return RUNTIME_COMMAND_DEFINITIONS.map((command) => {
    if (!TRANSPORT_COMMAND_VALIDATORS[command.cliName]) {
      throw new Error(`Transport validator is not registered for runtime command '${command.cliName}'.`);
    }

    return command.cliName;
  });
}

export function validateTransportRequest(
  commandName: string,
  payload: JsonRecord
): JsonRecord {
  const normalizedCommand = normalizeCommandName(commandName);
  const actor = payload.actor === undefined
    ? undefined
    : validateActorOverride(payload.actor, "actor");
  const validator = (TRANSPORT_COMMAND_VALIDATORS as Partial<Record<string, TransportCommandValidator>>)[
    normalizedCommand
  ];

  return validator ? validator(payload, actor) : payload;
}

function normalizeCommandName(commandName: string): string {
  return toCliCommandName(commandName) ?? commandName.replace(/_/g, "-");
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
    authToken: optionalString(actor.authToken, `${field}.authToken`),
    sessionPolicyToken: optionalString(actor.sessionPolicyToken, `${field}.sessionPolicyToken`),
    toolboxSessionMode: optionalString(actor.toolboxSessionMode, `${field}.toolboxSessionMode`),
    toolboxClientId: optionalString(actor.toolboxClientId, `${field}.toolboxClientId`),
    toolboxProfileId: optionalString(actor.toolboxProfileId, `${field}.toolboxProfileId`)
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

function validateSessionArchiveMessages(
  value: unknown,
  field: string
): Array<{ role: string; content: string }> {
  const messages = requireArray(value, field);
  if (messages.length === 0) {
    throw requestValidationError(field, "must contain at least 1 item(s)");
  }

  return messages.map((message, index) => {
    const itemField = `${field}[${index}]`;
    const record = requireObject(message, itemField);

    return {
      role: requireEnum(
        record.role,
        `${itemField}.role`,
        SESSION_ARCHIVE_MESSAGE_ROLES
      ),
      content: requireString(record.content, `${itemField}.content`)
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
    corpusId: optionalEnum(frontmatter.corpusId, `${field}.corpusId`, CORPORA, CONTEXT_ALIAS_OPTIONS),
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
    corpusId: requireEnum(frontmatter.corpusId, `${field}.corpusId`, CORPORA, CONTEXT_ALIAS_OPTIONS),
    currentState: requireBoolean(frontmatter.currentState, `${field}.currentState`),
    validFrom: optionalString(frontmatter.validFrom, `${field}.validFrom`),
    validUntil: optionalString(frontmatter.validUntil, `${field}.validUntil`),
    supersedes: optionalStringArray(frontmatter.supersedes, `${field}.supersedes`),
    supersededBy: optionalString(frontmatter.supersededBy, `${field}.supersededBy`)
  };
}
