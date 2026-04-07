import type { NoteId } from "../notes/note-id.js";
import type { ImportArtifactState } from "./import-artifact-state.js";

export const IMPORT_JOB_STATES = ["recorded", "failed"] as const;

export type ImportJobState = (typeof IMPORT_JOB_STATES)[number];

export interface ImportJob {
  importJobId: string;
  authorityState: ImportArtifactState;
  state: ImportJobState;
  sourcePath: string;
  importKind: string;
  sourceName: string;
  sourceDigest: string;
  sourceSizeBytes: number;
  sourcePreview: string;
  draftNoteIds: NoteId[];
  canonicalOutputs: string[];
  createdAt: string;
  updatedAt: string;
}
