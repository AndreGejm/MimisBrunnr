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
  NoteValidationService as ConcreteNoteValidationService,
  PromotionOrchestratorService as ConcretePromotionOrchestratorService,
  RetrieveContextService as ConcreteRetrieveContextService,
  StagingDraftService as ConcreteStagingDraftService
} from "@multi-agent-brain/application";
import { loadEnvironment, type AppEnvironment } from "../config/env.js";
import { SqliteFtsIndex } from "../fts/sqlite-fts-index.js";
import { HashEmbeddingProvider } from "../providers/hash-embedding-provider.js";
import { HeuristicLocalReasoningProvider } from "../providers/heuristic-local-reasoning-provider.js";
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
  const embeddingProvider =
    env.embeddingProvider === "disabled"
      ? undefined
      : new HashEmbeddingProvider();
  const localReasoningProvider =
    env.reasoningProvider === "disabled"
      ? undefined
      : new HeuristicLocalReasoningProvider();
  const noteValidationService = new ConcreteNoteValidationService();
  const auditHistoryService = new ConcreteAuditHistoryService(auditLog);
  const canonicalNoteService = new ConcreteCanonicalNoteService(
    canonicalNoteRepository,
    metadataControlStore
  );
  const stagingDraftService = new ConcreteStagingDraftService(
    stagingNoteRepository,
    metadataControlStore,
    noteValidationService
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
    localReasoningProvider
  });

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
    },
    services: {
      auditHistoryService,
      noteValidationService,
      canonicalNoteService,
      stagingDraftService,
      chunkingService,
      promotionOrchestratorService,
      retrieveContextService
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
