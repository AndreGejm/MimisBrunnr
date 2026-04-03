import type {
  ChunkId,
  ChunkRecord,
  CorpusId,
  NoteLifecycleState,
  NoteId,
  ControlledTag,
  NoteType
} from "@multi-agent-brain/domain";
import type { QueryHistoryRequest, QueryHistoryResponse } from "@multi-agent-brain/contracts";

export interface MetadataNoteRecord {
  noteId: NoteId;
  corpusId: CorpusId;
  notePath: string;
  noteType: NoteType;
  lifecycleState: NoteLifecycleState;
  revision: string;
  updatedAt: string;
  currentState: boolean;
  summary?: string;
  scope?: string;
  tags?: ControlledTag[];
  contentHash?: string;
  semanticSignature?: string;
}

export interface PromotionDecisionRecord {
  draftNoteId: NoteId;
  canonicalNoteId: NoteId;
  supersededNoteIds: NoteId[];
  promotedAt: string;
}

export interface MetadataControlStore {
  upsertNote(note: MetadataNoteRecord): Promise<void>;
  upsertChunks(chunks: ChunkRecord[]): Promise<void>;
  removeChunksByNoteId(noteId: NoteId): Promise<void>;
  getChunksByIds(chunkIds: ChunkId[]): Promise<ChunkRecord[]>;
  getChunkNeighborhood(chunkId: ChunkId, radius: number): Promise<ChunkRecord[]>;
  findPotentialDuplicates(input: {
    corpusId: CorpusId;
    contentHash?: string;
    semanticSignature?: string;
  }): Promise<MetadataNoteRecord[]>;
  recordPromotion(decision: PromotionDecisionRecord): Promise<void>;
  queryHistory(request: QueryHistoryRequest): Promise<QueryHistoryResponse>;
}
