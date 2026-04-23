import {
  Agent,
  type AgentModelConfig,
  type AgentHooks,
  type AgentModelValue,
  type InputGuardrail,
  type InputMiddleware,
  type OutputGuardrail,
  type OutputMiddleware
} from "@voltagent/core";
import { classifyProviderError } from "@mimir/application";
import type {
  PaidExecutionOutcomeClass,
  PaidExecutionTelemetry
} from "@mimir/contracts";
import { z } from "zod";

export interface VoltAgentHarnessAgentConfig {
  name: string;
  instructions: string;
  model: string | AgentModelValue;
  memory: false;
  tools: [];
  maxRetries: number;
  markdown: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  hooks: AgentHooks;
  inputMiddlewares: InputMiddleware[];
  outputMiddlewares: OutputMiddleware<any>[];
  inputGuardrails: InputGuardrail[];
  outputGuardrails: OutputGuardrail<any>[];
}

export interface VoltAgentHarnessGenerateObjectOptions {
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
  temperature?: number;
  maxRetries?: number;
}

export interface VoltAgentHarnessAgent {
  generateObject<TSchema extends z.ZodType>(
    input: string,
    schema: TSchema,
    options?: VoltAgentHarnessGenerateObjectOptions
  ): Promise<{ object: z.infer<TSchema> }>;
}

export type VoltAgentHarnessAgentFactory = (
  config: VoltAgentHarnessAgentConfig
) => VoltAgentHarnessAgent;

export interface VoltAgentHarnessRuntimeOptions {
  providerId: string;
  model: string | AgentModelValue;
  fallbackModelIds?: string[];
  timeoutMs: number;
  temperature?: number;
  maxOutputTokens?: number;
  maxRetries?: number;
  hooks?: Partial<AgentHooks>;
  inputMiddlewares?: InputMiddleware[];
  outputMiddlewares?: OutputMiddleware<any>[];
  inputGuardrails?: InputGuardrail[];
  outputGuardrails?: OutputGuardrail<any>[];
  createAgent?: VoltAgentHarnessAgentFactory;
}

export interface VoltAgentHarnessObjectRequest<TSchema extends z.ZodType> {
  taskName: string;
  instructions: string;
  prompt: string;
  schema: TSchema;
  temperature?: number;
  maxOutputTokens?: number;
}

interface HarnessTelemetryState {
  retryCount: number;
  fallbackApplied: boolean;
}

export class VoltAgentHarnessRuntimeError extends Error {
  constructor(
    readonly code: string,
    readonly telemetry: PaidExecutionTelemetry,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "VoltAgentHarnessRuntimeError";
  }
}

export class VoltAgentHarnessRuntime {
  private readonly createAgent: VoltAgentHarnessAgentFactory;
  private lastTelemetry?: PaidExecutionTelemetry;

  constructor(private readonly options: VoltAgentHarnessRuntimeOptions) {
    this.createAgent = options.createAgent ?? createProductionVoltAgent;
  }

  consumePaidExecutionTelemetry(): PaidExecutionTelemetry | undefined {
    const telemetry = this.lastTelemetry;
    this.lastTelemetry = undefined;
    return telemetry;
  }

  async generateObject<TSchema extends z.ZodType>(
    request: VoltAgentHarnessObjectRequest<TSchema>
  ): Promise<z.infer<TSchema>> {
    const telemetryState: HarnessTelemetryState = {
      retryCount: 0,
      fallbackApplied: false
    };
    const maxRetries = this.options.maxRetries ?? 1;
    const agent = this.createAgent({
      name: request.taskName,
      instructions: request.instructions,
      model: this.buildConfiguredModelValue(maxRetries),
      memory: false,
      tools: [],
      maxRetries,
      markdown: false,
      temperature: request.temperature ?? this.options.temperature ?? 0,
      maxOutputTokens:
        request.maxOutputTokens ?? this.options.maxOutputTokens,
      hooks: this.composeHooks(telemetryState),
      inputMiddlewares: [...(this.options.inputMiddlewares ?? [])],
      outputMiddlewares: [...(this.options.outputMiddlewares ?? [])],
      inputGuardrails: [...(this.options.inputGuardrails ?? [])],
      outputGuardrails: [...(this.options.outputGuardrails ?? [])]
    });

    try {
      const result = await agent.generateObject(request.prompt, request.schema, {
        abortSignal: AbortSignal.timeout(this.options.timeoutMs),
        temperature: request.temperature ?? this.options.temperature ?? 0,
        maxOutputTokens:
          request.maxOutputTokens ?? this.options.maxOutputTokens,
        maxRetries
      });

      this.lastTelemetry = this.createTelemetry(
        telemetryState.fallbackApplied ? "degraded_fallback" : "success",
        telemetryState
      );
      return result.object;
    } catch (error) {
      const classified = classifyProviderError(error);
      const telemetry = this.createTelemetry(
        classified.kind === "timeout" ? "timeout" : "provider_error",
        telemetryState,
        mapClassifierToErrorCode(classified.kind)
      );
      this.lastTelemetry = telemetry;
      throw new VoltAgentHarnessRuntimeError(
        telemetry.errorCode ?? "voltagent_unknown",
        telemetry,
        classified.message,
        { cause: error }
      );
    }
  }

