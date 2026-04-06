import { DatabaseSync } from "node:sqlite";
import type {
  ContextRepresentationRecord,
  ContextRepresentationStore
} from "@multi-agent-brain/application";
import type { ContextRepresentationLayer } from "@multi-agent-brain/application";
import { acquireSharedSqliteConnection, type SharedSqliteConnection } from "./shared-sqlite-connection.js";

interface SqliteContextRepresentationRow {
  note_id: string;
  layer: ContextRepresentationLayer;
  content: string;
  generated_at: string;
  source_hash: string;
}

export class SqliteContextRepresentationStore implements ContextRepresentationStore {
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

  async upsertRepresentations(input: {
    noteId: string;
    representations: Record<ContextRepresentationLayer, ContextRepresentationRecord>;
  }): Promise<void> {
    const deleteExisting = this.database.prepare(`
      DELETE FROM context_representations
      WHERE note_id = ?
    `);
    const insertRepresentation = this.database.prepare(`
      INSERT INTO context_representations (
        note_id,
        layer,
        content,
        generated_at,
        source_hash
      ) VALUES (
        :noteId,
        :layer,
        :content,
        :generatedAt,
        :sourceHash
      )
      ON CONFLICT(note_id, layer) DO UPDATE SET
        content = excluded.content,
        generated_at = excluded.generated_at,
        source_hash = excluded.source_hash
    `);

    this.database.exec("BEGIN");
    try {
      deleteExisting.run(input.noteId);
      for (const representation of Object.values(input.representations)) {
        insertRepresentation.run({
          noteId: input.noteId,
          layer: representation.layer,
          content: representation.content,
          generatedAt: representation.generatedAt,
          sourceHash: representation.sourceHash
        });
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async listRepresentations(noteId: string): Promise<ContextRepresentationRecord[]> {
    const rows = this.database.prepare(`
      SELECT
        note_id,
        layer,
        content,
        generated_at,
        source_hash
      FROM context_representations
      WHERE note_id = ?
      ORDER BY CASE layer WHEN 'L0' THEN 0 WHEN 'L1' THEN 1 ELSE 2 END ASC
    `).all(noteId) as unknown as SqliteContextRepresentationRow[];

    return rows.map((row) => ({
      noteId: row.note_id,
      layer: row.layer,
      content: row.content,
      generatedAt: row.generated_at,
      sourceHash: row.source_hash
    }));
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS context_representations (
        note_id TEXT NOT NULL,
        layer TEXT NOT NULL,
        content TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        PRIMARY KEY (note_id, layer)
      )
    `);
  }
}
