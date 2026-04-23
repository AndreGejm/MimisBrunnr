import type {
  AgentHooks,
  BaseMessage,
  InputGuardrail,
  InputMiddleware,
  OutputGuardrail,
  OutputMiddleware
} from "@voltagent/core";
import type { PaidExecutionTelemetryDetails } from "@mimir/contracts";

type AdvisoryAction =
  | "retry_local"
  | "manual_followup"
  | "external_escalation";

export interface CodingAdvisoryOutput {
  recommendedAction: AdvisoryAction;
  summary: string;
  suggestedChecks: string[];
}

export interface PaidEscalationReasoningOutput {
  intent?: string;
  answerability?: string;
  summary?: string;
}

export interface VoltAgentRoleProfile<TOutput = unknown> {
  name: string;
  hooks: Partial<AgentHooks>;
  inputMiddlewares: InputMiddleware[];
  outputMiddlewares: OutputMiddleware<TOutput>[];
  inputGuardrails: InputGuardrail[];
  outputGuardrails: OutputGuardrail<TOutput>[];
  telemetryDetails?: PaidExecutionTelemetryDetails;
}

export class VoltAgentRoleProfileGuardrailError extends Error {
  constructor(
    readonly code:
      | "voltagent_input_guardrail_blocked"
      | "voltagent_output_guardrail_blocked",
    readonly blockedBy: "input" | "output",
    message: string
  ) {
    super(message);
    this.name = "VoltAgentRoleProfileGuardrailError";
  }
}

export function buildPaidEscalationVoltAgentProfile(): VoltAgentRoleProfile<PaidEscalationReasoningOutput> {
  return {
    name: "paid_escalation",
    hooks: {
      onStart: (args) => setHookContextValue(args.context, "mimir.roleProfile", "paid_escalation"),
      onRetry: (args) => setHookContextValue(args.context, "mimir.lastRetrySource", args.source),
      onFallback: (args) => setHookContextValue(args.context, "mimir.fallbackModelId", args.nextModel),
      onError: (args) =>
        setHookContextValue(
          args.context,
          "mimir.lastErrorName",
          args.error instanceof Error ? args.error.name : "unknown"
        ),
      onEnd: (args) => setHookContextValue(args.context, "mimir.completedRoleProfile", "paid_escalation")
    },
    inputMiddlewares: [
      Object.assign(
        (args: { input: string | BaseMessage[] | unknown[] }) =>
          normalizePaidEscalationInput(args.input),
        {
          middlewareId: "mimir.paid_escalation.normalize_input",
          middlewareName: "Normalize paid escalation input"
        }
      ) as InputMiddleware
    ],
    outputMiddlewares: [
      Object.assign(
        (args: { output: PaidEscalationReasoningOutput }) =>
          normalizePaidEscalationOutput(args.output),
        {
          middlewareId: "mimir.paid_escalation.normalize_output",
          middlewareName: "Normalize paid escalation output"
        }
      ) as OutputMiddleware<PaidEscalationReasoningOutput>
    ],
    inputGuardrails: [
      Object.assign(
        (args: { input: string | BaseMessage[] | unknown[] }) =>
          evaluatePaidEscalationInputGuardrail(args.input),
        {
          guardrailId: "mimir.paid_escalation.requires_query",
          guardrailName: "Require a non-empty paid escalation query"
        }
      ) as InputGuardrail
    ],
    outputGuardrails: [
      Object.assign(
        (args: { output: PaidEscalationReasoningOutput }) =>
          evaluatePaidEscalationOutputGuardrail(args.output),
        {
          guardrailId: "mimir.paid_escalation.prevent_false_certainty",
          guardrailName: "Prevent invalid certainty claims in uncertainty output"
        }
      ) as OutputGuardrail<PaidEscalationReasoningOutput>
    ],
    telemetryDetails: {
      roleProfile: "paid_escalation"
    }
  };
}

