import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  MetadataControlStore,
  MetadataNoteRecord,
  PromotionDecisionRecord
} from "@multi-agent-brain/application";
import type { QueryHistoryRequest, QueryHistoryResponse } from "@multi-agent-brain/contracts";
import type { AuditEntry, ChunkId, ChunkRecord, NoteId } from "@multi-agent-brain/domain";

export class SqliteMetadataControlStore implements MetadataControlStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(private readonly databasePath: string) {
    mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.initialize();
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.database.close();
    this.closed = true;
  }

  async upsertNote(note: MetadataNoteRecord): Promise<void> {
    const insertNote = this.database.prepare(`
      INSERT INTO notes (
        note_id,
        corpus_id,
        note_path,
        note_type,
        lifecycle_state,
        revision,
        updated_at,
        current_state,
        summary,
        scope,
        content_hash,
        semantic_signature
      ) VALUES (
        :noteId,
        :corpusId,
        :notePath,
        :noteType,
        :lifecycleState,
        :revision,
        :updatedAt,
        :currentState,
        :summary,
        :scope,
        :contentHash,
        :semanticSignature
      )
      ON CONFLICT(note_id) DO UPDATE SET
        corpus_id = excluded.corpus_id,
        note_path = excluded.note_path,
        note_type = excluded.note_type,
        lifecycle_state = excluded.lifecycle_state,
        revision = excluded.revision,
        updated_at = excluded.updated_at,
        current_state = excluded.current_state,
        summary = excluded.summary,
        scope = excluded.scope,
        content_hash = excluded.content_hash,
        semantic_signature = excluded.semantic_signature
    `);
    const deleteTags = this.database.prepare(`DELETE FROM note_tags WHERE note_id = ?`);
    const insertTag = this.database.prepare(`
      INSERT INTO note_tags (note_id, tag)
      VALUES (?, ?)
      ON CONFLICT(note_id, tag) DO NOTHING
    `);

    this.database.exec("BEGIN");
    try {
      insertNote.run({
        noteId: note.noteId,
        corpusId: note.corpusId,
        notePath: note.notePath,
        noteType: note.noteType,
        lifecycleState: note.lifecycleState,
        revision: note.revision,
        updatedAt: note.updatedAt,
        currentState: note.currentState ? 1 : 0,
        summary: note.summary ?? null,
        scope: note.scope ?? null,
        contentHash: note.contentHash ?? null,
        semanticSignature: note.semanticSignature ?? null
      });

      deleteTags.run(note.noteId);
      for (const tag of note.tags ?? []) {
        insertTag.run(note.noteId, tag);
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async upsertChunks(chunks: ChunkRecord[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const insertChunk = this.database.prepare(`
      INSERT INTO chunks (
        chunk_id,
        note_id,
        corpus_id,
        note_type,
        note_path,
        heading_path_json,
        parent_heading,
        prev_chunk_id,
        next_chunk_id,
        raw_text,
        summary,
        entities_json,
        qualifiers_json,
        scope,
        staleness_class,
        token_estimate,
        updated_at
      ) VALUES (
        :chunkId,
        :noteId,
        :corpusId,
        :noteType,
        :notePath,
        :headingPathJson,
        :parentHeading,
        :prevChunkId,
        :nextChunkId,
        :rawText,
        :summary,
        :entitiesJson,
        :qualifiersJson,
        :scope,
        :stalenessClass,
        :tokenEstimate,
        :updatedAt
      )
      ON CONFLICT(chunk_id) DO UPDATE SET
        note_id = excluded.note_id,
        corpus_id = excluded.corpus_id,
        note_type = excluded.note_type,
        note_path = excluded.note_path,
        heading_path_json = excluded.heading_path_json,
        parent_heading = excluded.parent_heading,
        prev_chunk_id = excluded.prev_chunk_id,
        next_chunk_id = excluded.next_chunk_id,
        raw_text = excluded.raw_text,
        summary = excluded.summary,
        entities_json = excluded.entities_json,
        qualifiers_json = excluded.qualifiers_json,
        scope = excluded.scope,
        staleness_class = excluded.staleness_class,
        token_estimate = excluded.token_estimate,
        updated_at = excluded.updated_at
    `);
    const deleteChunkTags = this.database.prepare(`DELETE FROM chunk_tags WHERE chunk_id = ?`);
    const insertChunkTag = this.database.prepare(`
      INSERT INTO chunk_tags (chunk_id, tag)
      VALUES (?, ?)
      ON CONFLICT(chunk_id, tag) DO NOTHING
    `);

    this.database.exec("BEGIN");
    try {
      for (const chunk of chunks) {
        insertChunk.run({
          chunkId: chunk.chunkId,
          noteId: chunk.noteId,
          corpusId: chunk.corpusId,
          noteType: chunk.noteType,
          notePath: chunk.notePath,
          headingPathJson: JSON.stringify(chunk.headingPath),
          parentHeading: chunk.parentHeading ?? null,
          prevChunkId: chunk.prevChunkId ?? null,
          nextChunkId: chunk.nextChunkId ?? null,
          rawText: chunk.rawText,
          summary: chunk.summary,
          entitiesJson: JSON.stringify(chunk.entities),
          qualifiersJson: JSON.stringify(chunk.qualifiers),
          scope: chunk.scope,
          stalenessClass: chunk.stalenessClass,
          tokenEstimate: chunk.tokenEstimate,
          updatedAt: chunk.updatedAt
        });

        deleteChunkTags.run(chunk.chunkId);
        for (const tag of chunk.tags) {
          insertChunkTag.run(chunk.chunkId, tag);
        }
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async removeChunksByNoteId(noteId: NoteId): Promise<void> {
    this.database.exec("BEGIN");
    try {
      this.database.prepare(`
        DELETE FROM chunk_tags
        WHERE chunk_id IN (
          SELECT chunk_id
          FROM chunks
          WHERE note_id = ?
        )
      `).run(noteId);
      this.database.prepare(`
        DELETE FROM chunks
        WHERE note_id = ?
      `).run(noteId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async getChunksByIds(chunkIds: ChunkId[]): Promise<ChunkRecord[]> {
    if (chunkIds.length === 0) {
      return [];
    }

    const placeholders = chunkIds.map(() => "?").join(", ");
    const rows = this.database.prepare(`
      SELECT
        chunk_id,
        note_id,
        corpus_id,
        note_type,
        note_path,
        heading_path_json,
        parent_heading,
        prev_chunk_id,
        next_chunk_id,
        raw_text,
        summary,
        entities_json,
        qualifiers_json,
        scope,
        staleness_class,
        token_estimate,
        updated_at
      FROM chunks
      WHERE chunk_id IN (${placeholders})
    `).all(...chunkIds) as unknown as SqliteChunkRow[];

    const order = new Map(chunkIds.map((chunkId, index) => [chunkId, index]));
    return rows
      .map((row) => this.mapChunkRow(row))
      .sort((left, right) => (order.get(left.chunkId) ?? 0) - (order.get(right.chunkId) ?? 0));
  }

  async getChunkNeighborhood(chunkId: ChunkId, radius: number): Promise<ChunkRecord[]> {
    const center = await this.getChunksByIds([chunkId]);
    if (center.length === 0) {
      return [];
    }

    const visited = new Set<ChunkId>([chunkId]);
    const ordered: ChunkRecord[] = [];
    let cursor = center[0];

    for (let index = 0; index < radius && cursor.prevChunkId; index += 1) {
      const previous = await this.getChunksByIds([cursor.prevChunkId]);
      if (previous.length === 0 || visited.has(previous[0].chunkId)) {
        break;
      }
      visited.add(previous[0].chunkId);
      ordered.unshift(previous[0]);
      cursor = previous[0];
    }

    ordered.push(center[0]);
    cursor = center[0];

    for (let index = 0; index < radius && cursor.nextChunkId; index += 1) {
      const next = await this.getChunksByIds([cursor.nextChunkId]);
      if (next.length === 0 || visited.has(next[0].chunkId)) {
        break;
      }
      visited.add(next[0].chunkId);
      ordered.push(next[0]);
      cursor = next[0];
    }

    return ordered;
  }

  async findPotentialDuplicates(input: {
    corpusId: MetadataNoteRecord["corpusId"];
    contentHash?: string;
    semanticSignature?: string;
  }): Promise<MetadataNoteRecord[]> {
    if (!input.contentHash && !input.semanticSignature) {
      return [];
    }

    const rows = this.database.prepare(`
      SELECT
        note_id,
        corpus_id,
        note_path,
        note_type,
        lifecycle_state,
        revision,
        updated_at,
        current_state,
        summary,
        scope,
        content_hash,
        semantic_signature
      FROM notes
      WHERE corpus_id = :corpusId
        AND (
          (:contentHash IS NOT NULL AND content_hash = :contentHash)
          OR
          (:semanticSignature IS NOT NULL AND semantic_signature = :semanticSignature)
        )
      ORDER BY updated_at DESC
    `).all({
      corpusId: input.corpusId,
      contentHash: input.contentHash ?? null,
      semanticSignature: input.semanticSignature ?? null
    }) as unknown as SqliteNoteRow[];

    return rows.map((row) => this.mapNoteRow(row));
  }

  async recordPromotion(decision: PromotionDecisionRecord): Promise<void> {
    this.database.prepare(`
      INSERT INTO promotion_events (
        promotion_event_id,
        draft_note_id,
        canonical_note_id,
        superseded_note_ids_json,
        promoted_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      decision.draftNoteId,
      decision.canonicalNoteId,
      JSON.stringify(decision.supersededNoteIds),
      decision.promotedAt
    );
  }

  async queryHistory(request: QueryHistoryRequest): Promise<QueryHistoryResponse> {
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
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS notes (
        note_id TEXT PRIMARY KEY,
        corpus_id TEXT NOT NULL,
        note_path TEXT NOT NULL UNIQUE,
        note_type TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL,
        revision TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        current_state INTEGER NOT NULL,
        summary TEXT,
        scope TEXT,
        content_hash TEXT,
        semantic_signature TEXT
      );

      CREATE TABLE IF NOT EXISTS note_tags (
        note_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (note_id, tag),
        FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS note_relationships (
        source_note_id TEXT NOT NULL,
        target_note_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        PRIMARY KEY (source_note_id, target_note_id, relationship_type),
        FOREIGN KEY (source_note_id) REFERENCES notes(note_id) ON DELETE CASCADE,
        FOREIGN KEY (target_note_id) REFERENCES notes(note_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        corpus_id TEXT NOT NULL,
        note_type TEXT NOT NULL,
        note_path TEXT NOT NULL,
        heading_path_json TEXT NOT NULL,
        parent_heading TEXT,
        prev_chunk_id TEXT,
        next_chunk_id TEXT,
        raw_text TEXT NOT NULL,
        summary TEXT NOT NULL,
        entities_json TEXT NOT NULL,
        qualifiers_json TEXT NOT NULL,
        scope TEXT NOT NULL,
        staleness_class TEXT NOT NULL,
        token_estimate INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chunk_tags (
        chunk_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (chunk_id, tag),
        FOREIGN KEY (chunk_id) REFERENCES chunks(chunk_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS promotion_events (
        promotion_event_id TEXT PRIMARY KEY,
        draft_note_id TEXT NOT NULL,
        canonical_note_id TEXT NOT NULL,
        superseded_note_ids_json TEXT NOT NULL,
        promoted_at TEXT NOT NULL
      );

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
        PRIMARY KEY (audit_entry_id, note_id),
        FOREIGN KEY (audit_entry_id) REFERENCES audit_entries(audit_entry_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_entry_chunk_links (
        audit_entry_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        PRIMARY KEY (audit_entry_id, chunk_id),
        FOREIGN KEY (audit_entry_id) REFERENCES audit_entries(audit_entry_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_notes_corpus_id ON notes(corpus_id);
      CREATE INDEX IF NOT EXISTS idx_notes_content_hash ON notes(content_hash);
      CREATE INDEX IF NOT EXISTS idx_notes_semantic_signature ON notes(semantic_signature);
      CREATE INDEX IF NOT EXISTS idx_chunks_note_id ON chunks(note_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_corpus_id ON chunks(corpus_id);
      CREATE INDEX IF NOT EXISTS idx_promotion_events_promoted_at ON promotion_events(promoted_at);
      CREATE INDEX IF NOT EXISTS idx_audit_entries_occurred_at ON audit_entries(occurred_at);
    `);
  }

  private mapNoteRow(row: SqliteNoteRow): MetadataNoteRecord {
    const tags = this.database.prepare(`
      SELECT tag
      FROM note_tags
      WHERE note_id = ?
      ORDER BY tag ASC
    `).all(row.note_id) as Array<{ tag: NonNullable<MetadataNoteRecord["tags"]>[number] }>;

    return {
      noteId: row.note_id,
      corpusId: row.corpus_id,
      notePath: row.note_path,
      noteType: row.note_type,
      lifecycleState: row.lifecycle_state,
      revision: row.revision,
      updatedAt: row.updated_at,
      currentState: row.current_state === 1,
      summary: row.summary ?? undefined,
      scope: row.scope ?? undefined,
      contentHash: row.content_hash ?? undefined,
      semanticSignature: row.semantic_signature ?? undefined,
      tags: tags.map((tag) => tag.tag)
    };
  }

  private mapChunkRow(row: SqliteChunkRow): ChunkRecord {
    const tags = this.database.prepare(`
      SELECT tag
      FROM chunk_tags
      WHERE chunk_id = ?
      ORDER BY tag ASC
    `).all(row.chunk_id) as Array<{ tag: ChunkRecord["tags"][number] }>;

    return {
      chunkId: row.chunk_id,
      noteId: row.note_id,
      corpusId: row.corpus_id,
      noteType: row.note_type,
      notePath: row.note_path,
      headingPath: JSON.parse(row.heading_path_json) as string[],
      parentHeading: row.parent_heading ?? undefined,
      prevChunkId: row.prev_chunk_id ?? undefined,
      nextChunkId: row.next_chunk_id ?? undefined,
      rawText: row.raw_text,
      summary: row.summary,
      entities: JSON.parse(row.entities_json) as string[],
      qualifiers: JSON.parse(row.qualifiers_json) as string[],
      scope: row.scope,
      tags: tags.map((tag) => tag.tag),
      stalenessClass: row.staleness_class,
      tokenEstimate: row.token_estimate,
      updatedAt: row.updated_at
    };
  }
}

interface SqliteNoteRow {
  note_id: string;
  corpus_id: MetadataNoteRecord["corpusId"];
  note_path: string;
  note_type: MetadataNoteRecord["noteType"];
  lifecycle_state: MetadataNoteRecord["lifecycleState"];
  revision: string;
  updated_at: string;
  current_state: number;
  summary: string | null;
  scope: string | null;
  content_hash: string | null;
  semantic_signature: string | null;
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

interface SqliteChunkRow {
  chunk_id: string;
  note_id: string;
  corpus_id: ChunkRecord["corpusId"];
  note_type: ChunkRecord["noteType"];
  note_path: string;
  heading_path_json: string;
  parent_heading: string | null;
  prev_chunk_id: string | null;
  next_chunk_id: string | null;
  raw_text: string;
  summary: string;
  entities_json: string;
  qualifiers_json: string;
  scope: string;
  staleness_class: ChunkRecord["stalenessClass"];
  token_estimate: number;
  updated_at: string;
}
