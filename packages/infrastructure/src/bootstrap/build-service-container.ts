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
  StagingNoteRepository,
  VectorIndex
} from "@multi-agent-brain/application";
import {
  AuditHistoryService as ConcreteAuditHistoryService,
  CanonicalNoteService as ConcreteCanonicalNoteService,
  ChunkingService as ConcreteChunkingService,
  DecisionSummaryService as ConcreteDecisionSummaryService,
  NoteValidationService as ConcreteNoteValidationService,
  PromotionOrchestratorService as ConcretePromotionOrchestratorService,
  RetrieveContextService as ConcreteRetrieveContextService,
  StagingDraftService as ConcreteStagingDraftService
} from "@multi-agent-brain/application";
import { loadEnvironment, type AppEnvironment } from "../config/env.js";
import { SqliteFtsIndex } from "../fts/sqlite-fts-index.js";
import { HashEmbeddingProvider } from "../providers/hash-embedding-provider.js";
import { HeuristicLocalReasoningProvider } from "../providers/heuristic-local-reasoning-provider.js";
import { OllamaDraftingProvider } from "../providers/ollama-drafting-provider.js";
import { OllamaEmbeddingProvider } from "../providers/ollama-embedding-provider.js";
import { OllamaLocalReasoningProvider } from "../providers/ollama-local-reasoning-provider.js";
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
}

export interface ServiceRegistry {
  auditHistoryService: AuditHistoryService;
  noteValidationService: NoteValidationService;
  canonicalNoteService: CanonicalNoteService;
  stagingDraftService: StagingDraftService;
  chunkingService: ChunkingService;
  promotionOrchestratorService: PromotionOrchestratorService;
  retrieveContextService: RetrieveContextService;
  decisionSummaryService: ConcreteDecisionSummaryService;
}

export interface ServiceContainer {
  env: AppEnvironment;
  ports: ServicePortRegistry;
  services: ServiceRegistry;
  dispose(): void;
}

export function buildServiceContainer(
  env: AppEnvironment = loadEnvironment()
): ServiceContainer {
  const canonicalNoteRepository = new FileSystemCanonicalNoteRepository(env.vaultRoot);
  const stagingNoteRepository = new FileSystemStagingNoteRepository(env.stagingRoot);
  const metadataControlStore = new SqliteMetadataControlStore(env.sqlitePath);
  const auditLog = new SqliteAuditLog(env.sqlitePath);
  const lexicalIndex = new SqliteFtsIndex(env.sqlitePath);
  const vectorIndex = new QdrantVectorIndex({
    baseUrl: env.qdrantUrl,
    collectionName: env.qdrantCollection
  });
  const fallbackEmbeddingProvider = new HashEmbeddingProvider();
  const embeddingProvider =
    env.embeddingProvider === "disabled"
      ? undefined
      : env.embeddingProvider === "ollama"
        ? new OllamaEmbeddingProvider({
            baseUrl: env.ollamaBaseUrl,
            model: env.ollamaEmbeddingModel,
            fallback: fallbackEmbeddingProvider
          })
        : fallbackEmbeddingProvider;
  const fallbackReasoningProvider = new HeuristicLocalReasoningProvider();
  const localReasoningProvider =
    env.reasoningProvider === "disabled"
      ? undefined
      : env.reasoningProvider === "ollama"
        ? new OllamaLocalReasoningProvider({
            baseUrl: env.ollamaBaseUrl,
            model: env.ollamaReasoningModel,
            fallback: fallbackReasoningProvider
          })
        : fallbackReasoningProvider;
  const draftingProvider =
    env.draftingProvider === "ollama"
      ? new OllamaDraftingProvider({
          baseUrl: env.ollamaBaseUrl,
          model: env.ollamaDraftingModel
        })
      : undefined;
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
    auditHistoryService
  });
  const decisionSummaryService = new ConcreteDecisionSummaryService(
    retrieveContextService,
    auditHistoryService
  );

  return {
    env,
    ports: {
      canonicalNoteRepository,
      stagingNoteRepository,
      metadataControlStore,
      auditLog,
      lexicalIndex,
      vectorIndex,
      embeddingProvider,
      localReasoningProvider
      ,
      draftingProvider
    },
    services: {
      auditHistoryService,
      noteValidationService,
      canonicalNoteService,
      stagingDraftService,
      chunkingService,
      promotionOrchestratorService,
      retrieveContextService,
      decisionSummaryService
    },
    dispose() {
      closeIfSupported(lexicalIndex);
      closeIfSupported(auditLog);
      closeIfSupported(metadataControlStore);
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
