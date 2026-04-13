export type LocalAgentTraceStatus =
  | "started"
  | "succeeded"
  | "failed"
  | "retried";

export interface LocalAgentTraceRecord {
  traceId: string;
  requestId: string;
  actorId: string;
  taskType: string;
  modelRole: string;
  modelId?: string;
  memoryContextIncluded: boolean;
  retrievalTraceIncluded: boolean;
  toolUsed?: string;
  status: LocalAgentTraceStatus;
  reason?: string;
  providerErrorKind?: string;
  retryCount?: number;
  seedApplied?: boolean;
  createdAt: string;
}

export interface LocalAgentTraceStore {
  append(record: LocalAgentTraceRecord): Promise<void>;
  listByRequest(requestId: string): Promise<LocalAgentTraceRecord[]>;
}