export function buildCodingAdvisoryVoltAgentProfile(): VoltAgentRoleProfile<CodingAdvisoryOutput> {
  return {
    name: "coding_advisory",
    hooks: {
      onStart: (args) => setHookContextValue(args.context, "mimir.roleProfile", "coding_advisory"),
      onRetry: (args) => setHookContextValue(args.context, "mimir.lastRetrySource", args.source),
      onFallback: (args) => setHookContextValue(args.context, "mimir.fallbackModelId", args.nextModel),
      onError: (args) =>
        setHookContextValue(
          args.context,
          "mimir.lastErrorName",
          args.error instanceof Error ? args.error.name : "unknown"
        ),
      onEnd: (args) => setHookContextValue(args.context, "mimir.completedRoleProfile", "coding_advisory")
    },
    inputMiddlewares: [
      Object.assign(
        (args: { input: string | BaseMessage[] | unknown[] }) =>
          normalizeCodingAdvisoryInput(args.input),
        {
          middlewareId: "mimir.coding_advisory.normalize_input",
          middlewareName: "Normalize coding advisory input"
        }
      ) as InputMiddleware
    ],
    outputMiddlewares: [
      Object.assign(
        (args: { output: CodingAdvisoryOutput }) =>
          normalizeCodingAdvisoryOutput(args.output),
        {
          middlewareId: "mimir.coding_advisory.normalize_output",
          middlewareName: "Normalize coding advisory output"
        }
      ) as OutputMiddleware<CodingAdvisoryOutput>
    ],
    inputGuardrails: [
      Object.assign(
        (args: { input: string | BaseMessage[] | unknown[] }) =>
          evaluateCodingAdvisoryInputGuardrail(args.input),
        {
          guardrailId: "mimir.coding_advisory.requires_escalate",
          guardrailName: "Require post-escalation advisory input"
        }
      ) as InputGuardrail
    ],
    outputGuardrails: [
      Object.assign(
        (args: { output: CodingAdvisoryOutput }) =>
          evaluateCodingAdvisoryOutputGuardrail(args.output),
        {
          guardrailId: "mimir.coding_advisory.prevent_completion_claims",
          guardrailName: "Prevent completion claims in advisory output"
        }
      ) as OutputGuardrail<CodingAdvisoryOutput>
    ],
    telemetryDetails: {
      roleProfile: "coding_advisory"
    }
  };
}

export function normalizeCodingAdvisoryInput(
  input: string | BaseMessage[] | unknown[]
): string | BaseMessage[] | unknown[] {
  if (typeof input !== "string") {
    return input;
  }

  return JSON.stringify(normalizeCodingAdvisoryPromptPayload(parsePromptPayload(input)), null, 2);
}

export function normalizePaidEscalationInput(
  input: string | BaseMessage[] | unknown[]
): string | BaseMessage[] | unknown[] {
  if (typeof input !== "string") {
    return input;
  }

  const queryMatch = input.match(/^\s*Query:\s*(.*)$/s);
  if (queryMatch) {
    const normalizedQuery = normalizeOptionalString(queryMatch[1]) ?? "";
    return `Query: ${normalizedQuery}`;
  }

  const payload = parsePromptPayload(input);
  if (Object.keys(payload).length === 0) {
    return normalizeOptionalString(input) ?? "";
  }

  return JSON.stringify(normalizePaidEscalationPromptPayload(payload), null, 2);
}

export function normalizeCodingAdvisoryPromptPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const localResponse = asRecord(payload.localResponse);
  const memoryContextStatus = asRecord(payload.memoryContextStatus);
  const escalationMetadata = asRecord(localResponse?.escalationMetadata);
  const validations = Array.isArray(localResponse?.validations)
    ? localResponse.validations
        .slice(0, 3)
        .map((value) => normalizeValidation(asRecord(value)))
        .filter(Boolean)
    : undefined;

  return compactRecord({
    taskType: normalizeOptionalString(payload.taskType),
    task: normalizeOptionalString(payload.task),
    context: normalizeOptionalString(payload.context),
    repoRoot: normalizeOptionalString(payload.repoRoot),
    filePath: normalizeOptionalString(payload.filePath),
    symbolName: normalizeOptionalString(payload.symbolName),
    pytestTarget: normalizeOptionalString(payload.pytestTarget),
    lintTarget: normalizeOptionalString(payload.lintTarget),
    memoryContextStatus: memoryContextStatus
      ? compactRecord(memoryContextStatus)
      : undefined,
    localResponse: compactRecord({
      status: normalizeOptionalString(localResponse?.status),
      reason: normalizeOptionalString(localResponse?.reason),
      attempts: typeof localResponse?.attempts === "number" ? localResponse.attempts : undefined,
      validations: validations && validations.length > 0 ? validations : undefined,
      escalationMetadata: escalationMetadata
        ? compactRecord(escalationMetadata)
        : undefined
    })
  });
}

export function normalizePaidEscalationPromptPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  return compactRecord({
    query: normalizeOptionalString(payload.query),
    intent: normalizeOptionalString(payload.intent),
    evidence: normalizePaidEscalationEvidence(payload.evidence)
  });
}

