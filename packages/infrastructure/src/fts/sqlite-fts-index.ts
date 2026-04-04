import { DatabaseSync } from "node:sqlite";
import type { LexicalIndex, LexicalSearchHit } from "@multi-agent-brain/application";
import type { ChunkRecord, CorpusId, NoteId, NoteType } from "@multi-agent-brain/domain";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "../sqlite/shared-sqlite-connection.js";

const FTS_TABLE_NAME = "chunk_fts_index";

export class SqliteFtsIndex implements LexicalIndex {
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

  async upsertChunks(chunks: ChunkRecord[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const insertStatement = this.database.prepare(`
      INSERT INTO ${FTS_TABLE_NAME} (
        chunk_id,
        note_id,
        corpus_id,
        note_type,
        staleness_class,
        note_path,
        heading_path,
        summary,
        raw_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.database.exec("BEGIN");
    try {
      const noteIds = [...new Set(chunks.map((chunk) => chunk.noteId))];
      for (const noteId of noteIds) {
        await this.removeByNoteId(noteId);
      }

      for (const chunk of chunks) {
        insertStatement.run(
          chunk.chunkId,
          chunk.noteId,
          chunk.corpusId,
          chunk.noteType,
          chunk.stalenessClass,
          chunk.notePath,
          chunk.headingPath.join(" > "),
          chunk.summary,
          chunk.rawText
        );
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async removeByNoteId(noteId: NoteId): Promise<void> {
    this.database.prepare(`
      DELETE FROM ${FTS_TABLE_NAME}
      WHERE note_id = ?
    `).run(noteId);
  }

  async search(input: {
    query: string;
    corpusIds: CorpusId[];
    noteTypes?: NoteType[];
    limit: number;
    includeSuperseded: boolean;
  }): Promise<LexicalSearchHit[]> {
    const tokens = tokenizeQuery(input.query);
    if (tokens.length === 0 || input.corpusIds.length === 0 || input.limit <= 0) {
      return [];
    }

    const parameters: Array<string | number> = [
      buildMatchExpression(tokens),
      ...input.corpusIds
    ];
    const whereClauses = [
      `${FTS_TABLE_NAME} MATCH ?`,
      `corpus_id IN (${input.corpusIds.map(() => "?").join(", ")})`
    ];

    if (input.noteTypes && input.noteTypes.length > 0) {
      whereClauses.push(`note_type IN (${input.noteTypes.map(() => "?").join(", ")})`);
      parameters.push(...input.noteTypes);
    }

    if (!input.includeSuperseded) {
      whereClauses.push(`staleness_class != ?`);
      parameters.push("superseded");
    }

    parameters.push(Math.max(1, input.limit));

    const rows = this.database.prepare(`
      SELECT
        chunk_id,
        bm25(${FTS_TABLE_NAME}, 1.0, 0.4, 2.5, 1.4) AS rank
      FROM ${FTS_TABLE_NAME}
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY rank ASC
      LIMIT ?
    `).all(...parameters) as unknown as FtsSearchRow[];

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      score: normalizeBm25Score(row.rank),
      matchedTerms: tokens
    }));
  }

  private initialize(): void {
    this.database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE_NAME}
      USING fts5(
        chunk_id UNINDEXED,
        note_id UNINDEXED,
        corpus_id UNINDEXED,
        note_type UNINDEXED,
        staleness_class UNINDEXED,
        note_path,
        heading_path,
        summary,
        raw_text,
        tokenize = 'unicode61'
      );
    `);
  }
}

function tokenizeQuery(query: string): string[] {
  return [
    ...new Set(query.toLowerCase().match(/[a-z0-9][a-z0-9:_/-]{1,}/g) ?? [])
  ].slice(0, 12);
}

function buildMatchExpression(tokens: string[]): string {
  return tokens.map((token) => `"${token.replace(/"/g, "\"\"")}"`).join(" OR ");
}

function normalizeBm25Score(rank: number): number {
  const normalizedRank = Number.isFinite(rank) ? rank : 10;
  const score = 1 / (1 + Math.max(normalizedRank, 0));
  return Math.max(0, Math.min(score, 1));
}

interface FtsSearchRow {
  chunk_id: string;
  rank: number;
}
