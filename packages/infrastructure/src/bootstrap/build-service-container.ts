import type {
  AuditLog,
  AuditHistoryService,
  CanonicalNoteService,
  CanonicalNoteRepository,
  ChunkingService,
  DraftingProvider,
  EmbeddingProvider,
  LexicalIndex,
  LocalReasoningProvider,
  MetadataControlStore,
  NoteValidationService,
  PromotionOrchestratorService,
  RetrieveContextService,
  RerankerProvider,
  SessionArchiveStore,
  StagingDraftService,
  TemporalRefreshService,
  StagingNoteRepository,
  VectorIndex
} from "@multi-agent-brain/application";
import {
  AuditHistoryService as ConcreteAuditHistoryService,
  CanonicalNoteService as ConcreteCanonicalNoteService,
  ChunkingService as ConcreteChunkingService,
  ContextNamespaceService as ConcreteContextNamespaceService,
  ContextRepresentationService as ConcreteContextRepresentationService,
  ContextPacketService as ConcreteContextPacketService,
  DecisionSummaryService as ConcreteDecisionSummaryService,
  ImportOrchestrationService as ConcreteImportOrchestrationService,
  HierarchicalRetrievalService as ConcreteHierarchicalRetrievalService,
  NoteValidationService as ConcreteNoteValidationService,
  PromotionOrchestratorService as ConcretePromotionOrchestratorService,
  RetrieveContextService as ConcreteRetrieveContextService,
  SessionArchiveService as ConcreteSessionArchiveService,
  StagingDraftService as ConcreteStagingDraftService,
  TemporalRefreshService as ConcreteTemporalRefreshService
} from "@multi-agent-brain/application";
import {
  ActorAuthorizationPolicy,
  BrainDomainController,
  BrainMemoryController,
  BrainRetrievalController,
  CodingDomainController,
  ModelRoleRegistry,
  MultiAgentOrchestrator,
  RoleProviderRegistry,
  TaskFamilyRouter,
  type ModelRoleBinding
} from "@multi-agent-brain/orchestration";
import { PythonCodingControllerBridge } from "../coding/python-coding-controller-bridge.js";
import { loadEnvironment, normalizeEnvironment, type AppEnvironment } from "../config/env.js";
import { SqliteFtsIndex } from "../fts/sqlite-fts-index.js";
import { HashEmbeddingProvider } from "../providers/hash-embedding-provider.js";
import { HeuristicLocalReasoningProvider } from "../providers/heuristic-local-reasoning-provider.js";
import { HeuristicRerankerProvider } from "../providers/heuristic-reranker-provider.js";
import { OpenAiCompatibleLocalReasoningProvider } from "../providers/openai-compatible-local-reasoning-provider.js";
import { OllamaDraftingProvider } from "../providers/ollama-drafting-provider.js";
import { OllamaEmbeddingProvider } from "../providers/ollama-embedding-provider.js";
import { OllamaLocalReasoningProvider } from "../providers/ollama-local-reasoning-provider.js";
import { OllamaRerankerProvider } from "../providers/ollama-reranker-provider.js";
import { SqliteAuditLog } from "../sqlite/sqlite-audit-log.js";
import { SqliteContextNamespaceStore } from "../sqlite/sqlite-context-namespace-store.js";
import { SqliteContextRepresentationStore } from "../sqlite/sqlite-context-representation-store.js";
import { SqliteImportJobStore } from "../sqlite/sqlite-import-job-store.js";
import { SqliteIssuedTokenStore } from "../sqlite/sqlite-issued-token-store.js";
import { SqliteMetadataControlStore } from "../sqlite/sqlite-metadata-control-store.js";
import { SqliteRevocationStore } from "../sqlite/sqlite-revocation-store.js";
import { SqliteSessionArchiveStore } from "../sqlite/sqlite-session-archive-store.js";
import { QdrantVectorIndex } from "../vector/qdrant-vector-index.js";
import { FileSystemCanonicalNoteRepository } from "../vault/file-system-canonical-note-repository.js";
import { FileSystemStagingNoteRepository } from "../vault/file-system-staging-note-repository.js";

