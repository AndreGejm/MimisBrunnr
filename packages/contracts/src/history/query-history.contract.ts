import type { AuditActionType, AuditEntry, NoteId } from "@mimir/domain";
import type { ActorContext } from "../common/actor-context.js";

export interface QueryHistoryRequest {
  actor: ActorContext;
  actorId?: string;
  actionType?: AuditActionType;
  noteId?: NoteId;
  source?: string;
  since?: string;
  until?: string;
  limit: number;
}

export interface QueryHistoryResponse {
  entries: AuditEntry[];
}
