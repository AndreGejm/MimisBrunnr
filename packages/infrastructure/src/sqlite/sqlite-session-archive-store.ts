import { DatabaseSync } from "node:sqlite";
import type {
  SessionArchiveStore,
  StoredSessionArchive
} from "@multi-agent-brain/application";
import type {
  SessionArchive,
  SessionArchiveMessage
} from "@multi-agent-brain/domain";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "./shared-sqlite-connection.js";

interface SqliteSessionArchiveRow {
  archive_id: string;
  session_id: string;
  uri: string;
  authority_state: SessionArchive["authorityState"];
  promotion_status: SessionArchive["promotionStatus"];
  message_count: number;
  created_at: string;
  messages_json: string;
}

export class SqliteSessionArchiveStore implements SessionArchiveStore {
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

  async createArchive(record: StoredSessionArchive): Promise<void> {
    this.database.prepare(`
      INSERT INTO session_archives (
        archive_id,
        session_id,
        uri,
        authority_state,
        promotion_status,
        message_count,
        created_at,
        messages_json
      ) VALUES (
        :archiveId,
        :sessionId,
        :uri,
        :authorityState,
        :promotionStatus,
        :messageCount,
        :createdAt,
        :messagesJson
      )
    `).run({
      archiveId: record.archive.archiveId,
      sessionId: record.archive.sessionId,
      uri: record.archive.uri,
      authorityState: record.archive.authorityState,
      promotionStatus: record.archive.promotionStatus,
      messageCount: record.archive.messageCount,
      createdAt: record.archive.createdAt,
      messagesJson: JSON.stringify(record.messages)
    });
  }

  async getArchiveById(
    archiveId: string
  ): Promise<StoredSessionArchive | undefined> {
    const row = this.database.prepare(`
      SELECT
        archive_id,
        session_id,
        uri,
        authority_state,
        promotion_status,
        message_count,
        created_at,
        messages_json
      FROM session_archives
      WHERE archive_id = ?
      LIMIT 1
    `).get(archiveId) as SqliteSessionArchiveRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      archive: {
        archiveId: row.archive_id,
        sessionId: row.session_id,
        uri: row.uri,
        authorityState: row.authority_state,
        promotionStatus: row.promotion_status,
        messageCount: row.message_count,
        createdAt: row.created_at
      },
      messages: JSON.parse(row.messages_json) as SessionArchiveMessage[]
    };
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS session_archives (
        archive_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        uri TEXT NOT NULL,
        authority_state TEXT NOT NULL,
        promotion_status TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        messages_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_archives_session_id
      ON session_archives (session_id, created_at);
    `);
  }
}
