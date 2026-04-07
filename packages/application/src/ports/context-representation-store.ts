import type { NoteId } from "@multi-agent-brain/domain";

export type ContextRepresentationLayer = "L0" | "L1";

export interface ContextRepresentationRecord {
  noteId: NoteId;
  layer: ContextRepresentationLayer;
  content: string;
  generatedAt: string;
  sourceHash: string;
}

export interface ContextRepresentationStore {
  upsertRepresentations(input: {
    noteId: NoteId;
    representations: Record<ContextRepresentationLayer, ContextRepresentationRecord>;
  }): Promise<void>;

  listRepresentations(noteId: NoteId): Promise<ContextRepresentationRecord[]>;
}
