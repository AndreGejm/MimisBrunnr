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
  StagingDraftService,
  TemporalRefreshService,
  StagingNoteRepository,
  VectorIndex
} from "@multi-agent-brain/application";
import {
  AuditHistoryService as ConcreteAuditHistoryService,
  CanonicalNoteService as ConcreteCanonicalNoteService,
  ChunkingService as ConcreteChunkingService,
  ContextPacketService as ConcreteContextPacketService,
  DecisionSummaryService as ConcreteDecisionSummaryService,
  NoteValidationService as ConcreteNoteValidationService,
  PromotionOrchestratorService as ConcretePromotionOrchestratorService,
  RetrieveContextService as ConcreteRetrieveContextService,
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
import { SqliteMetadataControlStore } from "../sqlite/sqlite-metadata-control-store.js";
import { QdrantVectorIndex } from "../vector/qdrant-vector-index.js";
import { FileSystemCanonicalNoteRepository } from "../vault/file-system-canonical-note-repository.js";
import { FileSystemStagingNoteRepository } from "../vault/file-system-staging-note-repository.js";

export interface ServicePortRegistry {
  canonicalNoteRepository: CanonicalNoteRepository;
  stagingNoteRepository: StagingNoteRepository;
  metadataControlStore: MetadataControlStore;
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
  const auditLog = new SqliteAuditLog(env.sqlitePath);
  const lexicalIndex = new SqliteFtsIndex(env.sqlitePath);
  const vectorIndex = new QdrantVectorIndex({
    baseUrl: env.qdrantUrl,
    collectionName: env.qdrantCollection
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
  const promotionOrchestratorService = new ConcretePromotionOrchestratorService(
    stagingNoteRepository,
    canonicalNoteService,
    noteValidationService,
    metadataControlStore,
    chunkingService,
    auditHistoryService,
    lexicalIndex,
    vectorIndex,
    embeddingProvider
  );
  const retrieveContextService = new ConcreteRetrieveContextService({
    lexicalIndex,
    metadataControlStore,
    vectorIndex,
    embeddingProvider,
    localReasoningProvider,
    paidEscalationProvider,
    rerankerProvider,
    auditHistoryService
  });
  const contextPacketService = new ConcreteContextPacketService(metadataControlStore);
  const decisionSummaryService = new ConcreteDecisionSummaryService(
    retrieveContextService,
    auditHistoryService
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
    issuedTokenRequireRegistryMatch: env.auth.issuedTokenRequireRegistryMatch
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
      auditHistoryService,
      temporalRefreshService
    )
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
      temporalRefreshService
    },
    orchestrator,
    dispose() {
      closeIfSupported(lexicalIndex);
      closeIfSupported(auditLog);
      closeIfSupported(metadataControlStore);
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
        fallback: new HashEmbeddingProvider()
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
        fallback: new HeuristicLocalReasoningProvider()
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
        fallback: new HeuristicLocalReasoningProvider()
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
        fallback: new HeuristicRerankerProvider()
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
