import type {
  ChunkId,
  ChunkStalenessClass,
  CorpusId,
  NoteId,
  NoteType
} from "@multi-agent-brain/domain";

export interface VectorSearchHit {
  chunkId: ChunkId;
  score: number;
}

export interface VectorIndexHealthSnapshot {
  status: "healthy" | "degraded";
  softFail: boolean;
  consecutiveFailures: number;
  lastError?: string;
  lastFailureAt?: string;
  lastSuccessAt?: string;
  degradedSince?: string;
  details?: Record<string, unknown>;
}

export interface VectorIndex {
  upsertEmbeddings(input: {
    chunkId: ChunkId;
    noteId: NoteId;
    embedding: number[];
    corpusId: CorpusId;
    noteType: NoteType;
    stalenessClass: ChunkStalenessClass;
    updatedAt: string;
  }[]): Promise<void>;
  removeByNoteId(noteId: NoteId): Promise<void>;
  search(input: {
    queryEmbedding: number[];
    corpusIds: CorpusId[];
    noteTypes?: NoteType[];
    limit: number;
    includeSuperseded: boolean;
  }): Promise<VectorSearchHit[]>;
  getHealthSnapshot?(): VectorIndexHealthSnapshot;
}
