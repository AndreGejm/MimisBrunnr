import type { ChunkId, NoteId } from "@mimir/domain";

export interface ProvenanceRef {
  noteId: NoteId;
  chunkId?: ChunkId;
  notePath: string;
  headingPath: string[];
  excerpt?: string;
}
