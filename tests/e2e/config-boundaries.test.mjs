import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const infrastructure = await import("../../packages/infrastructure/dist/index.js");
const { loadCoreConfig } = await import("../../packages/infrastructure/dist/config/core-config.js");
const { loadStorageConfig } = await import("../../packages/infrastructure/dist/config/storage-config.js");
const { loadProviderConfig } = await import("../../packages/infrastructure/dist/config/provider-config.js");
const { loadToolConfig } = await import("../../packages/infrastructure/dist/config/tool-config.js");
const { loadCodingRuntimeConfig } = await import("../../packages/infrastructure/dist/config/coding-runtime-config.js");
const { loadAuthConfig, normalizeAuthConfig } = await import("../../packages/infrastructure/dist/config/auth-config.js");

function envFixture(overrides = {}) {
  return {
    MAB_NODE_ENV: "test",
    MAB_RELEASE_VERSION: "0.5.0",
    MAB_GIT_TAG: "v0.5.0",
    MAB_GIT_COMMIT: "feedfacecafebeef",
    MAB_RELEASE_CHANNEL: "tagged",
    MAB_DATA_ROOT: path.join(os.tmpdir(), `mimir-config-${randomUUID()}`),
    MAB_QDRANT_URL: "http://127.0.0.1:6333",
    MAB_QDRANT_COLLECTION: `mimisbrunnr_chunks_${randomUUID().slice(0, 8)}`,
    MAB_OLLAMA_BASE_URL: "http://127.0.0.1:12434",
    MAB_OLLAMA_EMBEDDING_MODEL: "docker.io/ai/qwen3-embedding:0.6B-F16",
    MAB_OLLAMA_REASONING_MODEL: "qwen3:4B-F16",
    MAB_OLLAMA_DRAFTING_MODEL: "qwen3:4B-F16",
    MAB_EMBEDDING_PROVIDER: "hash",
    MAB_REASONING_PROVIDER: "heuristic",
    MAB_DRAFTING_PROVIDER: "disabled",
    MAB_RERANKER_PROVIDER: "local",
    MAB_DISABLE_PROVIDER_FALLBACKS: "false",
    MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL: "http://127.0.0.1:12434",
    MAB_PROVIDER_PAID_ESCALATION_BASE_URL: "https://paid.example.test/v1",
    MAB_PROVIDER_PAID_ESCALATION_API_KEY: "top-secret",
    MAB_TOOL_REGISTRY_DIR: path.resolve("docker", "tool-registry"),
    MAB_CODING_RUNTIME_PYTHON_EXECUTABLE: "python3",
    MAB_CODING_RUNTIME_PYTHONPATH: "/app/runtimes",
    MAB_CODING_RUNTIME_MODULE: "local_experts.bridge",
    MAB_CODING_RUNTIME_TIMEOUT_MS: "120000",
    MAB_API_HOST: "127.0.0.1",
    MAB_API_PORT: "8080",
    MAB_LOG_LEVEL: "error",
    MAB_AUTH_MODE: "enforced",
    MAB_AUTH_ALLOW_ANONYMOUS_INTERNAL: "false",
    MAB_AUTH_ISSUER_SECRET: "issuer-secret",
    MAB_AUTH_ISSUED_TOKEN_REQUIRE_REGISTRY_MATCH: "true",
    MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
      {
        actorId: "retrieval-agent",
        actorRole: "retrieval",
        authToken: "retrieval-token"
      }
    ]),
    MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_JSON: JSON.stringify(["revoked-from-json"]),
    MAB_ROLE_MIMISBRUNNR_PRIMARY_PROVIDER: "docker_ollama",
    MAB_ROLE_MIMISBRUNNR_PRIMARY_MODEL: "qwen3:4B-F16",
    MAB_ROLE_EMBEDDING_PRIMARY_PROVIDER: "internal_hash",
    MAB_ROLE_EMBEDDING_PRIMARY_MODEL: "docker.io/ai/qwen3-embedding:0.6B-F16",
    MAB_ROLE_RERANKER_PRIMARY_PROVIDER: "internal_heuristic",
    MAB_ROLE_RERANKER_PRIMARY_MODEL: "qwen3-reranker",
    ...overrides
  };
}

test("loadEnvironment matches the layered config composition", () => {
  const env = envFixture();
  const core = loadCoreConfig(env);
  const composed = infrastructure.normalizeEnvironment({
    ...core,
    ...loadStorageConfig(env),
    ...loadProviderConfig(env),
    ...loadToolConfig(env),
    ...loadCodingRuntimeConfig(env),
    auth: loadAuthConfig(env, core.nodeEnv)
  });

  assert.deepEqual(infrastructure.loadEnvironment(env), composed);
});

