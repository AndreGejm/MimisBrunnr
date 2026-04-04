import type { ActorContext } from "../common/actor-context.js";
import type { NoteFrontmatter, NoteId } from "./create-refresh-draft.imports.js";

export type TemporalRefreshState =
  | "expired"
  | "future_dated"
  | "expiring_soon";

export interface CreateRefreshDraftRequest {
  actor: ActorContext;
  noteId: NoteId;
  asOf?: string;
  expiringWithinDays?: number;
  bodyHints?: string[];
}

export interface CreateRefreshDraftResponse {
  sourceNoteId: NoteId;
  sourceNotePath: string;
  sourceState: TemporalRefreshState;
  draftNoteId: NoteId;
  draftPath: string;
  frontmatter: NoteFrontmatter;
  body: string;
  warnings: string[];
}
