import type { LocalReasoningProvider } from "@mimir/application";
import type {
  ContextCandidate,
  PaidExecutionTelemetryDetails,
  PaidExecutionOutcomeClass,
  PaidExecutionTelemetry
} from "@mimir/contracts";
import type {
  AnswerabilityDisposition,
  QueryIntent
} from "@mimir/domain";
import { z } from "zod";
import {
  VoltAgentHarnessRuntime,
  VoltAgentHarnessRuntimeError,
  type VoltAgentHarnessAgentFactory
} from "./voltagent-harness-runtime.js";
import {
  VoltAgentProviderError,
  createVoltAgentTelemetry,
  findMissingVoltAgentCredentialForModels,
  parseVoltAgentProviderModel
} from "./voltagent-provider-support.js";
import {
  VoltAgentRoleProfileGuardrailError,
  assertPaidEscalationInputAllowed,
  assertPaidEscalationOutputAllowed,
  buildPaidEscalationVoltAgentProfile,
  normalizePaidEscalationInput,
  normalizePaidEscalationOutput,
  normalizePaidEscalationPromptPayload
} from "./voltagent-role-profile.js";

type ReasoningTask = "intent" | "answerability" | "uncertainty";

export interface VoltAgentReasoningAdapterOptions {
  model: string;
  timeoutMs: number;
  temperature?: number;
  seed?: number;
  maxOutputTokens?: number;
  fallbackModelIds?: string[];
  fallback?: LocalReasoningProvider;
  createAgent?: VoltAgentHarnessAgentFactory;
  credentialEnv?: NodeJS.ProcessEnv;
}

const TASK_TOKEN_BUDGET: Record<ReasoningTask, number> = {
  intent: 128,
  answerability: 160,
  uncertainty: 96
};

const QUERY_INTENT_VALUES = [
  "fact_lookup",
  "decision_lookup",
  "implementation_guidance",
  "status_timeline",
  "debugging",
  "architecture_recall"
] as const;

const ANSWERABILITY_VALUES = [
  "local_answer",
  "partial",
  "needs_escalation"
] as const;

export class VoltAgentReasoningAdapter implements LocalReasoningProvider {
  readonly providerId = "voltagent_agent";

  private readonly credentialEnv: NodeJS.ProcessEnv;
  private readonly roleProfile = buildPaidEscalationVoltAgentProfile();
  private readonly runtime: VoltAgentHarnessRuntime;
  private lastTelemetry?: PaidExecutionTelemetry;

  constructor(private readonly options: VoltAgentReasoningAdapterOptions) {
    this.credentialEnv = options.credentialEnv ?? process.env;
    this.runtime = new VoltAgentHarnessRuntime({
      providerId: this.providerId,
      model: options.model,
      fallbackModelIds: options.fallbackModelIds,
      timeoutMs: options.timeoutMs,
      temperature: options.temperature ?? 0,
      maxOutputTokens: options.maxOutputTokens,
      maxRetries: 1,
      hooks: this.roleProfile.hooks,
      inputMiddlewares: this.roleProfile.inputMiddlewares,
      outputMiddlewares: this.roleProfile.outputMiddlewares,
      inputGuardrails: this.roleProfile.inputGuardrails,
      outputGuardrails: this.roleProfile.outputGuardrails,
      telemetryDetails: this.roleProfile.telemetryDetails,
      createAgent: options.createAgent
    });
  }

  consumePaidExecutionTelemetry(): PaidExecutionTelemetry | undefined {
    const telemetry = this.lastTelemetry;
    this.lastTelemetry = undefined;
    return telemetry;
  }

  async classifyIntent(query: string): Promise<QueryIntent> {
    const prompt = this.preparePromptOrThrow(normalizePaidEscalationInput(`Query: ${query}`));
    return this.executeTask<QueryIntent>({
      task: "intent",
      fallback: async () =>
        this.options.fallback
          ? this.options.fallback.classifyIntent(query)
          : undefined,
      run: async () => {
        const result = await this.runtime.generateObject({
          taskName: "mimir-paid-intent",
          instructions: instructionsForTask("intent"),
          prompt,
          schema: z.object({
            intent: z.enum(QUERY_INTENT_VALUES)
          }),
          maxOutputTokens: TASK_TOKEN_BUDGET.intent
        });

        return result.intent;
      }
    });
  }

