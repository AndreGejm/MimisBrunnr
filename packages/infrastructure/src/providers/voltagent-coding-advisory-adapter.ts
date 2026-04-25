import type { CodingAdvisoryProvider } from "@mimir/application";
import type {
  CodingAdvisoryResult,
  ExecuteCodingTaskRequest,
  ExecuteCodingTaskResponse,
  PaidExecutionTelemetryDetails,
  PaidExecutionTelemetry
} from "@mimir/contracts";
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
  assertCodingAdvisoryInputAllowed,
  assertCodingAdvisoryOutputAllowed,
  buildCodingAdvisoryVoltAgentProfile,
  normalizeCodingAdvisoryOutput,
  normalizeCodingAdvisoryPromptPayload
} from "./voltagent-role-profile.js";

const CODING_ADVISORY_ACTIONS = [
  "retry_local",
  "manual_followup",
  "external_escalation"
] as const;

export interface VoltAgentCodingAdvisoryAdapterOptions {
  model: string;
  fallbackModelIds?: string[];
  timeoutMs: number;
  temperature?: number;
  maxOutputTokens?: number;
  createAgent?: VoltAgentHarnessAgentFactory;
  credentialEnv?: NodeJS.ProcessEnv;
}

export class VoltAgentCodingAdvisoryAdapter implements CodingAdvisoryProvider {
  readonly providerId = "voltagent_agent";

  private readonly credentialEnv: NodeJS.ProcessEnv;
  private readonly roleProfile = buildCodingAdvisoryVoltAgentProfile();
  private readonly runtime: VoltAgentHarnessRuntime;
  private lastTelemetry?: PaidExecutionTelemetry;

  constructor(private readonly options: VoltAgentCodingAdvisoryAdapterOptions) {
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

  async adviseOnEscalation(input: {
    request: ExecuteCodingTaskRequest;
    localResponse: ExecuteCodingTaskResponse;
  }): Promise<CodingAdvisoryResult> {
    const configuredModelIds = [
      this.options.model,
      ...(this.options.fallbackModelIds ?? [])
    ];
    const invalidModelId = configuredModelIds.find(
      (modelId) => !parseVoltAgentProviderModel(modelId)
    );
    if (invalidModelId) {
      const telemetry = this.createTelemetry(
        "unsupported_model",
        "voltagent_invalid_model_id"
      );
      this.lastTelemetry = telemetry;
      throw new VoltAgentProviderError(
        telemetry.errorCode ?? "voltagent_invalid_model_id",
        telemetry,
        "VoltAgent requires provider-prefixed model ids such as 'openai/gpt-4.1-mini'."
      );
    }

    const missingCredential = findMissingVoltAgentCredentialForModels(
      configuredModelIds,
      this.credentialEnv
    );
    if (missingCredential) {
      const telemetry = this.createTelemetry(
        "invalid_configuration",
        `voltagent_missing_${missingCredential.toLowerCase()}`
      );
      this.lastTelemetry = telemetry;
      throw new VoltAgentProviderError(
        telemetry.errorCode ?? "voltagent_invalid_configuration",
        telemetry,
        `VoltAgent model '${this.options.model}' requires ${missingCredential}.`
      );
    }

    try {
      const prompt = JSON.stringify(
        normalizeCodingAdvisoryPromptPayload(
          buildCodingAdvisoryPrompt(input.request, input.localResponse)
        ),
        null,
        2
      );
      assertCodingAdvisoryInputAllowed(prompt);

      const result = await this.runtime.generateObject({
        taskName: "mimir-coding-advisory",
        instructions: [
          "You are a post-escalation coding advisory agent.",
          "The local coding runtime already tried the task and returned an escalation result.",
          "Do not claim the task is fixed and do not emit a patch.",
          "Recommend exactly one next action.",
          "Keep the summary concise and the suggested checks concrete."
        ].join(" "),
        prompt,
        schema: z.object({
          recommendedAction: z.enum(CODING_ADVISORY_ACTIONS),
          summary: z.string().trim().min(1),
          suggestedChecks: z.array(z.string().trim().min(1)).min(1).max(5)
        }),
        maxOutputTokens: 220
      });

      this.lastTelemetry = this.runtime.consumePaidExecutionTelemetry();
      const advisory = normalizeCodingAdvisoryOutput(result);
      assertCodingAdvisoryOutputAllowed(advisory);
      return {
        invoked: true,
        modelRole: "coding_advisory",
        providerId: this.providerId,
        modelId: this.options.model,
        recommendedAction: advisory.recommendedAction,
        summary: advisory.summary,
        suggestedChecks: advisory.suggestedChecks
      };
    } catch (error) {
      const telemetry =
        error instanceof VoltAgentRoleProfileGuardrailError
          ? this.createTelemetry("provider_error", error.code, {
              blockedByGuardrail: error.blockedBy
            })
          : error instanceof VoltAgentHarnessRuntimeError
          ? error.telemetry
          : this.runtime.consumePaidExecutionTelemetry() ??
            this.createTelemetry("provider_error", "voltagent_unknown");
      this.lastTelemetry = telemetry;
      throw new VoltAgentProviderError(
        telemetry.errorCode ?? "voltagent_unknown",
        telemetry,
        error instanceof Error ? error.message : String(error),
        { cause: error }
      );
    }
  }

  buildUnavailableTelemetry(errorCode = "voltagent_scaffold_disabled"): PaidExecutionTelemetry {
    return this.createTelemetry("disabled", errorCode);
  }

  private createTelemetry(
    outcomeClass: PaidExecutionTelemetry["outcomeClass"],
    errorCode?: string,
    details?: PaidExecutionTelemetryDetails
  ): PaidExecutionTelemetry {
    return createVoltAgentTelemetry({
      providerId: this.providerId,
      modelId: this.options.model,
      timeoutMs: this.options.timeoutMs,
      outcomeClass,
      fallbackApplied: false,
      retryCount: 0,
      errorCode,
      details: {
        ...this.roleProfile.telemetryDetails,
        ...details
      }
    });
  }
}

function buildCodingAdvisoryPrompt(
  request: ExecuteCodingTaskRequest,
  localResponse: ExecuteCodingTaskResponse
): Record<string, unknown> {
  return {
    taskType: request.taskType,
    task: request.task,
    context: request.context ?? undefined,
    repoRoot: request.repoRoot,
    filePath: request.filePath,
    symbolName: request.symbolName,
    pytestTarget: request.pytestTarget,
    lintTarget: request.lintTarget,
    memoryContextStatus: request.memoryContextStatus,
    localResponse: {
      status: localResponse.status,
      reason: localResponse.reason,
      attempts: localResponse.attempts,
      validations: localResponse.validations?.slice(0, 3).map((validation) => ({
        success: validation.success,
        step: validation.step,
        exitCode: validation.exitCode,
        stdout: truncateText(validation.stdout),
        stderr: truncateText(validation.stderr)
      })),
      escalationMetadata: localResponse.escalationMetadata
    }
  };
}

function truncateText(value: string | undefined, maxLength = 600): string | undefined {
  if (!value) {
    return value;
  }

  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}
