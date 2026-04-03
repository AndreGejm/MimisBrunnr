import type { CorpusId } from "../corpora/corpus-id.js";
import type { NoteLifecycleState } from "../lifecycle/note-lifecycle-state.js";
import type { ControlledTag } from "../tags/controlled-tag.js";
import type { NoteId } from "./note-id.js";
import type { NoteType } from "./note-type.js";

export interface NoteFrontmatter {
  noteId: NoteId;
  title: string;
  project: string;
  type: NoteType;
  status: NoteLifecycleState;
  updated: string;
  summary: string;
  tags: ControlledTag[];
  scope: string;
  corpusId: CorpusId;
  currentState: boolean;
  supersedes?: NoteId[];
  supersededBy?: NoteId;
}
