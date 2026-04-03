import { randomUUID } from "node:crypto";
import type { AuditLog } from "../ports/audit-log.js";
import type { QueryHistoryRequest, QueryHistoryResponse, ServiceResult } from "@multi-agent-brain/contracts";
import type { AuditEntry } from "@multi-agent-brain/domain";

type AuditHistoryErrorCode = "forbidden" | "query_failed" | "write_failed";

const HISTORY_READ_ROLES = new Set(["retrieval", "writer", "orchestrator", "operator", "system"]);
const HISTORY_WRITE_ROLES = new Set(["writer", "orchestrator", "operator", "system"]);

export class AuditHistoryService {
  constructor(private readonly auditLog: AuditLog) {}

  async queryHistory(
    request: QueryHistoryRequest
  ): Promise<ServiceResult<QueryHistoryResponse, AuditHistoryErrorCode>> {
    if (!HISTORY_READ_ROLES.has(request.actor.actorRole)) {
      return {
        ok: false,
        error: {
          code: "forbidden",
          message: `Actor role '${request.actor.actorRole}' cannot query audit history.`
        }
      };
    }

    try {
      const normalizedRequest: QueryHistoryRequest = {
        ...request,
        limit: Math.max(1, Math.min(request.limit, 200))
      };
      return {
        ok: true,
        data: await this.auditLog.query(normalizedRequest)
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "query_failed",
          message: "Failed to query audit history.",
          details: {
            reason: error instanceof Error ? error.message : String(error)
          }
        }
      };
    }
  }

  async recordAction(
    entry: Omit<AuditEntry, "auditEntryId">
  ): Promise<ServiceResult<AuditEntry, AuditHistoryErrorCode>> {
    if (!HISTORY_WRITE_ROLES.has(entry.actorRole)) {
      return {
        ok: false,
        error: {
          code: "forbidden",
          message: `Actor role '${entry.actorRole}' cannot write audit history.`
        }
      };
    }

    const fullEntry: AuditEntry = {
      ...entry,
      auditEntryId: randomUUID()
    };

    try {
      await this.auditLog.record(fullEntry);
      return {
        ok: true,
        data: fullEntry
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: "Failed to persist audit entry.",
          details: {
            reason: error instanceof Error ? error.message : String(error)
          }
        }
      };
    }
  }
}
