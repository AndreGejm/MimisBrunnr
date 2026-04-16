import type { ModelRole, ModelRoleBinding } from "@mimir/orchestration";
import type { AppEnvironment } from "./app-environment.js";
import {
  coalesceString,
  parseBoolean,
  parseOptionalNumber
} from "./config-helpers.js";

export type ProviderConfig = Pick<
  AppEnvironment,
  | "ollamaBaseUrl"
  | "ollamaEmbeddingModel"
  | "ollamaReasoningModel"
  | "ollamaDraftingModel"
  | "embeddingProvider"
  | "reasoningProvider"
  | "draftingProvider"
  | "rerankerProvider"
  | "disableProviderFallbacks"
  | "providerEndpoints"
  | "roleBindings"
>;

export function loadProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): ProviderConfig {
  return normalizeProviderConfig({
    ollamaBaseUrl: env.MAB_OLLAMA_BASE_URL ?? "http://127.0.0.1:12434",
    ollamaEmbeddingModel:
      env.MAB_OLLAMA_EMBEDDING_MODEL ?? "docker.io/ai/qwen3-embedding:0.6B-F16",
    ollamaReasoningModel: env.MAB_OLLAMA_REASONING_MODEL ?? "qwen3:4B-F16",
    ollamaDraftingModel:
      env.MAB_OLLAMA_DRAFTING_MODEL ??
      env.MAB_OLLAMA_REASONING_MODEL ??
      "qwen3:4B-F16",
    embeddingProvider:
      (env.MAB_EMBEDDING_PROVIDER as AppEnvironment["embeddingProvider"]) ?? "hash",
    reasoningProvider:
      (env.MAB_REASONING_PROVIDER as AppEnvironment["reasoningProvider"]) ??
      "heuristic",
    draftingProvider:
      (env.MAB_DRAFTING_PROVIDER as AppEnvironment["draftingProvider"]) ?? "ollama",
    rerankerProvider:
      (env.MAB_RERANKER_PROVIDER as AppEnvironment["rerankerProvider"]) ?? "ollama",
    disableProviderFallbacks: parseBoolean(
      env.MAB_DISABLE_PROVIDER_FALLBACKS,
      false
    ),
    providerEndpoints: loadProviderEndpoints(env),
    roleBindings: buildRoleBindingsFromProcessEnvironment(env)
  });
}

export function normalizeProviderConfig(
  input: Partial<AppEnvironment>
): ProviderConfig {
  const providerEndpoints = normalizeProviderEndpoints(input);
  const providerConfig: ProviderConfig = {
    ollamaBaseUrl: input.ollamaBaseUrl ?? providerEndpoints.dockerOllamaBaseUrl,
    ollamaEmbeddingModel:
      input.ollamaEmbeddingModel ?? "docker.io/ai/qwen3-embedding:0.6B-F16",
    ollamaReasoningModel: input.ollamaReasoningModel ?? "qwen3:4B-F16",
    ollamaDraftingModel:
      input.ollamaDraftingModel ??
      input.ollamaReasoningModel ??
      "qwen3:4B-F16",
    embeddingProvider: input.embeddingProvider ?? "hash",
    reasoningProvider: input.reasoningProvider ?? "heuristic",
    draftingProvider: input.draftingProvider ?? "ollama",
    rerankerProvider: input.rerankerProvider ?? "ollama",
    disableProviderFallbacks: input.disableProviderFallbacks ?? false,
    providerEndpoints,
    roleBindings: mergeRoleBindings(
      buildRoleBindingsFromLegacy(input),
      input.roleBindings
    )
  };

  providerConfig.ollamaEmbeddingModel =
    providerConfig.roleBindings.embedding_primary.modelId ??
    providerConfig.ollamaEmbeddingModel;
  providerConfig.ollamaReasoningModel =
    providerConfig.roleBindings.mimisbrunnr_primary.modelId ??
    providerConfig.ollamaReasoningModel;
  providerConfig.ollamaDraftingModel =
    providerConfig.roleBindings.mimisbrunnr_primary.modelId ??
    providerConfig.ollamaDraftingModel;

  return providerConfig;
}

function loadProviderEndpoints(
  env: NodeJS.ProcessEnv
): AppEnvironment["providerEndpoints"] {
  return {
    dockerOllamaBaseUrl:
      env.MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL ??
      env.MAB_OLLAMA_BASE_URL ??
      "http://127.0.0.1:12434",
    paidEscalationBaseUrl: env.MAB_PROVIDER_PAID_ESCALATION_BASE_URL,
    paidEscalationApiKey: env.MAB_PROVIDER_PAID_ESCALATION_API_KEY
  };
}

function normalizeProviderEndpoints(
  input: Partial<AppEnvironment>
): AppEnvironment["providerEndpoints"] {
  return {
    dockerOllamaBaseUrl:
      input.providerEndpoints?.dockerOllamaBaseUrl ??
      input.ollamaBaseUrl ??
      "http://127.0.0.1:12434",
    paidEscalationBaseUrl: input.providerEndpoints?.paidEscalationBaseUrl,
    paidEscalationApiKey: input.providerEndpoints?.paidEscalationApiKey
  };
}

