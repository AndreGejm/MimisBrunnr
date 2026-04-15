import type { ChunkId, ChunkRecord, CorpusId, NoteId, NoteType } from "@mimir/domain";

export interface LexicalSearchHit {
  chunkId: ChunkId;
  score: number;
  matchedTerms: string[];
}

export interface LexicalIndex {
  upsertChunks(chunks: ChunkRecord[]): Promise<void>;
  removeByNoteId(noteId: NoteId): Promise<void>;
  search(input: {
    query: string;
    corpusIds: CorpusId[];
    noteTypes?: NoteType[];
    limit: number;
    includeSuperseded: boolean;
  }): Promise<LexicalSearchHit[]>;
}