export interface ServicePortRegistry {
  canonicalNoteRepository: CanonicalNoteRepository;
  stagingNoteRepository: StagingNoteRepository;
  metadataControlStore: MetadataControlStore;
  sessionArchiveStore: SessionArchiveStore;
  issuedTokenStore: SqliteIssuedTokenStore;
  revocationStore: SqliteRevocationStore;
  auditLog: AuditLog;
  lexicalIndex?: LexicalIndex;
  vectorIndex?: VectorIndex;
  embeddingProvider?: EmbeddingProvider;
  localReasoningProvider?: LocalReasoningProvider;
  draftingProvider?: DraftingProvider;
  rerankerProvider?: RerankerProvider;
  modelRoleRegistry: ModelRoleRegistry;
  roleProviderRegistry: RoleProviderRegistry;
}

export interface ServiceRegistry {
  auditHistoryService: AuditHistoryService;
  noteValidationService: NoteValidationService;
  canonicalNoteService: CanonicalNoteService;
  stagingDraftService: StagingDraftService;
  chunkingService: ChunkingService;
  promotionOrchestratorService: PromotionOrchestratorService;
  retrieveContextService: RetrieveContextService;
  contextPacketService: ConcreteContextPacketService;
  decisionSummaryService: ConcreteDecisionSummaryService;
  importOrchestrationService: ConcreteImportOrchestrationService;
  contextNamespaceService: ConcreteContextNamespaceService;
  contextRepresentationService: ConcreteContextRepresentationService;
  sessionArchiveService: ConcreteSessionArchiveService;
  temporalRefreshService: TemporalRefreshService;
}

export interface ServiceContainer {
  env: AppEnvironment;
  authPolicy: ActorAuthorizationPolicy;
  ports: ServicePortRegistry;
  services: ServiceRegistry;
  orchestrator: MultiAgentOrchestrator;
  dispose(): void;
}

