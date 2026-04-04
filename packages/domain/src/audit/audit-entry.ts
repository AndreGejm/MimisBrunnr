import type { ChunkId } from "../chunks/chunk-id.js";
import type { NoteId } from "../notes/note-id.js";

export type AuditActionType =
  | "search_context"
  | "get_context_packet"
  | "retrieve_context"
  | "draft_note"
  | "create_refresh_draft"
  | "validate_note"
  | "promote_note"
  | "query_history"
  | "fetch_decision_summary"
  | "inspect_gap"
  | "execute_coding_task";

export interface AuditEntry {
  auditEntryId: string;
  actionType: AuditActionType;
  actorId: string;
  actorRole: string;
  source: string;
  toolName?: string;
  occurredAt: string;
  outcome: "accepted" | "rejected" | "partial";
  affectedNoteIds: NoteId[];
  affectedChunkIds: ChunkId[];
  detail?: Record<string, unknown>;
}
