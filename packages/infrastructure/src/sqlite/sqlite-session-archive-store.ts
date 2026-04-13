import { DatabaseSync } from "node:sqlite";
import type {
  SessionArchiveSearchQuery,
  SessionArchiveStore,
  StoredSessionArchive
} from "@multi-agent-brain/application";
import type { SearchSessionArchivesResponse } from "@multi-agent-brain/contracts";
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

interface SqliteSessionArchiveSearchRow {
  archive_id: string;
  session_id: string;
  message_index: number;
  role: SessionArchiveMessage["role"];
  content: string;
  created_at: string;
  rank: number;
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
    this.database.exec("BEGIN IMMEDIATE");
    try {
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

      const insertMessage = this.database.prepare(`
        INSERT INTO session_archive_messages_fts (
          archive_id,
          session_id,
          message_index,
          role,
          content,
          created_at
        ) VALUES (
          :archiveId,
          :sessionId,
          :messageIndex,
          :role,
          :content,
          :createdAt
        )
      `);

      for (const [index, message] of record.messages.entries()) {
        insertMessage.run({
          archiveId: record.archive.archiveId,
          sessionId: record.archive.sessionId,
          messageIndex: index,
          role: message.role,
          content: message.content,
          createdAt: record.archive.createdAt
        });
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
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

  async searchArchives(
    query: SessionArchiveSearchQuery
  ): Promise<SearchSessionArchivesResponse> {
    const ftsQuery = buildFtsQuery(query.query);
    if (!ftsQuery) {
      return emptySearchResponse(query);
    }

    const statement = this.database.prepare(`
      SELECT
        archive_id,
        session_id,
        message_index,
        role,
        content,
        created_at,
        bm25(session_archive_messages_fts) AS rank
      FROM session_archive_messages_fts
      WHERE session_archive_messages_fts MATCH :query
        AND (:sessionId IS NULL OR session_id = :sessionId)
      ORDER BY rank ASC, created_at DESC
      LIMIT :limit
    `);

    const rows = statement.all({
      query: ftsQuery,
      sessionId: query.sessionId ?? null,
      limit: query.limit * 2
    }) as unknown as SqliteSessionArchiveSearchRow[];

    let tokenEstimate = 0;
    let truncated = false;
    const hits: SearchSessionArchivesResponse["hits"] = [];
    for (const row of rows) {
      const nextEstimate = estimateTokens(row.content);
      if (hits.length >= query.limit || tokenEstimate + nextEstimate > query.maxTokens) {
        truncated = rows.length > hits.length;
        break;
      }

      tokenEstimate += nextEstimate;
      hits.push({
        archiveId: row.archive_id,
        sessionId: row.session_id,
        messageIndex: Number(row.message_index),
        role: row.role,
        content: row.content,
        score: normalizeFtsScore(row.rank),
        createdAt: row.created_at,
        source: "session_archive",
        authority: "non_authoritative",
        promotionStatus: "not_applicable"
      });
    }

    return {
      hits,
      totalMatches: rows.length,
      truncated,
      budget: {
        limit: query.limit,
        maxTokens: query.maxTokens
      }
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

      CREATE VIRTUAL TABLE IF NOT EXISTS session_archive_messages_fts
      USING fts5(
        archive_id UNINDEXED,
        session_id UNINDEXED,
        message_index UNINDEXED,
        role UNINDEXED,
        content,
        created_at UNINDEXED,
        tokenize = 'porter unicode61'
      );
    `);
  }
}

function buildFtsQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .map((term) => term.replace(/[^A-Za-z0-9_-]/g, ""))
    .filter((term) => term.length >= 2)
    .slice(0, 12);

  return terms.map((term) => `"${term.replace(/"/g, "\"\"")}"`).join(" OR ");
}

function emptySearchResponse(
  query: SessionArchiveSearchQuery
): SearchSessionArchivesResponse {
  return {
    hits: [],
    totalMatches: 0,
    truncated: false,
    budget: {
      limit: query.limit,
      maxTokens: query.maxTokens
    }
  };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeFtsScore(rank: number): number {
  return Number.isFinite(rank) ? 1 / (1 + Math.max(0, rank)) : 0;
}
