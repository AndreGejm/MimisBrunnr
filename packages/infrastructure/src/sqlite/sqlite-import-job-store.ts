import { DatabaseSync } from "node:sqlite";
import type { ImportJobStore } from "@multi-agent-brain/application";
import type { ImportJob } from "@multi-agent-brain/domain";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "./shared-sqlite-connection.js";

interface SqliteImportJobRow {
  import_job_id: string;
  authority_state: ImportJob["authorityState"];
  state: ImportJob["state"];
  source_path: string;
  import_kind: string;
  source_name: string;
  source_digest: string;
  source_size_bytes: number;
  source_preview: string;
  draft_note_ids_json: string;
  canonical_outputs_json: string;
  created_at: string;
  updated_at: string;
}

export class SqliteImportJobStore implements ImportJobStore {
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

  async createImportJob(importJob: ImportJob): Promise<ImportJob> {
    this.database.prepare(`
      INSERT INTO import_jobs (
        import_job_id,
        authority_state,
        state,
        source_path,
        import_kind,
        source_name,
        source_digest,
        source_size_bytes,
        source_preview,
        draft_note_ids_json,
        canonical_outputs_json,
        created_at,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(import_job_id) DO UPDATE SET
        authority_state = excluded.authority_state,
        state = excluded.state,
        source_path = excluded.source_path,
        import_kind = excluded.import_kind,
        source_name = excluded.source_name,
        source_digest = excluded.source_digest,
        source_size_bytes = excluded.source_size_bytes,
        source_preview = excluded.source_preview,
        draft_note_ids_json = excluded.draft_note_ids_json,
        canonical_outputs_json = excluded.canonical_outputs_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      importJob.importJobId,
      importJob.authorityState,
      importJob.state,
      importJob.sourcePath,
      importJob.importKind,
      importJob.sourceName,
      importJob.sourceDigest,
      importJob.sourceSizeBytes,
      importJob.sourcePreview,
      JSON.stringify(importJob.draftNoteIds),
      JSON.stringify(importJob.canonicalOutputs),
      importJob.createdAt,
      importJob.updatedAt
    );

    const persisted = await this.getImportJob(importJob.importJobId);
    return persisted ?? importJob;
  }

  async getImportJob(importJobId: string): Promise<ImportJob | undefined> {
    const row = this.database.prepare(`
      SELECT
        import_job_id,
        authority_state,
        state,
        source_path,
        import_kind,
        source_name,
        source_digest,
        source_size_bytes,
        source_preview,
        draft_note_ids_json,
        canonical_outputs_json,
        created_at,
        updated_at
      FROM import_jobs
      WHERE import_job_id = ?
      LIMIT 1
    `).get(importJobId) as SqliteImportJobRow | undefined;

    return row ? this.mapImportJobRow(row) : undefined;
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS import_jobs (
        import_job_id TEXT PRIMARY KEY,
        authority_state TEXT NOT NULL,
        state TEXT NOT NULL,
        source_path TEXT NOT NULL,
        import_kind TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        source_size_bytes INTEGER NOT NULL,
        source_preview TEXT NOT NULL,
        draft_note_ids_json TEXT NOT NULL,
        canonical_outputs_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON import_jobs(created_at);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_source_path ON import_jobs(source_path);
      CREATE INDEX IF NOT EXISTS idx_import_jobs_authority_state ON import_jobs(authority_state);
    `);
  }

  private mapImportJobRow(row: SqliteImportJobRow): ImportJob {
    return {
      importJobId: row.import_job_id,
      authorityState: row.authority_state,
      state: row.state,
      sourcePath: row.source_path,
      importKind: row.import_kind,
      sourceName: row.source_name,
      sourceDigest: row.source_digest,
      sourceSizeBytes: row.source_size_bytes,
      sourcePreview: row.source_preview,
      draftNoteIds: JSON.parse(row.draft_note_ids_json) as ImportJob["draftNoteIds"],
      canonicalOutputs: JSON.parse(row.canonical_outputs_json) as ImportJob["canonicalOutputs"],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