test("loadProviderConfig preserves alias precedence and role-bound model overrides", () => {
  const provider = loadProviderConfig(envFixture({
    MAB_OLLAMA_REASONING_MODEL: "legacy-reasoning-model",
    MAB_OLLAMA_DRAFTING_MODEL: "legacy-drafting-model",
    MAB_ROLE_MIMIR_BRUNNR_PRIMARY_PROVIDER: "internal_heuristic",
    MAB_ROLE_MIMIR_BRUNNR_PRIMARY_MODEL: "legacy-model",
    MAB_ROLE_MIMISBRUNNR_PRIMARY_PROVIDER: "docker_ollama",
    MAB_ROLE_MIMISBRUNNR_PRIMARY_MODEL: "current-model"
  }));

  assert.equal(provider.roleBindings.mimisbrunnr_primary.providerId, "docker_ollama");
  assert.equal(provider.roleBindings.mimisbrunnr_primary.modelId, "current-model");
  assert.equal(provider.ollamaReasoningModel, "current-model");
  assert.equal(provider.ollamaDraftingModel, "current-model");
});

test("loadProviderConfig adds a disabled coding_advisory role binding by default", () => {
  const provider = loadProviderConfig(envFixture());

  assert.equal(provider.roleBindings.coding_advisory.role, "coding_advisory");
  assert.equal(provider.roleBindings.coding_advisory.providerId, "disabled");
});

test("loadProviderConfig parses role-scoped VoltAgent fallback model bindings", () => {
  const provider = loadProviderConfig(envFixture({
    MAB_ROLE_PAID_ESCALATION_PROVIDER: "voltagent_agent",
    MAB_ROLE_PAID_ESCALATION_MODEL: "openai/gpt-4.1-mini",
    MAB_ROLE_PAID_ESCALATION_FALLBACK_MODEL: "anthropic/claude-sonnet-4",
    MAB_ROLE_CODING_ADVISORY_PROVIDER: "voltagent_agent",
    MAB_ROLE_CODING_ADVISORY_MODEL: "openai/gpt-4.1-mini",
    MAB_ROLE_CODING_ADVISORY_FALLBACK_MODELS_JSON: JSON.stringify([
      "anthropic/claude-sonnet-4",
      "anthropic/claude-3-5-sonnet"
    ])
  }));

  assert.deepEqual(provider.roleBindings.paid_escalation.fallbackModelIds, [
    "anthropic/claude-sonnet-4"
  ]);
  assert.deepEqual(provider.roleBindings.coding_advisory.fallbackModelIds, [
    "anthropic/claude-sonnet-4",
    "anthropic/claude-3-5-sonnet"
  ]);
});

test("loadAuthConfig merges file-backed and inline registry state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-auth-config-"));
  const actorRegistryPath = path.join(root, "actors.json");
  const revokedTokenPath = path.join(root, "revoked.json");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await writeFile(actorRegistryPath, JSON.stringify({
    actors: [
      {
        actorId: "retrieval-agent",
        actorRole: "retrieval",
        authToken: "file-token"
      },
      {
        actorId: "writer-agent",
        actorRole: "writer",
        authToken: "writer-token"
      }
    ]
  }, null, 2), "utf8");
  await writeFile(revokedTokenPath, JSON.stringify({
    tokenIds: ["revoked-from-file"]
  }, null, 2), "utf8");

  const auth = loadAuthConfig(envFixture({
    MAB_AUTH_ACTOR_REGISTRY_PATH: actorRegistryPath,
    MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
      {
        actorId: "retrieval-agent",
        actorRole: "operator",
        authToken: "override-token"
      }
    ]),
    MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH: revokedTokenPath,
    MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_JSON: JSON.stringify([
      "revoked-from-json",
      "revoked-from-file"
    ])
  }), "production");

  assert.equal(auth.mode, "enforced");
  assert.equal(auth.allowAnonymousInternal, false);
  assert.equal(auth.actorRegistry.length, 2);
  assert.equal(auth.actorRegistry.find((entry) => entry.actorId === "retrieval-agent")?.actorRole, "operator");
  assert.equal(auth.actorRegistry.find((entry) => entry.actorId === "retrieval-agent")?.authToken, "override-token");
  assert.equal(auth.actorRegistry.find((entry) => entry.actorId === "writer-agent")?.authToken, "writer-token");
  assert.deepEqual(auth.revokedIssuedTokenIds, [
    "revoked-from-file",
    "revoked-from-json"
  ]);

  assert.deepEqual(normalizeAuthConfig(undefined, "test"), {
    mode: "permissive",
    allowAnonymousInternal: true,
    actorRegistryPath: undefined,
    actorRegistry: [],
    issuerSecret: undefined,
    issuedTokenRequireRegistryMatch: true,
    issuedTokenRevocationPath: undefined,
    revokedIssuedTokenIds: []
  });
});