export function buildServiceContainer(
  envInput: Partial<AppEnvironment> = loadEnvironment()
): ServiceContainer {
  const env = normalizeEnvironment(envInput);
  const canonicalNoteRepository = new FileSystemCanonicalNoteRepository(env.vaultRoot);
  const stagingNoteRepository = new FileSystemStagingNoteRepository(env.stagingRoot);
  const metadataControlStore = new SqliteMetadataControlStore(env.sqlitePath);
  const sessionArchiveStore = new SqliteSessionArchiveStore(env.sqlitePath);
  const issuedTokenStore = new SqliteIssuedTokenStore(env.sqlitePath);
  const revocationStore = new SqliteRevocationStore(env.sqlitePath);
  const auditLog = new SqliteAuditLog(env.sqlitePath);
  const lexicalIndex = new SqliteFtsIndex(env.sqlitePath);
  const contextNamespaceStore = new SqliteContextNamespaceStore(env.sqlitePath);
  const contextRepresentationStore = new SqliteContextRepresentationStore(env.sqlitePath);
  const importJobStore = new SqliteImportJobStore(env.sqlitePath);
  const vectorIndex = new QdrantVectorIndex({
    baseUrl: env.qdrantUrl,
    collectionName: env.qdrantCollection,
    softFail: env.qdrantSoftFail
  });

  const modelRoleRegistry = new ModelRoleRegistry(Object.values(env.roleBindings));
  const roleProviderRegistry = new RoleProviderRegistry({
    embeddingProviders: {
      embedding_primary: createEmbeddingProvider(
        modelRoleRegistry.resolve("embedding_primary"),
        env
      )
    },
    reasoningProviders: {
      brain_primary: createReasoningProvider(
        modelRoleRegistry.resolve("brain_primary"),
        env
      ),
      paid_escalation: createReasoningProvider(
        modelRoleRegistry.resolve("paid_escalation"),
        env
      )
    },
    draftingProviders: {
      brain_primary: createDraftingProvider(
        modelRoleRegistry.resolve("brain_primary"),
        env
      )
    },
    rerankerProviders: {
      reranker_primary: createRerankerProvider(
        modelRoleRegistry.resolve("reranker_primary"),
        env
      )
    }
  });

  const embeddingProvider =
    roleProviderRegistry.getEmbeddingProvider("embedding_primary");
  const localReasoningProvider =
    roleProviderRegistry.getReasoningProvider("brain_primary");
  const paidEscalationProvider =
    roleProviderRegistry.getReasoningProvider("paid_escalation");
  const draftingProvider =
    roleProviderRegistry.getDraftingProvider("brain_primary");
  const rerankerProvider =
    roleProviderRegistry.getRerankerProvider("reranker_primary");

  const noteValidationService = new ConcreteNoteValidationService();
  const auditHistoryService = new ConcreteAuditHistoryService(auditLog);
  const canonicalNoteService = new ConcreteCanonicalNoteService(
    canonicalNoteRepository,
    metadataControlStore
  );
  const stagingDraftService = new ConcreteStagingDraftService(
    stagingNoteRepository,
    metadataControlStore,
    noteValidationService,
    draftingProvider
  );
  const chunkingService = new ConcreteChunkingService();
  const contextRepresentationService = new ConcreteContextRepresentationService(
    contextRepresentationStore
  );
  const hierarchicalRetrievalService = new ConcreteHierarchicalRetrievalService({
    lexicalIndex,
    metadataControlStore,
    vectorIndex,
    embeddingProvider,
    localReasoningProvider,
    paidEscalationProvider,
    rerankerProvider,
    auditHistoryService
  });
  const promotionOrchestratorService = new ConcretePromotionOrchestratorService(
    stagingNoteRepository,
    canonicalNoteService,
    noteValidationService,
    metadataControlStore,
    chunkingService,
    auditHistoryService,
    lexicalIndex,
    vectorIndex,
    embeddingProvider,
    contextRepresentationService
  );
  const retrieveContextService = new ConcreteRetrieveContextService({
    lexicalIndex,
    metadataControlStore,
    vectorIndex,
    embeddingProvider,
    localReasoningProvider,
    paidEscalationProvider,
    rerankerProvider,
    auditHistoryService,
    hierarchicalRetrievalService
  });
  const contextPacketService = new ConcreteContextPacketService(metadataControlStore);
  const decisionSummaryService = new ConcreteDecisionSummaryService(
    retrieveContextService,
    auditHistoryService
  );
  const importOrchestrationService = new ConcreteImportOrchestrationService(
    importJobStore
  );
  const contextNamespaceService = new ConcreteContextNamespaceService(
    contextNamespaceStore
  );
  const sessionArchiveService = new ConcreteSessionArchiveService(
    sessionArchiveStore
  );
  const temporalRefreshService = new ConcreteTemporalRefreshService(
    metadataControlStore,
    canonicalNoteService,
    stagingDraftService,
    auditHistoryService
  );

  const authPolicy = new ActorAuthorizationPolicy({
    mode: env.auth.mode,
    allowAnonymousInternal: env.auth.allowAnonymousInternal,
    registry: env.auth.actorRegistry,
    issuerSecret: env.auth.issuerSecret,
    issuedTokenRequireRegistryMatch: env.auth.issuedTokenRequireRegistryMatch,
    revokedIssuedTokenIds: env.auth.revokedIssuedTokenIds,
    isTokenRevoked: (tokenId) => revocationStore.isTokenRevoked(tokenId)
  });

  const brainDomainController = new BrainDomainController(
    new BrainRetrievalController(
      retrieveContextService,
      decisionSummaryService,
      contextPacketService
    ),
    new BrainMemoryController(
      stagingDraftService,
      noteValidationService,
      promotionOrchestratorService,
      sessionArchiveService,
      auditHistoryService,
      temporalRefreshService
    ),
    importOrchestrationService
  );
  const codingDomainController = new CodingDomainController(
    new PythonCodingControllerBridge({
      pythonExecutable: env.codingRuntimePythonExecutable,
      pythonPath: env.codingRuntimePythonPath,
      moduleName: env.codingRuntimeModule,
      timeoutMs: env.codingRuntimeTimeoutMs,
      ollamaBaseUrl: env.providerEndpoints.dockerOllamaBaseUrl,
      codingBinding: modelRoleRegistry.resolve("coding_primary")
    }),
    auditHistoryService
  );
  const orchestrator = new MultiAgentOrchestrator(
    new TaskFamilyRouter(),
    brainDomainController,
    codingDomainController,
    authPolicy,
    modelRoleRegistry,
    roleProviderRegistry
  );

  return {
    env,
    authPolicy,
    ports: {
      canonicalNoteRepository,
      stagingNoteRepository,
      metadataControlStore,
      sessionArchiveStore,
      issuedTokenStore,
      revocationStore,
      auditLog,
      lexicalIndex,
      vectorIndex,
      embeddingProvider,
      localReasoningProvider,
      draftingProvider,
      rerankerProvider,
      modelRoleRegistry,
      roleProviderRegistry
    },
    services: {
      auditHistoryService,
      noteValidationService,
      canonicalNoteService,
      stagingDraftService,
      chunkingService,
      promotionOrchestratorService,
      retrieveContextService,
      contextPacketService,
      decisionSummaryService,
      importOrchestrationService,
      contextNamespaceService,
      contextRepresentationService,
      sessionArchiveService,
      temporalRefreshService
    },
    orchestrator,
    dispose() {
      closeIfSupported(lexicalIndex);
      closeIfSupported(auditLog);
      closeIfSupported(metadataControlStore);
      closeIfSupported(sessionArchiveStore);
      closeIfSupported(contextNamespaceStore);
      closeIfSupported(contextRepresentationStore);
      closeIfSupported(importJobStore);
      closeIfSupported(issuedTokenStore);
      closeIfSupported(revocationStore);
    }
  };
}

