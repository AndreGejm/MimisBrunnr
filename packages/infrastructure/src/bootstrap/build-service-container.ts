import path from "node:path";
import type {
  AuditLog,
  AuditHistoryService,
  AgentContextAssemblyService,
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
  ReviewCommandService,
  RetrieveContextService,
  RerankerProvider,
  SessionArchiveStore,
  StagingNoteRepository,
  StagingDraftService,
  TemporalRefreshService,
  ToolOutputBudgetService,
  VectorIndex
} from "@mimir/application";
import type { LocalAgentTraceStore, ToolOutputStore } from "@mimir/domain";
import type { ExternalSourceRegistry } from "@mimir/contracts";
import {
  AuditHistoryService as ConcreteAuditHistoryService,
  AgentContextAssemblyService as ConcreteAgentContextAssemblyService,
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
  ReviewCommandService as ConcreteReviewCommandService,
  RetrieveContextService as ConcreteRetrieveContextService,
  SessionArchiveService as ConcreteSessionArchiveService,
  StagingDraftService as ConcreteStagingDraftService,
  TemporalRefreshService as ConcreteTemporalRefreshService,
  ToolOutputBudgetService as ConcreteToolOutputBudgetService
} from "@mimir/application";
import {
  ActorAuthorizationPolicy,
  CodingDomainController,
  MimisbrunnrDomainController,
  MimisbrunnrMemoryController,
  MimisbrunnrRetrievalController,
  MimirOrchestrator,
  ModelRoleRegistry,
  RoleProviderRegistry,
  TaskFamilyRouter
} from "@mimir/orchestration";
import { PythonCodingControllerBridge } from "../coding/python-coding-controller-bridge.js";
import { buildDefaultExternalSourceRegistry } from "../external-sources/external-source-registry.js";
import { FileSystemToolRegistry } from "../tools/tool-registry.js";
import { loadEnvironment, normalizeEnvironment, type AppEnvironment } from "../config/env.js";
import { SqliteFtsIndex } from "../fts/sqlite-fts-index.js";
import { buildDefaultProviderFactoryRegistry } from "../providers/provider-factory-registry.js";
import { SqliteAuditLog } from "../sqlite/sqlite-audit-log.js";
import { SqliteContextNamespaceStore } from "../sqlite/sqlite-context-namespace-store.js";
import { SqliteContextRepresentationStore } from "../sqlite/sqlite-context-representation-store.js";
import { SqliteImportJobStore } from "../sqlite/sqlite-import-job-store.js";
import { SqliteIssuedTokenStore } from "../sqlite/sqlite-issued-token-store.js";
import { SqliteLocalAgentTraceStore } from "../sqlite/sqlite-local-agent-trace-store.js";
import { SqliteMetadataControlStore } from "../sqlite/sqlite-metadata-control-store.js";
import { SqliteRevocationStore } from "../sqlite/sqlite-revocation-store.js";
import { SqliteSessionArchiveStore } from "../sqlite/sqlite-session-archive-store.js";
import { SqliteToolOutputStore } from "../sqlite/sqlite-tool-output-store.js";
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
  localAgentTraceStore: LocalAgentTraceStore;
  toolOutputStore: ToolOutputStore;
  lexicalIndex?: LexicalIndex;
  vectorIndex?: VectorIndex;
  embeddingProvider?: EmbeddingProvider;
  localReasoningProvider?: LocalReasoningProvider;
  draftingProvider?: DraftingProvider;
  rerankerProvider?: RerankerProvider;
  externalSourceRegistry: ExternalSourceRegistry;
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
  agentContextAssemblyService: AgentContextAssemblyService;
  contextPacketService: ConcreteContextPacketService;
  decisionSummaryService: ConcreteDecisionSummaryService;
  reviewCommandService: ReviewCommandService;
  importOrchestrationService: ConcreteImportOrchestrationService;
  contextNamespaceService: ConcreteContextNamespaceService;
  contextRepresentationService: ConcreteContextRepresentationService;
  sessionArchiveService: ConcreteSessionArchiveService;
  temporalRefreshService: TemporalRefreshService;
  toolOutputBudgetService: ToolOutputBudgetService;
}