  async assessAnswerability(input: {
    query: string;
    intent: QueryIntent;
    candidates: ContextCandidate[];
  }): Promise<AnswerabilityDisposition> {
    const prompt = this.preparePromptOrThrow(
      normalizePaidEscalationInput(
        JSON.stringify(
          normalizePaidEscalationPromptPayload({
            query: input.query,
            intent: input.intent,
            evidence: input.candidates.slice(0, 4).map((candidate) => ({
              noteType: candidate.noteType,
              score: Number(candidate.score.toFixed(3)),
              summary: candidate.summary,
              scope: candidate.scope,
              stalenessClass: candidate.stalenessClass,
              notePath: candidate.provenance.notePath
            }))
          }),
          null,
          2
        )
      )
    );
    return this.executeTask<AnswerabilityDisposition>({
      task: "answerability",
      fallback: async () =>
        this.options.fallback
          ? this.options.fallback.assessAnswerability(input)
          : undefined,
      run: async () => {
        const result = await this.runtime.generateObject({
          taskName: "mimir-paid-answerability",
          instructions: instructionsForTask("answerability"),
          prompt,
          schema: z.object({
            answerability: z.enum(ANSWERABILITY_VALUES)
          }),
          maxOutputTokens: TASK_TOKEN_BUDGET.answerability
        });

        return result.answerability;
      }
    });
  }

  async summarizeUncertainty(query: string, evidence: string[]): Promise<string> {
    const prompt = this.preparePromptOrThrow(
      normalizePaidEscalationInput(
        JSON.stringify(
          normalizePaidEscalationPromptPayload({
            query,
            evidence: evidence.slice(0, 5)
          }),
          null,
          2
        )
      )
    );
    return this.executeTask<string>({
      task: "uncertainty",
      fallback: async () =>
        this.options.fallback
          ? this.options.fallback.summarizeUncertainty(query, evidence)
          : undefined,
      run: async () => {
        const result = await this.runtime.generateObject({
          taskName: "mimir-paid-uncertainty",
          instructions: instructionsForTask("uncertainty"),
          prompt,
          schema: z.object({
            summary: z.string().trim().min(1)
          }),
          maxOutputTokens: TASK_TOKEN_BUDGET.uncertainty
        });

        const output = normalizePaidEscalationOutput({ summary: result.summary });
        assertPaidEscalationOutputAllowed(output);
        return output.summary ?? "";
      }
    });
  }

  private async executeTask<T>(input: {
    task: ReasoningTask;
    run: () => Promise<T>;
    fallback: () => Promise<T | undefined>;
  }): Promise<T> {
    const configuredModelIds = [
      this.options.model,
      ...(this.options.fallbackModelIds ?? [])
    ];
    const invalidModelId = configuredModelIds.find(
      (modelId) => !parseVoltAgentProviderModel(modelId)
    );
    if (invalidModelId) {
      return this.failOrFallback<T>({
        message:
          "VoltAgent requires provider-prefixed model ids such as 'openai/gpt-4.1-mini'.",
        telemetry: this.createTelemetry(
          "unsupported_model",
          false,
          0,
          "voltagent_invalid_model_id"
        ),
        fallback: input.fallback
      });
    }

    const missingCredential = findMissingVoltAgentCredentialForModels(
      configuredModelIds,
      this.credentialEnv
    );
    if (missingCredential) {
      return this.failOrFallback<T>({
        message: `VoltAgent model '${this.options.model}' requires ${missingCredential}.`,
        telemetry: this.createTelemetry(
          "invalid_configuration",
          false,
          0,
          `voltagent_missing_${missingCredential.toLowerCase()}`
        ),
        fallback: input.fallback
      });
    }

    try {
      const result = await input.run();
      this.lastTelemetry = this.runtime.consumePaidExecutionTelemetry();
      return result;
    } catch (error) {
      if (error instanceof VoltAgentRoleProfileGuardrailError) {
        return this.failOrFallback<T>({
          message: error.message,
          telemetry: this.createTelemetry(
            "provider_error",
            false,
            0,
            error.code,
            { blockedByGuardrail: error.blockedBy }
          ),
          fallback: input.fallback,
          cause: error
        });
      }

      const harnessTelemetry =
        error instanceof VoltAgentHarnessRuntimeError
          ? error.telemetry
          : this.runtime.consumePaidExecutionTelemetry();

      return this.failOrFallback<T>({
        message: error instanceof Error ? error.message : String(error),
        telemetry:
          harnessTelemetry ??
          this.createTelemetry("provider_error", false, 0, "voltagent_unknown"),
        fallback: input.fallback,
        cause: error
      });
    }
  }

