import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const infrastructure = await import("../../packages/infrastructure/dist/index.js");

function envFixture(overrides = {}) {
  return {
    nodeEnv: "test",
    releaseVersion: "0.5.0",
    gitTag: "v0.5.0",
    gitCommit: "feedfacecafebeef",
    releaseChannel: "tagged",
    dataRoot: path.join(os.tmpdir(), `mimir-registry-${randomUUID()}`),
    vaultRoot: path.join(os.tmpdir(), `mimir-registry-vault-${randomUUID()}`),
    stagingRoot: path.join(os.tmpdir(), `mimir-registry-staging-${randomUUID()}`),
    canonicalRoot: path.join(os.tmpdir(), `mimir-registry-canonical-${randomUUID()}`),
    sqlitePath: path.join(os.tmpdir(), `mimir-registry-${randomUUID()}.sqlite`),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `mimir_registry_${randomUUID().slice(0, 8)}`,
    qdrantSoftFail: true,
    ollamaBaseUrl: "http://127.0.0.1:12434",
    ollamaEmbeddingModel: "docker.io/ai/qwen3-embedding:0.6B-F16",
    ollamaReasoningModel: "qwen3:4B-F16",
    ollamaDraftingModel: "qwen3:4B-F16",
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    disableProviderFallbacks: false,
    providerEndpoints: {
      dockerOllamaBaseUrl: "http://127.0.0.1:12434",
      paidEscalationBaseUrl: undefined,
      paidEscalationApiKey: undefined
    },
    roleBindings: {
      coding_primary: {
        role: "coding_primary",
        providerId: "docker_ollama",
        modelId: "qwen3-coder",
        temperature: 0,
        seed: 42,
        timeoutMs: 120000,
        maxInputChars: 30000,
        maxOutputTokens: 4000
      },
      mimisbrunnr_primary: {
        role: "mimisbrunnr_primary",
        providerId: "internal_heuristic",
        modelId: "qwen3:4B-F16",
        temperature: 0,
        seed: 42,
        timeoutMs: 30000,
        maxInputChars: 18000,
        maxOutputTokens: 1200
      },
      embedding_primary: {
        role: "embedding_primary",
        providerId: "internal_hash",
        modelId: "docker.io/ai/qwen3-embedding:0.6B-F16",
        temperature: 0,
        timeoutMs: 15000
      },
      reranker_primary: {
        role: "reranker_primary",
        providerId: "internal_heuristic",
        modelId: "qwen3-reranker",
        temperature: 0,
        seed: 42,
        timeoutMs: 20000,
        maxInputChars: 12000,
        maxOutputTokens: 300
      },
      paid_escalation: {
        role: "paid_escalation",
        providerId: "disabled",
        modelId: undefined,
        temperature: 0,
        timeoutMs: 60000
      }
    },
    toolRegistryDir: path.resolve("docker", "tool-registry"),
    codingRuntimePythonExecutable: "python3",
    codingRuntimePythonPath: "/app/runtimes",
    codingRuntimeModule: "local_experts.bridge",
    codingRuntimeTimeoutMs: 120000,
    apiHost: "127.0.0.1",
    apiPort: 8080,
    logLevel: "error",
    auth: {
      mode: "permissive",
      allowAnonymousInternal: true,
      actorRegistryPath: undefined,
      actorRegistry: [],
      issuerSecret: undefined,
      issuedTokenRequireRegistryMatch: true,
      issuedTokenRevocationPath: undefined,
      revokedIssuedTokenIds: []
    },
    ...overrides
  };
}

test("default external source registry exposes built-in adapter definitions in stable order", () => {
  const registry = infrastructure.buildDefaultExternalSourceRegistry();
  assert.deepEqual(
    registry.list().map((definition) => definition.sourceType),
    ["obsidian_vault"]
  );
});

test("external source registry rejects duplicate source types", () => {
  const registry = new infrastructure.InMemoryExternalSourceRegistry();
  const definition = {
    sourceType: "obsidian_vault",
    create: (registration) => new infrastructure.ObsidianVaultSource(registration)
  };

  registry.register(definition);
  assert.throws(
    () => registry.register(definition),
    /already registered/i
  );
});

test("default external source registry creates obsidian adapters through the shared boundary", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-external-source-registry-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const registry = infrastructure.buildDefaultExternalSourceRegistry();
  const source = registry.create({
    sourceId: `obsidian-${randomUUID()}`,
    sourceType: "obsidian_vault",
    displayName: "Personal Vault",
    rootPath: root,
    accessPolicy: {
      allowedReadGlobs: ["**/*.md"],
      deniedReadGlobs: [],
      allowWrites: false,
      deniedWriteGlobs: ["**/*"]
    }
  });

  assert.equal(source.getRegistration().sourceType, "obsidian_vault");
});

test("service container exposes the external source registry", (t) => {
  const container = infrastructure.buildServiceContainer(envFixture());
  t.after(() => {
    container.dispose();
  });

  assert.deepEqual(
    container.ports.externalSourceRegistry.list().map((definition) => definition.sourceType),
    ["obsidian_vault"]
  );
});