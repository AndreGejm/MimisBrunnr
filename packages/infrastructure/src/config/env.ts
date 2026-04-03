import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ModelRole,
  ModelRoleBinding
} from "@multi-agent-brain/orchestration";

const DEFAULT_WORKSPACE_ROOT = fileURLToPath(
  new URL("../../../../", import.meta.url)
);
const DEFAULT_WINDOWS_CANONICAL_VAULT_ROOT = "F:\\Dev\\AI Context Brain";
const DEFAULT_CANONICAL_VAULT_ROOT =
  process.platform === "win32"
    ? DEFAULT_WINDOWS_CANONICAL_VAULT_ROOT
    : "./vault/canonical";
const DEFAULT_STAGING_ROOT = "./vault/staging";
const DEFAULT_SQLITE_PATH = "./state/multi-agent-brain.sqlite";

export interface AppEnvironment {
  nodeEnv: "development" | "test" | "production";
  vaultRoot: string;
  stagingRoot: string;
  sqlitePath: string;
  qdrantUrl: string;
  qdrantCollection: string;
  ollamaBaseUrl: string;
  ollamaEmbeddingModel: string;
  ollamaReasoningModel: string;
  ollamaDraftingModel: string;
  embeddingProvider: "disabled" | "hash" | "ollama";
  reasoningProvider: "disabled" | "heuristic" | "ollama";
  draftingProvider: "disabled" | "ollama";
  rerankerProvider: "disabled" | "local" | "ollama";
  providerEndpoints: {
    dockerOllamaBaseUrl: string;
    paidEscalationBaseUrl?: string;
  };
  roleBindings: Record<ModelRole, ModelRoleBinding>;
  codingRuntimePythonExecutable: string;
  codingRuntimePythonPath: string;
  codingRuntimeModule: string;
  codingRuntimeTimeoutMs: number;
  apiHost: string;
  apiPort: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function coalesceString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()));
}

export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  return normalizeEnvironment({
    nodeEnv: (env.MAB_NODE_ENV as AppEnvironment["nodeEnv"]) ?? "development",
    vaultRoot: env.MAB_VAULT_ROOT ?? DEFAULT_CANONICAL_VAULT_ROOT,
    stagingRoot: env.MAB_STAGING_ROOT ?? DEFAULT_STAGING_ROOT,
    sqlitePath: env.MAB_SQLITE_PATH ?? DEFAULT_SQLITE_PATH,
    qdrantUrl: env.MAB_QDRANT_URL ?? "http://127.0.0.1:6333",
    qdrantCollection: env.MAB_QDRANT_COLLECTION ?? "context_brain_chunks",
    ollamaBaseUrl: env.MAB_OLLAMA_BASE_URL ?? "http://127.0.0.1:12434",
    ollamaEmbeddingModel: env.MAB_OLLAMA_EMBEDDING_MODEL ?? "docker.io/ai/qwen3-embedding:0.6B-F16",
    ollamaReasoningModel: env.MAB_OLLAMA_REASONING_MODEL ?? "qwen3:4B-F16",
    ollamaDraftingModel: env.MAB_OLLAMA_DRAFTING_MODEL ?? env.MAB_OLLAMA_REASONING_MODEL ?? "qwen3:4B-F16",
    embeddingProvider: (env.MAB_EMBEDDING_PROVIDER as AppEnvironment["embeddingProvider"]) ?? "hash",
    reasoningProvider: (env.MAB_REASONING_PROVIDER as AppEnvironment["reasoningProvider"]) ?? "heuristic",
    draftingProvider: (env.MAB_DRAFTING_PROVIDER as AppEnvironment["draftingProvider"]) ?? "ollama",
    rerankerProvider: (env.MAB_RERANKER_PROVIDER as AppEnvironment["rerankerProvider"]) ?? "ollama",
    providerEndpoints: {
      dockerOllamaBaseUrl:
        env.MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL ??
        env.MAB_OLLAMA_BASE_URL ??
        "http://127.0.0.1:12434",
      paidEscalationBaseUrl: env.MAB_PROVIDER_PAID_ESCALATION_BASE_URL
    },
    roleBindings: buildRoleBindingsFromProcessEnvironment(env),
    codingRuntimePythonExecutable:
      env.MAB_CODING_RUNTIME_PYTHON_EXECUTABLE ??
      (process.platform === "win32" ? "py" : "python3"),
    codingRuntimePythonPath:
      env.MAB_CODING_RUNTIME_PYTHONPATH ??
      path.join(DEFAULT_WORKSPACE_ROOT, "runtimes"),
    codingRuntimeModule:
      env.MAB_CODING_RUNTIME_MODULE ?? "local_experts.bridge",
    codingRuntimeTimeoutMs: parsePort(env.MAB_CODING_RUNTIME_TIMEOUT_MS, 120000),
    apiHost: env.MAB_API_HOST ?? "127.0.0.1",
    apiPort: parsePort(env.MAB_API_PORT, 8080),
    logLevel: (env.MAB_LOG_LEVEL as AppEnvironment["logLevel"]) ?? "info"
  });
}