  private async failOrFallback<T>(input: {
    message: string;
    telemetry: PaidExecutionTelemetry;
    fallback: () => Promise<T | undefined>;
    cause?: unknown;
  }): Promise<T> {
    const fallbackResult = await input.fallback();
    if (fallbackResult !== undefined) {
      this.lastTelemetry = {
        ...input.telemetry,
        outcomeClass: "degraded_fallback",
        fallbackApplied: true
      };
      return fallbackResult;
    }

    this.lastTelemetry = input.telemetry;
    throw new VoltAgentProviderError(
      input.telemetry.errorCode ?? "voltagent_unknown",
      input.telemetry,
      input.message,
      { cause: input.cause }
    );
  }

  private createTelemetry(
    outcomeClass: PaidExecutionOutcomeClass,
    fallbackApplied: boolean,
    retryCount: number,
    errorCode?: string,
    details?: PaidExecutionTelemetryDetails
  ): PaidExecutionTelemetry {
    return createVoltAgentTelemetry({
      providerId: this.providerId,
      modelId: this.options.model,
      timeoutMs: this.options.timeoutMs,
      outcomeClass,
      fallbackApplied,
      retryCount,
      errorCode,
      details: {
        ...this.roleProfile.telemetryDetails,
        ...details
      }
    });
  }

  private preparePromptOrThrow(
    prompt: string | unknown[] | Record<string, unknown>[]
  ): string {
    if (typeof prompt !== "string") {
      const telemetry = this.createTelemetry(
        "provider_error",
        false,
        0,
        "voltagent_input_guardrail_blocked",
        { blockedByGuardrail: "input" }
      );
      this.lastTelemetry = telemetry;
      throw new VoltAgentProviderError(
        telemetry.errorCode ?? "voltagent_input_guardrail_blocked",
        telemetry,
        "Paid escalation input must be normalized to a string prompt before invocation."
      );
    }

    try {
      assertPaidEscalationInputAllowed(prompt);
      return prompt;
    } catch (error) {
      if (error instanceof VoltAgentRoleProfileGuardrailError) {
        const telemetry = this.createTelemetry(
          "provider_error",
          false,
          0,
          error.code,
          { blockedByGuardrail: error.blockedBy }
        );
        this.lastTelemetry = telemetry;
        throw new VoltAgentProviderError(
          telemetry.errorCode ?? "voltagent_input_guardrail_blocked",
          telemetry,
          error.message,
          { cause: error }
        );
      }

      throw error;
    }
  }
}

function instructionsForTask(task: ReasoningTask): string {
  if (task === "intent") {
    return [
      "You classify engineering memory-retrieval queries.",
      "Return a structured object with the detected intent.",
      "Allowed intents: fact_lookup, decision_lookup, implementation_guidance, status_timeline, debugging, architecture_recall."
    ].join(" ");
  }

  if (task === "answerability") {
    return [
      "You assess whether local context can answer a retrieval query.",
      "Return a structured object with answerability.",
      "Allowed values: local_answer, partial, needs_escalation.",
      "Prefer needs_escalation if evidence is stale, weak, or contradictory."
    ].join(" ");
  }

  return [
    "You produce a single sentence describing remaining uncertainty in local retrieval.",
    "Return a structured object with summary."
  ].join(" ");
}