export interface ServiceContainer {
  env: AppEnvironment;
  authPolicy: ActorAuthorizationPolicy;
  ports: ServicePortRegistry;
  services: ServiceRegistry;
  orchestrator: MimirOrchestrator;
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
  const localAgentTraceStore = new SqliteLocalAgentTraceStore(env.sqlitePath);
  const toolOutputStore = new SqliteToolOutputStore(
    env.sqlitePath,
    path.join(path.dirname(path.resolve(env.sqlitePath)), "tool-output")
  );
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
  const providerFactoryRegistry = buildDefaultProviderFactoryRegistry();
  const roleProviderRegistry = new RoleProviderRegistry({
    embeddingProviders: {
      embedding_primary: providerFactoryRegistry.createEmbedding({
        env,
        binding: modelRoleRegistry.resolve("embedding_primary")
      })
    },
    reasoningProviders: {
      mimisbrunnr_primary: providerFactoryRegistry.createReasoning({
        env,
        binding: modelRoleRegistry.resolve("mimisbrunnr_primary")
      }),
      paid_escalation: providerFactoryRegistry.createReasoning({
        env,
        binding: modelRoleRegistry.resolve("paid_escalation")
      })
    },
    draftingProviders: {
      mimisbrunnr_primary: providerFactoryRegistry.createDrafting({
        env,
        binding: modelRoleRegistry.resolve("mimisbrunnr_primary")
      })
    },
    rerankerProviders: {
      reranker_primary: providerFactoryRegistry.createReranker({
        env,
        binding: modelRoleRegistry.resolve("reranker_primary")
      })
    }
  });

  const externalSourceRegistry = buildDefaultExternalSourceRegistry();

  const embeddingProvider =
    roleProviderRegistry.getEmbeddingProvider("embedding_primary");
  const localReasoningProvider =
    roleProviderRegistry.getReasoningProvider("mimisbrunnr_primary");
  const paidEscalationProvider =
    roleProviderRegistry.getReasoningProvider("paid_escalation");
  const draftingProvider =
    roleProviderRegistry.getDraftingProvider("mimisbrunnr_primary");
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
  const reviewCommandService = new ConcreteReviewCommandService(
    stagingNoteRepository,
    metadataControlStore,
    promotionOrchestratorService
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
  const agentContextAssemblyService = new ConcreteAgentContextAssemblyService(
    retrieveContextService,
    sessionArchiveService
  );
  const temporalRefreshService = new ConcreteTemporalRefreshService(
    metadataControlStore,
    canonicalNoteService,
    stagingDraftService,
    auditHistoryService
  );
  const toolOutputBudgetService = new ConcreteToolOutputBudgetService(
    toolOutputStore
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

  const mimisbrunnrController = new MimisbrunnrDomainController(
    new MimisbrunnrRetrievalController(
      retrieveContextService,
      decisionSummaryService,
      contextPacketService,
      agentContextAssemblyService
    ),
    new MimisbrunnrMemoryController(
      stagingDraftService,
      noteValidationService,
      promotionOrchestratorService,
      sessionArchiveService,
      auditHistoryService,
      temporalRefreshService
    ),
    importOrchestrationService
  );
  const codingPrimaryBinding = modelRoleRegistry.resolve("coding_primary");
  const codingDomainController = new CodingDomainController(
    new PythonCodingControllerBridge({
      pythonExecutable: env.codingRuntimePythonExecutable,
      pythonPath: env.codingRuntimePythonPath,
      moduleName: env.codingRuntimeModule,
      timeoutMs: env.codingRuntimeTimeoutMs,
      ollamaBaseUrl: env.providerEndpoints.dockerOllamaBaseUrl,
      codingBinding: codingPrimaryBinding
    }),
    auditHistoryService,
    localAgentTraceStore,
    {
      modelRole: "coding_primary",
      modelId: codingPrimaryBinding.modelId
    },
    toolOutputBudgetService
  );
  const toolRegistry = new FileSystemToolRegistry(env.toolRegistryDir);
  const orchestrator = new MimirOrchestrator(
    new TaskFamilyRouter(),
    mimisbrunnrController,
    codingDomainController,
    authPolicy,
    modelRoleRegistry,
    roleProviderRegistry,
    toolRegistry
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
      localAgentTraceStore,
      toolOutputStore,
      lexicalIndex,
      vectorIndex,
      embeddingProvider,
      localReasoningProvider,
      draftingProvider,
      rerankerProvider,
      externalSourceRegistry,
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
      agentContextAssemblyService,
      contextPacketService,
      decisionSummaryService,
      reviewCommandService,
      importOrchestrationService,
      contextNamespaceService,
      contextRepresentationService,
      sessionArchiveService,
      temporalRefreshService,
      toolOutputBudgetService
    },
    orchestrator,
    dispose() {
      closeIfSupported(lexicalIndex);
      closeIfSupported(auditLog);
      closeIfSupported(localAgentTraceStore);
      closeIfSupported(toolOutputStore);
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
