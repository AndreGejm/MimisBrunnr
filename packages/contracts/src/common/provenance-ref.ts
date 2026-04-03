import type { ChunkId, NoteId } from "@multi-agent-brain/domain";

export interface ProvenanceRef {
  noteId: NoteId;
  chunkId?: ChunkId;
  notePath: string;
  headingPath: string[];
  excerpt?: string;
}
