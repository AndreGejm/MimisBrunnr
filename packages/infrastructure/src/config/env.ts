import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ActorAuthorizationMode,
  ActorRegistryEntry,
  ModelRole,
  ModelRoleBinding
} from "@multi-agent-brain/orchestration";
import {
  loadReleaseMetadata,
  type ReleaseMetadata
} from "./release-metadata.js";

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
  release: ReleaseMetadata;
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
    paidEscalationApiKey?: string;
  };
  roleBindings: Record<ModelRole, ModelRoleBinding>;
  codingRuntimePythonExecutable: string;
  codingRuntimePythonPath: string;
  codingRuntimeModule: string;
  codingRuntimeTimeoutMs: number;
  apiHost: string;
  apiPort: number;
  logLevel: "debug" | "info" | "warn" | "error";
  auth: {
    mode: ActorAuthorizationMode;
    allowAnonymousInternal: boolean;
    actorRegistryPath?: string;
    actorRegistry: ActorRegistryEntry[];
    issuerSecret?: string;
    issuedTokenRequireRegistryMatch: boolean;
    issuedTokenRevocationPath?: string;
    revokedIssuedTokenIds: string[];
  };
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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function coalesceString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()));
}

export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const actorRegistryPath = env.MAB_AUTH_ACTOR_REGISTRY_PATH?.trim() || undefined;
  const issuedTokenRevocationPath =
    env.MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH?.trim() || undefined;
  return normalizeEnvironment({
    nodeEnv: (env.MAB_NODE_ENV as AppEnvironment["nodeEnv"]) ?? "development",
    release: loadReleaseMetadata(env),
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
      paidEscalationBaseUrl: env.MAB_PROVIDER_PAID_ESCALATION_BASE_URL,
      paidEscalationApiKey: env.MAB_PROVIDER_PAID_ESCALATION_API_KEY
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
    logLevel: (env.MAB_LOG_LEVEL as AppEnvironment["logLevel"]) ?? "info",
    auth: {
      mode:
        (env.MAB_AUTH_MODE as ActorAuthorizationMode | undefined) ??
        (env.MAB_NODE_ENV === "production" ? "enforced" : "permissive"),
      allowAnonymousInternal: parseBoolean(
        env.MAB_AUTH_ALLOW_ANONYMOUS_INTERNAL,
        true
      ),
      actorRegistryPath,
      actorRegistry: mergeActorRegistryEntries(
        loadActorRegistryFromPath(actorRegistryPath),
        parseActorRegistry(env.MAB_AUTH_ACTOR_REGISTRY_JSON)
      ),
      issuerSecret: env.MAB_AUTH_ISSUER_SECRET?.trim() || undefined,
      issuedTokenRequireRegistryMatch: parseBoolean(
        env.MAB_AUTH_ISSUED_TOKEN_REQUIRE_REGISTRY_MATCH,
        true
      ),
      issuedTokenRevocationPath,
      revokedIssuedTokenIds: mergeRevokedIssuedTokenIds(
        loadRevokedIssuedTokenIdsFromPath(issuedTokenRevocationPath),
        parseRevokedIssuedTokenIds(env.MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_JSON)
      )
    }
  });
}

export function normalizeEnvironment(input: Partial<AppEnvironment>): AppEnvironment {
  const providerEndpoints = {
    dockerOllamaBaseUrl:
      input.providerEndpoints?.dockerOllamaBaseUrl ??
      input.ollamaBaseUrl ??
      "http://127.0.0.1:12434",
    paidEscalationBaseUrl: input.providerEndpoints?.paidEscalationBaseUrl,
    paidEscalationApiKey: input.providerEndpoints?.paidEscalationApiKey
  };

  const baseEnvironment: AppEnvironment = {
    nodeEnv: input.nodeEnv ?? "development",
    release: input.release ?? loadReleaseMetadata(),
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
    logLevel: input.logLevel ?? "info",
    auth: {
      mode:
        input.auth?.mode ??
        (input.nodeEnv === "production" ? "enforced" : "permissive"),
      allowAnonymousInternal: input.auth?.allowAnonymousInternal ?? true,
      actorRegistryPath: input.auth?.actorRegistryPath?.trim() || undefined,
      actorRegistry: input.auth?.actorRegistry ?? [],
      issuerSecret: input.auth?.issuerSecret?.trim() || undefined,
      issuedTokenRequireRegistryMatch:
        input.auth?.issuedTokenRequireRegistryMatch ?? true,
      issuedTokenRevocationPath:
        input.auth?.issuedTokenRevocationPath?.trim() || undefined,
      revokedIssuedTokenIds: input.auth?.revokedIssuedTokenIds ?? []
    }
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

function parseActorRegistry(value: string | undefined): ActorRegistryEntry[] {
  if (!value?.trim()) {
    return [];
  }

  const parsed = JSON.parse(value) as unknown;
  return parseActorRegistryValue(parsed, "MAB_AUTH_ACTOR_REGISTRY_JSON");
}

function parseRevokedIssuedTokenIds(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  const parsed = JSON.parse(value) as unknown;
  return parseRevokedIssuedTokenIdValue(
    parsed,
    "MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_JSON"
  );
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
      paidEscalationBaseUrl: env.MAB_PROVIDER_PAID_ESCALATION_BASE_URL,
      paidEscalationApiKey: env.MAB_PROVIDER_PAID_ESCALATION_API_KEY
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

function normalizeActorRegistryEntry(
  value: unknown,
  index: number
): ActorRegistryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `MAB_AUTH_ACTOR_REGISTRY_JSON entry at index ${index} must be an object.`
    );
  }

  const entry = value as Partial<ActorRegistryEntry>;
  if (!entry.actorId?.trim()) {
    throw new Error(
      `MAB_AUTH_ACTOR_REGISTRY_JSON entry at index ${index} is missing actorId.`
    );
  }

  if (!entry.actorRole) {
    throw new Error(
      `MAB_AUTH_ACTOR_REGISTRY_JSON entry '${entry.actorId}' is missing actorRole.`
    );
  }

  return {
    actorId: entry.actorId.trim(),
    actorRole: entry.actorRole,
    authToken: entry.authToken?.trim() || undefined,
    authTokens: normalizeActorTokenCredentials(entry.authTokens, entry.actorId),
    source: entry.source?.trim() || undefined,
    enabled: entry.enabled ?? true,
    allowedTransports: entry.allowedTransports,
    allowedCommands: entry.allowedCommands,
    allowedAdminActions: entry.allowedAdminActions,
    validFrom: entry.validFrom?.trim() || undefined,
    validUntil: entry.validUntil?.trim() || undefined
  };
}

