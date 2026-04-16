import type { ActorContext } from "../common/actor-context.js";
import type { ServiceResult } from "../common/service-result.js";
import type { CorpusId, NoteId, NoteType } from "@mimir/domain";

export type ReviewAuthorityRisk = "medium";
export type ReviewState =
  | "unreviewed"
  | "promotion_ready"
  | "rejected"
  | "promoted"
  | "superseded"
  | "archived";

export interface ReviewWarning {
  code: string;
  message: string;
}

export interface ReviewStep {
  step: string;
  status: "succeeded" | "skipped" | "failed";
  message: string;
}

export interface ReviewQueueItem {
  draftNoteId: NoteId;
  title: string;
  targetCorpus: CorpusId;
  scope?: string;
  noteType: NoteType;
  updatedAt: string;
  reviewState: ReviewState;
  authorityRisk: ReviewAuthorityRisk;
  warningSummary: string[];
}

export interface ListReviewQueueRequest {
  actor: ActorContext;
  targetCorpus?: CorpusId;
  includeRejected?: boolean;
}

export interface ListReviewQueueResponse {
  items: ReviewQueueItem[];
}

export type ListReviewQueueResult = ServiceResult<ListReviewQueueResponse>;

export interface ReadReviewNoteRequest {
  actor: ActorContext;
  draftNoteId: NoteId;
}

export interface ReadReviewNoteResponse {
  draftNoteId: NoteId;
  draftPath: string;
  title: string;
  targetCorpus: CorpusId;
  scope?: string;
  noteType: NoteType;
  updatedAt: string;
  reviewState: ReviewState;
  authorityRisk: ReviewAuthorityRisk;
  promotionEligible: boolean;
  body: string;
  provenance: unknown[];
  warnings: ReviewWarning[];
}

export type ReadReviewNoteResult = ServiceResult<ReadReviewNoteResponse>;

export interface AcceptNoteRequest {
  actor: ActorContext;
  draftNoteId: NoteId;
}

export interface AcceptNoteResponse {
  draftNoteId: NoteId;
  accepted: true;
  finalReviewState: "promotion_ready";
  promotedNoteId: NoteId;
  canonicalPath: string;
  supersededNoteIds: NoteId[];
  steps: ReviewStep[];
  retrievalWarning?: string;
}

export type AcceptNoteResult = ServiceResult<AcceptNoteResponse>;

export interface RejectNoteRequest {
  actor: ActorContext;
  draftNoteId: NoteId;
  reviewNotes?: string;
}

export interface RejectNoteResponse {
  draftNoteId: NoteId;
  rejected: true;
  finalReviewState: "rejected";
  draftPath: string;
  steps: ReviewStep[];
}

export type RejectNoteResult = ServiceResult<RejectNoteResponse>;
