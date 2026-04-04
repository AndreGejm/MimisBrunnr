import { DatabaseSync } from "node:sqlite";
import type { AuditLog } from "@multi-agent-brain/application";
import type { QueryHistoryRequest, QueryHistoryResponse } from "@multi-agent-brain/contracts";
import type { AuditEntry } from "@multi-agent-brain/domain";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "./shared-sqlite-connection.js";

export class SqliteAuditLog implements AuditLog {
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

  async record(entry: AuditEntry): Promise<void> {
    const insertAuditEntry = this.database.prepare(`
      INSERT INTO audit_entries (
        audit_entry_id,
        action_type,
        actor_id,
        actor_role,
        source,
        tool_name,
        occurred_at,
        outcome,
        detail_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertNoteLink = this.database.prepare(`
      INSERT INTO audit_entry_note_links (audit_entry_id, note_id)
      VALUES (?, ?)
      ON CONFLICT(audit_entry_id, note_id) DO NOTHING
    `);
    const insertChunkLink = this.database.prepare(`
      INSERT INTO audit_entry_chunk_links (audit_entry_id, chunk_id)
      VALUES (?, ?)
      ON CONFLICT(audit_entry_id, chunk_id) DO NOTHING
    `);

    this.database.exec("BEGIN");
    try {
      insertAuditEntry.run(
        entry.auditEntryId,
        entry.actionType,
        entry.actorId,
        entry.actorRole,
        entry.source,
        entry.toolName ?? null,
        entry.occurredAt,
        entry.outcome,
        entry.detail ? JSON.stringify(entry.detail) : null
      );

      for (const noteId of entry.affectedNoteIds) {
        insertNoteLink.run(entry.auditEntryId, noteId);
      }

      for (const chunkId of entry.affectedChunkIds) {
        insertChunkLink.run(entry.auditEntryId, chunkId);
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async query(request: QueryHistoryRequest): Promise<QueryHistoryResponse> {
    const limit = Math.max(1, request.limit);
    const rows = this.database.prepare(`
      SELECT
        ae.audit_entry_id,
        ae.action_type,
        ae.actor_id,
        ae.actor_role,
        ae.source,
        ae.tool_name,
        ae.occurred_at,
        ae.outcome,
        ae.detail_json
      FROM audit_entries ae
      WHERE
        (:since IS NULL OR ae.occurred_at >= :since)
        AND (:until IS NULL OR ae.occurred_at <= :until)
        AND (
          :noteId IS NULL
          OR EXISTS (
            SELECT 1
            FROM audit_entry_note_links aenl
            WHERE aenl.audit_entry_id = ae.audit_entry_id
              AND aenl.note_id = :noteId
          )
        )
      ORDER BY ae.occurred_at DESC
      LIMIT :limit
    `).all({
      noteId: request.noteId ?? null,
      since: request.since ?? null,
      until: request.until ?? null,
      limit
    }) as unknown as SqliteAuditRow[];

    const noteLinkStatement = this.database.prepare(`
      SELECT note_id
      FROM audit_entry_note_links
      WHERE audit_entry_id = ?
    `);
    const chunkLinkStatement = this.database.prepare(`
      SELECT chunk_id
      FROM audit_entry_chunk_links
      WHERE audit_entry_id = ?
    `);

    const entries: AuditEntry[] = rows.map((row) => ({
      auditEntryId: row.audit_entry_id,
      actionType: row.action_type as AuditEntry["actionType"],
      actorId: row.actor_id,
      actorRole: row.actor_role,
      source: row.source,
      toolName: row.tool_name ?? undefined,
      occurredAt: row.occurred_at,
      outcome: row.outcome as AuditEntry["outcome"],
      affectedNoteIds: (noteLinkStatement.all(row.audit_entry_id) as Array<{ note_id: string }>).map((item) => item.note_id),
      affectedChunkIds: (chunkLinkStatement.all(row.audit_entry_id) as Array<{ chunk_id: string }>).map((item) => item.chunk_id),
      detail: row.detail_json ? JSON.parse(row.detail_json) as Record<string, unknown> : undefined
    }));

    return { entries };
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS audit_entries (
        audit_entry_id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        source TEXT NOT NULL,
        tool_name TEXT,
        occurred_at TEXT NOT NULL,
        outcome TEXT NOT NULL,
        detail_json TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_entry_note_links (
        audit_entry_id TEXT NOT NULL,
        note_id TEXT NOT NULL,
        PRIMARY KEY (audit_entry_id, note_id)
      );

      CREATE TABLE IF NOT EXISTS audit_entry_chunk_links (
        audit_entry_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        PRIMARY KEY (audit_entry_id, chunk_id)
      );

      CREATE INDEX IF NOT EXISTS idx_audit_entries_occurred_at ON audit_entries(occurred_at);
    `);
  }
}

interface SqliteAuditRow {
  audit_entry_id: string;
  action_type: string;
  actor_id: string;
  actor_role: string;
  source: string;
  tool_name: string | null;
  occurred_at: string;
  outcome: string;
  detail_json: string | null;
}
