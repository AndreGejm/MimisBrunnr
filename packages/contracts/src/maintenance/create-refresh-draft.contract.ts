import type { ActorContext } from "../common/actor-context.js";
import type {
  CorpusId,
  NoteFrontmatter,
  NoteId
} from "./create-refresh-draft.imports.js";

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
  reusedExistingDraft: boolean;
  warnings: string[];
}

export interface CreateRefreshDraftBatchRequest {
  actor: ActorContext;
  asOf?: string;
  expiringWithinDays?: number;
  corpusId?: CorpusId;
  limitPerCategory?: number;
  maxDrafts?: number;
  sourceStates?: TemporalRefreshState[];
  bodyHints?: string[];
}

export interface CreateRefreshDraftBatchSkippedItem {
  noteId: NoteId;
  sourceState: TemporalRefreshState;
  reason: string;
}

export interface CreateRefreshDraftBatchResponse {
  asOf: string;
  expiringWithinDays: number;
  corpusId?: CorpusId;
  limitPerCategory: number;
  maxDrafts: number;
  sourceStates: TemporalRefreshState[];
  candidatesConsidered: number;
  candidatesRemaining: number;
  createdCount: number;
  reusedCount: number;
  drafts: CreateRefreshDraftResponse[];
  skipped: CreateRefreshDraftBatchSkippedItem[];
  warnings: string[];
}
