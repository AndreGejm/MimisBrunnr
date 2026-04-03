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
  rerankerProvider: "disabled" | "local";
  apiHost: string;
  apiPort: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  return {
    nodeEnv: (env.MAB_NODE_ENV as AppEnvironment["nodeEnv"]) ?? "development",
    vaultRoot: env.MAB_VAULT_ROOT ?? "./vault/canonical",
    stagingRoot: env.MAB_STAGING_ROOT ?? "./vault/staging",
    sqlitePath: env.MAB_SQLITE_PATH ?? "./state/multi-agent-brain.sqlite",
    qdrantUrl: env.MAB_QDRANT_URL ?? "http://127.0.0.1:6333",
    qdrantCollection: env.MAB_QDRANT_COLLECTION ?? "context_brain_chunks",
    ollamaBaseUrl: env.MAB_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    ollamaEmbeddingModel: env.MAB_OLLAMA_EMBEDDING_MODEL ?? "embeddinggemma",
    ollamaReasoningModel: env.MAB_OLLAMA_REASONING_MODEL ?? "qwen3",
    ollamaDraftingModel: env.MAB_OLLAMA_DRAFTING_MODEL ?? "qwen3",
    embeddingProvider: (env.MAB_EMBEDDING_PROVIDER as AppEnvironment["embeddingProvider"]) ?? "hash",
    reasoningProvider: (env.MAB_REASONING_PROVIDER as AppEnvironment["reasoningProvider"]) ?? "heuristic",
    draftingProvider: (env.MAB_DRAFTING_PROVIDER as AppEnvironment["draftingProvider"]) ?? "ollama",
    rerankerProvider: (env.MAB_RERANKER_PROVIDER as AppEnvironment["rerankerProvider"]) ?? "local",
    apiHost: env.MAB_API_HOST ?? "127.0.0.1",
    apiPort: parsePort(env.MAB_API_PORT, 8080),
    logLevel: (env.MAB_LOG_LEVEL as AppEnvironment["logLevel"]) ?? "info"
  };
}