function loadActorRegistryFromPath(filePath: string | undefined): ActorRegistryEntry[] {
  if (!filePath) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return parseActorRegistryValue(
    parsed,
    `MAB_AUTH_ACTOR_REGISTRY_PATH (${filePath})`
  );
}

function loadRevokedIssuedTokenIdsFromPath(filePath: string | undefined): string[] {
  if (!filePath) {
    return [];
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parseRevokedIssuedTokenIdValue(
      parsed,
      `MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH (${filePath})`
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function parseActorRegistryValue(
  parsed: unknown,
  sourceLabel: string
): ActorRegistryEntry[] {
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "actors" in parsed &&
        Array.isArray((parsed as { actors?: unknown }).actors)
      ? ((parsed as { actors: unknown[] }).actors)
      : undefined;

  if (!entries) {
    throw new Error(
      `${sourceLabel} must be either a JSON array or an object with an 'actors' array.`
    );
  }

  return entries.map((entry, index) => normalizeActorRegistryEntry(entry, index));
}

function parseRevokedIssuedTokenIdValue(
  parsed: unknown,
  sourceLabel: string
): string[] {
  const tokenIds = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "tokenIds" in parsed &&
        Array.isArray((parsed as { tokenIds?: unknown }).tokenIds)
      ? ((parsed as { tokenIds: unknown[] }).tokenIds)
      : undefined;

  if (!tokenIds) {
    throw new Error(
      `${sourceLabel} must be either a JSON array or an object with a 'tokenIds' array.`
    );
  }

  return tokenIds.map((tokenId, index) => {
    if (typeof tokenId !== "string" || tokenId.trim() === "") {
      throw new Error(
        `${sourceLabel} tokenIds[${index}] must be a non-empty string.`
      );
    }

    return tokenId.trim();
  });
}

function mergeActorRegistryEntries(
  baseEntries: ReadonlyArray<ActorRegistryEntry>,
  overrideEntries: ReadonlyArray<ActorRegistryEntry>
): ActorRegistryEntry[] {
  const merged = new Map<string, ActorRegistryEntry>();

  for (const entry of baseEntries) {
    merged.set(entry.actorId, entry);
  }

  for (const entry of overrideEntries) {
    merged.set(entry.actorId, entry);
  }

  return [...merged.values()];
}

function mergeRevokedIssuedTokenIds(
  baseTokenIds: ReadonlyArray<string>,
  overrideTokenIds: ReadonlyArray<string>
): string[] {
  return [...new Set([...baseTokenIds, ...overrideTokenIds])];
}

function normalizeActorTokenCredentials(
  value: unknown,
  actorId: string
): ActorRegistryEntry["authTokens"] {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  return value.map((credential, index) => {
    if (typeof credential === "string") {
      const token = credential.trim();
      if (!token) {
        throw new Error(
          `Actor registry entry '${actorId}' has an empty auth token at index ${index}.`
        );
      }
      return token;
    }

    if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
      throw new Error(
        `Actor registry entry '${actorId}' authTokens[${index}] must be a string or object.`
      );
    }

    const normalized = credential as {
      token?: string;
      label?: string;
      validFrom?: string;
      validUntil?: string;
    };

    if (!normalized.token?.trim()) {
      throw new Error(
        `Actor registry entry '${actorId}' authTokens[${index}] is missing token.`
      );
    }

    return {
      token: normalized.token.trim(),
      label: normalized.label?.trim() || undefined,
      validFrom: normalized.validFrom?.trim() || undefined,
      validUntil: normalized.validUntil?.trim() || undefined
    };
  });
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
