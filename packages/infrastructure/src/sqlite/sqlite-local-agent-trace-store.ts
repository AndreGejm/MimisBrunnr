import { DatabaseSync } from "node:sqlite";
import type { LocalAgentTraceRecord, LocalAgentTraceStore } from "@mimir/domain";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "./shared-sqlite-connection.js";

interface SqliteLocalAgentTraceRow {
  trace_id: string;
  request_id: string;
  actor_id: string;
  task_type: string;
  model_role: string;
  model_id: string | null;
  memory_context_included: number;
  retrieval_trace_included: number;
  tool_used: string | null;
  status: LocalAgentTraceRecord["status"];
  reason: string | null;
  provider_error_kind: string | null;
  retry_count: number | null;
  seed_applied: number | null;
  advisory_invoked: number | null;
  advisory_provider_id: string | null;
  advisory_model_id: string | null;
  advisory_outcome_class: string | null;
  advisory_error_code: string | null;
  advisory_recommended_action: string | null;
  created_at: string;
}

export class SqliteLocalAgentTraceStore implements LocalAgentTraceStore {
  private readonly database: DatabaseSync;
  private readonly sharedConnection: SharedSqliteConnection;
  private closed = false;

  constructor(databasePath: string) {
    this.sharedConnection = acquireSharedSqliteConnection(databasePath);
    this.database = this.sharedConnection.database;
    this.initialize();
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.sharedConnection.release();
    this.closed = true;
  }

  async append(record: LocalAgentTraceRecord): Promise<void> {
    this.database.prepare(`
      INSERT INTO local_agent_trace (
        trace_id,
        request_id,
        actor_id,
        task_type,
        model_role,
        model_id,
        memory_context_included,
        retrieval_trace_included,
        tool_used,
        status,
        reason,
        provider_error_kind,
        retry_count,
        seed_applied,
        advisory_invoked,
        advisory_provider_id,
        advisory_model_id,
        advisory_outcome_class,
        advisory_error_code,
        advisory_recommended_action,
        created_at
      ) VALUES (
        :traceId,
        :requestId,
        :actorId,
        :taskType,
        :modelRole,
        :modelId,
        :memoryContextIncluded,
        :retrievalTraceIncluded,
        :toolUsed,
        :status,
        :reason,
        :providerErrorKind,
        :retryCount,
        :seedApplied,
        :advisoryInvoked,
        :advisoryProviderId,
        :advisoryModelId,
        :advisoryOutcomeClass,
        :advisoryErrorCode,
        :advisoryRecommendedAction,
        :createdAt
      )
    `).run({
      traceId: record.traceId,
      requestId: record.requestId,
      actorId: record.actorId,
      taskType: record.taskType,
      modelRole: record.modelRole,
      modelId: record.modelId ?? null,
      memoryContextIncluded: record.memoryContextIncluded ? 1 : 0,
      retrievalTraceIncluded: record.retrievalTraceIncluded ? 1 : 0,
      toolUsed: record.toolUsed ?? null,
      status: record.status,
      reason: record.reason ?? null,
      providerErrorKind: record.providerErrorKind ?? null,
      retryCount: record.retryCount ?? null,
      seedApplied:
        record.seedApplied === undefined ? null : record.seedApplied ? 1 : 0,
      advisoryInvoked:
        record.advisoryInvoked === undefined ? null : record.advisoryInvoked ? 1 : 0,
      advisoryProviderId: record.advisoryProviderId ?? null,
      advisoryModelId: record.advisoryModelId ?? null,
      advisoryOutcomeClass: record.advisoryOutcomeClass ?? null,
      advisoryErrorCode: record.advisoryErrorCode ?? null,
      advisoryRecommendedAction: record.advisoryRecommendedAction ?? null,
      createdAt: record.createdAt
    });
  }

  async listByRequest(requestId: string): Promise<LocalAgentTraceRecord[]> {
    const rows = this.database.prepare(`
      SELECT
        trace_id,
        request_id,
        actor_id,
        task_type,
        model_role,
        model_id,
        memory_context_included,
        retrieval_trace_included,
        tool_used,
        status,
        reason,
        provider_error_kind,
        retry_count,
        seed_applied,
        advisory_invoked,
        advisory_provider_id,
        advisory_model_id,
        advisory_outcome_class,
        advisory_error_code,
        advisory_recommended_action,
        created_at
      FROM local_agent_trace
      WHERE request_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(requestId) as unknown as SqliteLocalAgentTraceRow[];

    return rows.map((row) => ({
      traceId: row.trace_id,
      requestId: row.request_id,
      actorId: row.actor_id,
      taskType: row.task_type,
      modelRole: row.model_role,
      modelId: row.model_id ?? undefined,
      memoryContextIncluded: Boolean(row.memory_context_included),
      retrievalTraceIncluded: Boolean(row.retrieval_trace_included),
      toolUsed: row.tool_used ?? undefined,
      status: row.status,
      reason: row.reason ?? undefined,
      providerErrorKind: row.provider_error_kind ?? undefined,
      retryCount: row.retry_count ?? undefined,
      seedApplied: row.seed_applied === null ? undefined : Boolean(row.seed_applied),
      advisoryInvoked:
        row.advisory_invoked === null ? undefined : Boolean(row.advisory_invoked),
      advisoryProviderId: row.advisory_provider_id ?? undefined,
      advisoryModelId: row.advisory_model_id ?? undefined,
      advisoryOutcomeClass: row.advisory_outcome_class ?? undefined,
      advisoryErrorCode: row.advisory_error_code ?? undefined,
      advisoryRecommendedAction: row.advisory_recommended_action ?? undefined,
      createdAt: row.created_at
    }));
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS local_agent_trace (
        trace_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        model_role TEXT NOT NULL,
        model_id TEXT,
        memory_context_included INTEGER NOT NULL,
        retrieval_trace_included INTEGER NOT NULL,
        tool_used TEXT,
        status TEXT NOT NULL,
        reason TEXT,
        provider_error_kind TEXT,
        retry_count INTEGER,
        seed_applied INTEGER,
        advisory_invoked INTEGER,
        advisory_provider_id TEXT,
        advisory_model_id TEXT,
        advisory_outcome_class TEXT,
        advisory_error_code TEXT,
        advisory_recommended_action TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_local_agent_trace_request_id
      ON local_agent_trace (request_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_local_agent_trace_actor_id
      ON local_agent_trace (actor_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_local_agent_trace_created_at
      ON local_agent_trace (created_at);
    `);

    ensureTraceColumn(this.database, "advisory_invoked", "INTEGER");
    ensureTraceColumn(this.database, "advisory_provider_id", "TEXT");
    ensureTraceColumn(this.database, "advisory_model_id", "TEXT");
    ensureTraceColumn(this.database, "advisory_outcome_class", "TEXT");
    ensureTraceColumn(this.database, "advisory_error_code", "TEXT");
    ensureTraceColumn(this.database, "advisory_recommended_action", "TEXT");
  }
}

function ensureTraceColumn(
  database: DatabaseSync,
  columnName: string,
  definition: string
): void {
  const columns = database.prepare("PRAGMA table_info(local_agent_trace)").all() as Array<{
    name: string;
  }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  database.exec(`ALTER TABLE local_agent_trace ADD COLUMN ${columnName} ${definition}`);
}