  private composeHooks(state: HarnessTelemetryState): AgentHooks {
    const external = this.options.hooks;

    return {
      ...external,
      onRetry: async (args) => {
        state.retryCount = Math.max(
          state.retryCount,
          args.source === "llm" ? args.nextAttempt : args.retryCount
        );
        await external?.onRetry?.(args);
      },
      onFallback: async (args) => {
        state.fallbackApplied = true;
        await external?.onFallback?.(args);
      },
      onError: async (args) => {
        await external?.onError?.(args);
      },
      onStart: async (args) => {
        await external?.onStart?.(args);
      },
      onEnd: async (args) => {
        await external?.onEnd?.(args);
      },
      onPrepareMessages: async (args) => {
        return (await external?.onPrepareMessages?.(args)) ?? {};
      },
      onPrepareModelMessages: async (args) => {
        return (await external?.onPrepareModelMessages?.(args)) ?? {};
      },
      onToolStart: async (args) => {
        await external?.onToolStart?.(args);
      },
      onToolEnd: (args) => external?.onToolEnd?.(args),
      onToolError: (args) => external?.onToolError?.(args),
      onStepFinish: async (args) => {
        await external?.onStepFinish?.(args);
      },
      onHandoff: async (args) => {
        await external?.onHandoff?.(args);
      },
      onHandoffComplete: async (args) => {
        await external?.onHandoffComplete?.(args);
      }
    };
  }

  private createTelemetry(
    outcomeClass: PaidExecutionOutcomeClass,
    state: HarnessTelemetryState,
    errorCode?: string
  ): PaidExecutionTelemetry {
    return {
      providerId: this.options.providerId,
      modelId:
        typeof this.options.model === "string" ? this.options.model : undefined,
      timeoutMs: this.options.timeoutMs,
      outcomeClass,
      fallbackApplied: state.fallbackApplied,
      retryCount: state.retryCount,
      ...(errorCode ? { errorCode } : {})
    };
  }

  private buildConfiguredModelValue(maxRetries: number): AgentModelValue {
    const fallbackModelIds = this.options.fallbackModelIds ?? [];
    if (fallbackModelIds.length === 0 || Array.isArray(this.options.model)) {
      return this.options.model as AgentModelValue;
    }

    const configuredModels: AgentModelConfig[] = [
      {
        id: "primary",
        model: this.options.model,
        maxRetries
      },
      ...fallbackModelIds.map((modelId, index) => ({
        id: `fallback_${index + 1}`,
        model: modelId,
        maxRetries,
        enabled: true
      }))
    ];
    return configuredModels;
  }
}

function createProductionVoltAgent(
  config: VoltAgentHarnessAgentConfig
): VoltAgentHarnessAgent {
  return new Agent({
    name: config.name,
    instructions: config.instructions,
    model: config.model as AgentModelValue,
    memory: config.memory,
    tools: config.tools,
    maxRetries: config.maxRetries,
    markdown: config.markdown,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    hooks: config.hooks,
    inputMiddlewares: config.inputMiddlewares,
    outputMiddlewares: config.outputMiddlewares,
    inputGuardrails: config.inputGuardrails,
    outputGuardrails: config.outputGuardrails
  }) as VoltAgentHarnessAgent;
}

function mapClassifierToErrorCode(
  kind: ReturnType<typeof classifyProviderError>["kind"]
): string {
  switch (kind) {
    case "auth":
      return "voltagent_auth";
    case "context_length":
      return "voltagent_context_length";
    case "model_not_found":
      return "voltagent_model_not_found";
    case "rate_limit":
      return "voltagent_rate_limit";
    case "server":
      return "voltagent_server";
    case "timeout":
      return "voltagent_timeout";
    case "transport":
      return "voltagent_transport";
    default:
      return "voltagent_unknown";
  }
}