export function normalizeCodingAdvisoryOutput(
  output: CodingAdvisoryOutput
): CodingAdvisoryOutput {
  const suggestedChecks: string[] = [];
  const seenChecks = new Set<string>();

  for (const value of output.suggestedChecks ?? []) {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
      continue;
    }

    const dedupeKey = normalized.toLowerCase();
    if (seenChecks.has(dedupeKey)) {
      continue;
    }
    seenChecks.add(dedupeKey);
    suggestedChecks.push(normalized);

    if (suggestedChecks.length >= 5) {
      break;
    }
  }

  return {
    recommendedAction: output.recommendedAction,
    summary: normalizeSummary(output.summary),
    suggestedChecks
  };
}

export function normalizePaidEscalationOutput(
  output: PaidEscalationReasoningOutput
): PaidEscalationReasoningOutput {
  return compactRecord({
    intent: normalizeOptionalString(output.intent),
    answerability: normalizeOptionalString(output.answerability),
    summary: output.summary ? normalizeSummary(output.summary) : undefined
  }) as PaidEscalationReasoningOutput;
}

export function assertCodingAdvisoryInputAllowed(
  input: string | BaseMessage[] | unknown[]
): void {
  const result = evaluateCodingAdvisoryInputGuardrail(input);
  if (!result.pass) {
    throw new VoltAgentRoleProfileGuardrailError(
      "voltagent_input_guardrail_blocked",
      "input",
      result.message ?? "Coding advisory input was blocked by a role guardrail."
    );
  }
}

export function assertPaidEscalationInputAllowed(
  input: string | BaseMessage[] | unknown[]
): void {
  const result = evaluatePaidEscalationInputGuardrail(input);
  if (!result.pass) {
    throw new VoltAgentRoleProfileGuardrailError(
      "voltagent_input_guardrail_blocked",
      "input",
      result.message ?? "Paid escalation input was blocked by a role guardrail."
    );
  }
}

export function assertCodingAdvisoryOutputAllowed(
  output: CodingAdvisoryOutput
): void {
  const result = evaluateCodingAdvisoryOutputGuardrail(output);
  if (!result.pass) {
    throw new VoltAgentRoleProfileGuardrailError(
      "voltagent_output_guardrail_blocked",
      "output",
      result.message ?? "Coding advisory output was blocked by a role guardrail."
    );
  }
}

export function assertPaidEscalationOutputAllowed(
  output: PaidEscalationReasoningOutput
): void {
  const result = evaluatePaidEscalationOutputGuardrail(output);
  if (!result.pass) {
    throw new VoltAgentRoleProfileGuardrailError(
      "voltagent_output_guardrail_blocked",
      "output",
      result.message ?? "Paid escalation output was blocked by a role guardrail."
    );
  }
}

function evaluateCodingAdvisoryInputGuardrail(
  input: string | BaseMessage[] | unknown[]
): {
  pass: boolean;
  action?: "block";
  message?: string;
  metadata?: Record<string, unknown>;
} {
  if (typeof input !== "string") {
    return {
      pass: false,
      action: "block",
      message: "Post-escalation advisory input must be a structured JSON prompt."
    };
  }

  const payload = parsePromptPayload(input);
  const localResponse = asRecord(payload.localResponse);
  const status = normalizeOptionalString(localResponse?.status);
  if (status !== "escalate") {
    return {
      pass: false,
      action: "block",
      message: "Post-escalation coding advisory only accepts local escalate responses.",
      metadata: {
        status
      }
    };
  }

  return {
    pass: true
  };
}

function evaluatePaidEscalationInputGuardrail(
  input: string | BaseMessage[] | unknown[]
): {
  pass: boolean;
  action?: "block";
  message?: string;
  metadata?: Record<string, unknown>;
} {
  if (typeof input !== "string") {
    return {
      pass: false,
      action: "block",
      message: "Paid escalation input must be provided as a normalized string prompt."
    };
  }

  const queryMatch = input.match(/^\s*Query:\s*(.*)$/s);
  if (queryMatch) {
    const query = normalizeOptionalString(queryMatch[1]);
    if (!query) {
      return {
        pass: false,
        action: "block",
        message: "Paid escalation requires a non-empty query before invoking the provider."
      };
    }

    return {
      pass: true
    };
  }

  const payload = parsePromptPayload(input);
  const query = normalizeOptionalString(payload.query);
  if (!query) {
    return {
      pass: false,
      action: "block",
      message: "Paid escalation requires a non-empty query before invoking the provider."
    };
  }

  return {
    pass: true
  };
}