function buildRoleBindingsFromProcessEnvironment(
  env: NodeJS.ProcessEnv
): Record<ModelRole, ModelRoleBinding> {
  const legacy = normalizeProviderConfig({
    ollamaBaseUrl: env.MAB_OLLAMA_BASE_URL,
    ollamaEmbeddingModel: env.MAB_OLLAMA_EMBEDDING_MODEL,
    ollamaReasoningModel: env.MAB_OLLAMA_REASONING_MODEL,
    ollamaDraftingModel: env.MAB_OLLAMA_DRAFTING_MODEL,
    embeddingProvider:
      env.MAB_EMBEDDING_PROVIDER as AppEnvironment["embeddingProvider"] | undefined,
    reasoningProvider:
      env.MAB_REASONING_PROVIDER as AppEnvironment["reasoningProvider"] | undefined,
    draftingProvider:
      env.MAB_DRAFTING_PROVIDER as AppEnvironment["draftingProvider"] | undefined,
    rerankerProvider:
      env.MAB_RERANKER_PROVIDER as AppEnvironment["rerankerProvider"] | undefined,
    providerEndpoints: loadProviderEndpoints(env)
  }).roleBindings;

  return mergeRoleBindings(legacy, {
    coding_primary: buildRoleBindingOverride(env, "coding_primary"),
    mimisbrunnr_primary: buildRoleBindingOverride(env, "mimisbrunnr_primary", [
      "MAB_ROLE_MIMIR_BRUNNR_PRIMARY"
    ]),
    embedding_primary: buildRoleBindingOverride(env, "embedding_primary"),
    reranker_primary: buildRoleBindingOverride(env, "reranker_primary"),
    paid_escalation: buildRoleBindingOverride(env, "paid_escalation")
  });
}

function buildRoleBindingOverride(
  env: NodeJS.ProcessEnv,
  role: ModelRole,
  aliasPrefixes: string[] = []
): ModelRoleBinding | undefined {
  const prefix = `MAB_ROLE_${role.toUpperCase()}`;
  const readValue = (suffix: string): string | undefined =>
    coalesceString(
      env[`${prefix}_${suffix}`],
      ...aliasPrefixes.map((aliasPrefix) => env[`${aliasPrefix}_${suffix}`])
    );
  const providerId = readValue("PROVIDER");
  const modelId = readValue("MODEL");
  const temperature = parseOptionalNumber(readValue("TEMPERATURE"));
  const seed = parseOptionalNumber(readValue("SEED"));
  const timeoutMs = parseOptionalNumber(readValue("TIMEOUT_MS"));
  const maxInputChars = parseOptionalNumber(readValue("MAX_INPUT_CHARS"));
  const maxOutputTokens = parseOptionalNumber(readValue("MAX_OUTPUT_TOKENS"));

  if (
    !providerId &&
    !modelId &&
    temperature === undefined &&
    seed === undefined &&
    timeoutMs === undefined &&
    maxInputChars === undefined &&
    maxOutputTokens === undefined
  ) {
    return undefined;
  }

  return {
    role,
    providerId: providerId ?? "disabled",
    modelId,
    temperature: temperature ?? 0,
    seed,
    timeoutMs: timeoutMs ?? 30_000,
    maxInputChars,
    maxOutputTokens
  };
}

function buildRoleBindingsFromLegacy(
  input: Partial<AppEnvironment>
): Record<ModelRole, ModelRoleBinding> {
  const embeddingProviderId =
    input.embeddingProvider === "disabled"
      ? "disabled"
      : input.embeddingProvider === "hash"
        ? "internal_hash"
        : "docker_ollama";
  const reasoningProviderId =
    input.reasoningProvider === "disabled"
      ? "disabled"
      : input.reasoningProvider === "heuristic"
        ? "internal_heuristic"
        : "docker_ollama";
  const draftingProviderId =
    input.draftingProvider === "disabled" ? "disabled" : "docker_ollama";
  const rerankerProviderId =
    input.rerankerProvider === "disabled"
      ? "disabled"
      : input.rerankerProvider === "local"
        ? "internal_heuristic"
        : "docker_ollama";

  const mimisbrunnrModel = coalesceString(
    input.ollamaReasoningModel,
    input.ollamaDraftingModel,
    "qwen3:4B-F16"
  );

  return {
    coding_primary: {
      role: "coding_primary",
      providerId: "docker_ollama",
      modelId: "qwen3-coder",
      temperature: 0,
      seed: 42,
      timeoutMs: 120_000,
      maxInputChars: 30_000,
      maxOutputTokens: 4_000
    },
    mimisbrunnr_primary: {
      role: "mimisbrunnr_primary",
      providerId:
        draftingProviderId !== "disabled" ? draftingProviderId : reasoningProviderId,
      modelId: mimisbrunnrModel,
      temperature: 0,
      seed: 42,
      timeoutMs: 30_000,
      maxInputChars: 18_000,
      maxOutputTokens: 1_200
    },
    embedding_primary: {
      role: "embedding_primary",
      providerId: embeddingProviderId,
      modelId:
        input.ollamaEmbeddingModel ?? "docker.io/ai/qwen3-embedding:0.6B-F16",
      temperature: 0,
      timeoutMs: 15_000
    },
    reranker_primary: {
      role: "reranker_primary",
      providerId: rerankerProviderId,
      modelId: "qwen3-reranker",
      temperature: 0,
      seed: 42,
      timeoutMs: 20_000,
      maxInputChars: 12_000,
      maxOutputTokens: 300
    },
    paid_escalation: {
      role: "paid_escalation",
      providerId: input.providerEndpoints?.paidEscalationBaseUrl
        ? "paid_openai_compat"
        : "disabled",
      modelId: undefined,
      temperature: 0,
      timeoutMs: 60_000
    }
  };
}

function mergeRoleBindings(
  base: Record<ModelRole, ModelRoleBinding>,
  overrides?: Partial<Record<ModelRole, ModelRoleBinding>>
): Record<ModelRole, ModelRoleBinding> {
  if (!overrides) {
    return base;
  }

  const merged = { ...base };
  for (const role of Object.keys(overrides) as ModelRole[]) {
    const override = overrides[role];
    if (!override) {
      continue;
    }

    merged[role] = {
      ...base[role],
      ...override
    };
  }

  return merged;
}