export function normalizeEnvironment(input: Partial<AppEnvironment>): AppEnvironment {
  const providerEndpoints = {
    dockerOllamaBaseUrl:
      input.providerEndpoints?.dockerOllamaBaseUrl ??
      input.ollamaBaseUrl ??
      "http://127.0.0.1:12434",
    paidEscalationBaseUrl: input.providerEndpoints?.paidEscalationBaseUrl
  };

  const baseEnvironment: AppEnvironment = {
    nodeEnv: input.nodeEnv ?? "development",
    vaultRoot: input.vaultRoot ?? DEFAULT_CANONICAL_VAULT_ROOT,
    stagingRoot: input.stagingRoot ?? DEFAULT_STAGING_ROOT,
    sqlitePath: input.sqlitePath ?? DEFAULT_SQLITE_PATH,
    qdrantUrl: input.qdrantUrl ?? "http://127.0.0.1:6333",
    qdrantCollection: input.qdrantCollection ?? "context_brain_chunks",
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
    providerEndpoints,
    roleBindings: buildRoleBindingsFromLegacy(input, providerEndpoints.dockerOllamaBaseUrl),
    codingRuntimePythonExecutable:
      input.codingRuntimePythonExecutable ??
      (process.platform === "win32" ? "py" : "python3"),
    codingRuntimePythonPath:
      input.codingRuntimePythonPath ??
      path.join(DEFAULT_WORKSPACE_ROOT, "runtimes"),
    codingRuntimeModule:
      input.codingRuntimeModule ?? "local_experts.bridge",
    codingRuntimeTimeoutMs: input.codingRuntimeTimeoutMs ?? 120_000,
    apiHost: input.apiHost ?? "127.0.0.1",
    apiPort: input.apiPort ?? 8080,
    logLevel: input.logLevel ?? "info"
  };

  baseEnvironment.roleBindings = mergeRoleBindings(
    baseEnvironment.roleBindings,
    input.roleBindings
  );
  baseEnvironment.ollamaEmbeddingModel =
    baseEnvironment.roleBindings.embedding_primary.modelId ??
    baseEnvironment.ollamaEmbeddingModel;
  baseEnvironment.ollamaReasoningModel =
    baseEnvironment.roleBindings.brain_primary.modelId ??
    baseEnvironment.ollamaReasoningModel;
  baseEnvironment.ollamaDraftingModel =
    baseEnvironment.roleBindings.brain_primary.modelId ??
    baseEnvironment.ollamaDraftingModel;

  return baseEnvironment;
}

function buildRoleBindingsFromProcessEnvironment(
  env: NodeJS.ProcessEnv
): Record<ModelRole, ModelRoleBinding> {
  const legacy = normalizeEnvironment({
    ollamaBaseUrl: env.MAB_OLLAMA_BASE_URL,
    ollamaEmbeddingModel: env.MAB_OLLAMA_EMBEDDING_MODEL,
    ollamaReasoningModel: env.MAB_OLLAMA_REASONING_MODEL,
    ollamaDraftingModel: env.MAB_OLLAMA_DRAFTING_MODEL,
    embeddingProvider: env.MAB_EMBEDDING_PROVIDER as AppEnvironment["embeddingProvider"] | undefined,
    reasoningProvider: env.MAB_REASONING_PROVIDER as AppEnvironment["reasoningProvider"] | undefined,
    draftingProvider: env.MAB_DRAFTING_PROVIDER as AppEnvironment["draftingProvider"] | undefined,
    rerankerProvider: env.MAB_RERANKER_PROVIDER as AppEnvironment["rerankerProvider"] | undefined,
    providerEndpoints: {
      dockerOllamaBaseUrl:
        env.MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL ??
        env.MAB_OLLAMA_BASE_URL ??
        "http://127.0.0.1:12434",
      paidEscalationBaseUrl: env.MAB_PROVIDER_PAID_ESCALATION_BASE_URL
    }
  }).roleBindings;

  return mergeRoleBindings(legacy, {
    coding_primary: buildRoleBindingOverride(env, "coding_primary"),
    brain_primary: buildRoleBindingOverride(env, "brain_primary"),
    embedding_primary: buildRoleBindingOverride(env, "embedding_primary"),
    reranker_primary: buildRoleBindingOverride(env, "reranker_primary"),
    paid_escalation: buildRoleBindingOverride(env, "paid_escalation")
  });
}

function buildRoleBindingOverride(
  env: NodeJS.ProcessEnv,
  role: ModelRole
): ModelRoleBinding | undefined {
  const prefix = `MAB_ROLE_${role.toUpperCase()}`;
  const providerId = env[`${prefix}_PROVIDER`];
  const modelId = env[`${prefix}_MODEL`];
  const temperature = parseOptionalNumber(env[`${prefix}_TEMPERATURE`]);
  const seed = parseOptionalNumber(env[`${prefix}_SEED`]);
  const timeoutMs = parseOptionalNumber(env[`${prefix}_TIMEOUT_MS`]);
  const maxInputChars = parseOptionalNumber(env[`${prefix}_MAX_INPUT_CHARS`]);
  const maxOutputTokens = parseOptionalNumber(env[`${prefix}_MAX_OUTPUT_TOKENS`]);

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
  input: Partial<AppEnvironment>,
  ollamaBaseUrl: string
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

  const brainModel = coalesceString(
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
    brain_primary: {
      role: "brain_primary",
      providerId: draftingProviderId !== "disabled" ? draftingProviderId : reasoningProviderId,
      modelId: brainModel,
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
      providerId: input.providerEndpoints?.paidEscalationBaseUrl ? "paid_openai_compat" : "disabled",
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