function createEmbeddingProvider(
  binding: ModelRoleBinding,
  env: AppEnvironment
): EmbeddingProvider | undefined {
  switch (binding.providerId) {
    case "disabled":
      return undefined;
    case "internal_hash":
      return new HashEmbeddingProvider();
    case "docker_ollama":
      return new OllamaEmbeddingProvider({
        baseUrl: env.providerEndpoints.dockerOllamaBaseUrl,
        model: binding.modelId ?? env.ollamaEmbeddingModel,
        fallback: env.disableProviderFallbacks
          ? undefined
          : new HashEmbeddingProvider()
      });
    default:
      throw new Error(`Unsupported embedding provider '${binding.providerId}'.`);
  }
}

function createReasoningProvider(
  binding: ModelRoleBinding,
  env: AppEnvironment
): LocalReasoningProvider | undefined {
  switch (binding.providerId) {
    case "disabled":
      return undefined;
    case "internal_heuristic":
      return new HeuristicLocalReasoningProvider();
    case "docker_ollama":
      return new OllamaLocalReasoningProvider({
        baseUrl: env.providerEndpoints.dockerOllamaBaseUrl,
        model: binding.modelId ?? env.ollamaReasoningModel,
        temperature: binding.temperature,
        seed: binding.seed,
        maxOutputTokens: binding.maxOutputTokens,
        timeoutMs: binding.timeoutMs,
        fallback: env.disableProviderFallbacks
          ? undefined
          : new HeuristicLocalReasoningProvider()
      });
    case "paid_openai_compat":
      if (!env.providerEndpoints.paidEscalationBaseUrl || !binding.modelId) {
        return undefined;
      }

      return new OpenAiCompatibleLocalReasoningProvider({
        baseUrl: env.providerEndpoints.paidEscalationBaseUrl,
        apiKey: env.providerEndpoints.paidEscalationApiKey,
        model: binding.modelId,
        temperature: binding.temperature,
        seed: binding.seed,
        maxOutputTokens: binding.maxOutputTokens,
        timeoutMs: binding.timeoutMs,
        fallback: env.disableProviderFallbacks
          ? undefined
          : new HeuristicLocalReasoningProvider()
      });
    default:
      throw new Error(`Unsupported reasoning provider '${binding.providerId}'.`);
  }
}

function createDraftingProvider(
  binding: ModelRoleBinding,
  env: AppEnvironment
): DraftingProvider | undefined {
  switch (binding.providerId) {
    case "disabled":
      return undefined;
    case "docker_ollama":
      return new OllamaDraftingProvider({
        baseUrl: env.providerEndpoints.dockerOllamaBaseUrl,
        model: binding.modelId ?? env.ollamaDraftingModel,
        temperature: binding.temperature,
        seed: binding.seed,
        maxOutputTokens: binding.maxOutputTokens,
        timeoutMs: binding.timeoutMs
      });
    default:
      return undefined;
  }
}

function createRerankerProvider(
  binding: ModelRoleBinding,
  env: AppEnvironment
): RerankerProvider | undefined {
  switch (binding.providerId) {
    case "disabled":
      return undefined;
    case "internal_heuristic":
      return new HeuristicRerankerProvider();
    case "docker_ollama":
      return new OllamaRerankerProvider({
        baseUrl: env.providerEndpoints.dockerOllamaBaseUrl,
        model: binding.modelId ?? "qwen3-reranker",
        temperature: binding.temperature,
        seed: binding.seed,
        maxOutputTokens: binding.maxOutputTokens,
        timeoutMs: binding.timeoutMs,
        fallback: env.disableProviderFallbacks
          ? undefined
          : new HeuristicRerankerProvider()
      });
    default:
      throw new Error(`Unsupported reranker provider '${binding.providerId}'.`);
  }
}

function closeIfSupported(resource: unknown): void {
  if (
    resource &&
    typeof resource === "object" &&
    "close" in resource &&
    typeof resource.close === "function"
  ) {
    resource.close();
  }
}
