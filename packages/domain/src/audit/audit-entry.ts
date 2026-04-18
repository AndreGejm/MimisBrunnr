import type { ChunkId } from "../chunks/chunk-id.js";
import type { NoteId } from "../notes/note-id.js";

export const AUDIT_ACTION_TYPES = [
  "search_context",
  "get_context_packet",
  "retrieve_context",
  "draft_note",
  "create_refresh_draft",
  "issue_auth_token",
  "manage_auth_issuers",
  "revoke_auth_token",
  "validate_note",
  "promote_note",
  "query_history",
  "fetch_decision_summary",
  "inspect_gap",
  "execute_coding_task",
  "toolbox_discovery",
  "toolbox_activation_approved",
  "toolbox_activation_denied",
  "toolbox_lease_issued",
  "toolbox_lease_rejected",
  "toolbox_reconnect_generated",
  "toolbox_deactivated",
  "toolbox_expired"
] as const;

export type AuditActionType = (typeof AUDIT_ACTION_TYPES)[number];

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