function evaluateCodingAdvisoryOutputGuardrail(
  output: CodingAdvisoryOutput
): {
  pass: boolean;
  action?: "block";
  message?: string;
  metadata?: Record<string, unknown>;
  modifiedOutput?: CodingAdvisoryOutput;
} {
  const normalized = normalizeCodingAdvisoryOutput(output);
  if (!normalized.summary) {
    return {
      pass: false,
      action: "block",
      message: "Coding advisory output must include a concise summary."
    };
  }

  if (normalized.suggestedChecks.length === 0) {
    return {
      pass: false,
      action: "block",
      message: "Coding advisory output must include at least one suggested check."
    };
  }

  if (claimsCompletion(normalized.summary)) {
    return {
      pass: false,
      action: "block",
      message:
        "Coding advisory output cannot claim the task is already fixed; it must recommend a next action.",
      metadata: {
        summary: normalized.summary
      }
    };
  }

  return {
    pass: true,
    modifiedOutput: normalized
  };
}

function evaluatePaidEscalationOutputGuardrail(
  output: PaidEscalationReasoningOutput
): {
  pass: boolean;
  action?: "block";
  message?: string;
  metadata?: Record<string, unknown>;
  modifiedOutput?: PaidEscalationReasoningOutput;
} {
  const normalized = normalizePaidEscalationOutput(output);
  if (
    normalized.summary &&
    claimsFalseCertainty(normalized.summary)
  ) {
    return {
      pass: false,
      action: "block",
      message:
        "Paid escalation uncertainty summary must describe remaining uncertainty instead of claiming complete certainty.",
      metadata: {
        summary: normalized.summary
      }
    };
  }

  return {
    pass: true,
    modifiedOutput: normalized
  };
}

function normalizeValidation(
  validation: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!validation) {
    return undefined;
  }

  return compactRecord({
    success:
      typeof validation.success === "boolean" ? validation.success : undefined,
    step: normalizeOptionalString(validation.step),
    exitCode:
      typeof validation.exitCode === "number" ? validation.exitCode : undefined,
    stdout: normalizeOptionalString(validation.stdout),
    stderr: normalizeOptionalString(validation.stderr)
  });
}

function normalizePaidEscalationEvidence(
  evidence: unknown
): Array<string | Record<string, unknown>> | undefined {
  if (!Array.isArray(evidence)) {
    return undefined;
  }

  const normalized = evidence
    .map((entry) => {
      if (typeof entry === "string") {
        return normalizeOptionalString(entry);
      }

      const record = asRecord(entry);
      if (!record) {
        return undefined;
      }

      return compactRecord({
        noteType: normalizeOptionalString(record.noteType),
        score: typeof record.score === "number" ? Number(record.score.toFixed(3)) : undefined,
        summary: normalizeOptionalString(record.summary),
        scope: normalizeOptionalString(record.scope),
        stalenessClass: normalizeOptionalString(record.stalenessClass),
        notePath: normalizeOptionalString(record.notePath)
      });
    })
    .filter((entry): entry is string | Record<string, unknown> => {
      if (!entry) {
        return false;
      }

      return typeof entry === "string" || Object.keys(entry).length > 0;
    });

  return normalized.length > 0 ? normalized.slice(0, 5) : undefined;
}

function normalizeSummary(value: unknown): string {
  const normalized = normalizeOptionalString(value) ?? "";
  if (normalized.length <= 180) {
    return normalized;
  }

  return `${normalized.slice(0, 177).trimEnd()}...`;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function claimsCompletion(summary: string): boolean {
  return (
    /\b(task|issue|problem|patch)\s+(is|was)\s+(fixed|resolved|complete|completed|done)\b/i.test(
      summary
    ) ||
    /\bcommit the patch\b/i.test(summary) ||
    /\bclose the ticket\b/i.test(summary)
  );
}

function claimsFalseCertainty(summary: string): boolean {
  return (
    /\bno uncertainty remains\b/i.test(summary) ||
    /\bfully answers the question\b/i.test(summary) ||
    /\bdefinitive answer\b/i.test(summary) ||
    /\bcompletely answered\b/i.test(summary)
  );
}

function compactRecord(
  value: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }

    if (Array.isArray(entry)) {
      if (entry.length === 0) {
        continue;
      }
      result[key] = entry;
      continue;
    }

    if (entry && typeof entry === "object") {
      const nested = compactRecord(entry as Record<string, unknown>);
      if (Object.keys(nested).length === 0) {
        continue;
      }
      result[key] = nested;
      continue;
    }

    result[key] = entry;
  }

  return result;
}

function parsePromptPayload(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function setHookContextValue(
  context: unknown,
  key: string,
  value: unknown
): void {
  if (
    context &&
    typeof context === "object" &&
    "set" in context &&
    typeof (context as { set?: unknown }).set === "function"
  ) {
    (context as { set: (mapKey: string, mapValue: unknown) => void }).set(
      key,
      value
    );
  }
}
