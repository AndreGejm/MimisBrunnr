import type { AuditEntry } from "@multi-agent-brain/domain";
import type { QueryHistoryRequest, QueryHistoryResponse } from "@multi-agent-brain/contracts";

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
  query(request: QueryHistoryRequest): Promise<QueryHistoryResponse>;
}
