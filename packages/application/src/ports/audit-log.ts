import type { AuditEntry } from "@mimir/domain";
import type { QueryHistoryRequest, QueryHistoryResponse } from "@mimir/contracts";

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
  query(request: QueryHistoryRequest): Promise<QueryHistoryResponse>;
}
