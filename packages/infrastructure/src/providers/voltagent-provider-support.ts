import type {
  PaidExecutionOutcomeClass,
  PaidExecutionTelemetry
} from "@mimir/contracts";

export interface ParsedVoltAgentProviderModel {
  providerPrefix: string;
}

export const VOLTAGENT_PROVIDER_ENV_REQUIREMENTS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  xai: ["XAI_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"]
};

export class VoltAgentProviderError extends Error {
  constructor(
    readonly code: string,
    readonly telemetry: PaidExecutionTelemetry,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "VoltAgentProviderError";
  }
}

export function parseVoltAgentProviderModel(
  model: string
): ParsedVoltAgentProviderModel | undefined {
  const trimmed = model.trim();
  const separatorIndex = trimmed.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return undefined;
  }

  return {
    providerPrefix: trimmed.slice(0, separatorIndex)
  };
}

export function findMissingVoltAgentCredential(
  providerPrefix: string,
  credentialEnv: NodeJS.ProcessEnv
): string | undefined {
  const requiredEnvVars = VOLTAGENT_PROVIDER_ENV_REQUIREMENTS[providerPrefix];
  if (!requiredEnvVars || requiredEnvVars.length === 0) {
    return undefined;
  }

  const hasCredential = requiredEnvVars.some((envName) => {
    const value = credentialEnv[envName];
    return typeof value === "string" && value.trim().length > 0;
  });
  if (hasCredential) {
    return undefined;
  }

  return requiredEnvVars[0];
}

export function findMissingVoltAgentCredentialForModels(
  modelIds: string[],
  credentialEnv: NodeJS.ProcessEnv
): string | undefined {
  for (const modelId of modelIds) {
    const parsed = parseVoltAgentProviderModel(modelId);
    if (!parsed) {
      continue;
    }

    const missingCredential = findMissingVoltAgentCredential(
      parsed.providerPrefix,
      credentialEnv
    );
    if (missingCredential) {
      return missingCredential;
    }
  }

  return undefined;
}

export function createVoltAgentTelemetry(input: {
  providerId: string;
  modelId?: string;
  timeoutMs: number;
  outcomeClass: PaidExecutionOutcomeClass;
  fallbackApplied: boolean;
  retryCount: number;
  errorCode?: string;
}): PaidExecutionTelemetry {
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    timeoutMs: input.timeoutMs,
    outcomeClass: input.outcomeClass,
    fallbackApplied: input.fallbackApplied,
    retryCount: input.retryCount,
    ...(input.errorCode ? { errorCode: input.errorCode } : {})
  };
}
