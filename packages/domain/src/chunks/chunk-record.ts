import type { CorpusId } from "../corpora/corpus-id.js";
import type { NoteId } from "../notes/note-id.js";
import type { NoteType } from "../notes/note-type.js";
import type { ControlledTag } from "../tags/controlled-tag.js";
import type { ChunkId } from "./chunk-id.js";

export type ChunkStalenessClass = "current" | "stale" | "superseded";

export interface ChunkRecord {
  chunkId: ChunkId;
  noteId: NoteId;
  corpusId: CorpusId;
  noteType: NoteType;
  notePath: string;
  headingPath: string[];
  parentHeading?: string;
  prevChunkId?: ChunkId;
  nextChunkId?: ChunkId;
  rawText: string;
  summary: string;
  entities: string[];
  qualifiers: string[];
  scope: string;
  tags: ControlledTag[];
  stalenessClass: ChunkStalenessClass;
  validFrom?: string;
  validUntil?: string;
  tokenEstimate: number;
  updatedAt: string;
}
