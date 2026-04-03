import type { AuditEntry, NoteId } from "@multi-agent-brain/domain";
import type { ActorContext } from "../common/actor-context.js";

export interface QueryHistoryRequest {
  actor: ActorContext;
  noteId?: NoteId;
  since?: string;
  until?: string;
  limit: number;
}

export interface QueryHistoryResponse {
  entries: AuditEntry[];
}
