import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  MetadataControlStore,
  MetadataNoteRecord,
  NoteRelationshipDirection,
  NoteRelationshipRecord,
  NoteRelationshipType,
  PromotionDecisionRecord,
  PromotionOutboxPayload,
  PromotionOutboxRecord,
  PromotionOutboxState,
  TemporalValidityCandidate,
  TemporalValidityCandidateState,
  TemporalValidityReport,
  TemporalValiditySummary
} from "@mimir/application";
import type { QueryHistoryRequest, QueryHistoryResponse } from "@mimir/contracts";
import type { AuditEntry, ChunkId, ChunkRecord, NoteId } from "@mimir/domain";
import {
  acquireSharedSqliteConnection,
  type SharedSqliteConnection
} from "./shared-sqlite-connection.js";

export class SqliteMetadataControlStore implements MetadataControlStore {
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
        valid_from,
        valid_until,
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
        :validFrom,
        :validUntil,
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
        valid_from = excluded.valid_from,
        valid_until = excluded.valid_until,
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
        validFrom: note.validFrom ?? null,
        validUntil: note.validUntil ?? null,
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

  async getNoteById(noteId: MetadataNoteRecord["noteId"]): Promise<MetadataNoteRecord | null> {
    const row = this.database.prepare(`
      SELECT
        note_id,
        corpus_id,
        note_path,
        note_type,
        lifecycle_state,
        revision,
        updated_at,
        current_state,
        valid_from,
        valid_until,
        summary,
        scope,
        content_hash,
        semantic_signature
      FROM notes
      WHERE note_id = ?
    `).get(noteId) as SqliteNoteRow | undefined;

    return row ? this.mapNoteRow(row) : null;
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
        valid_from,
        valid_until,
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
        :validFrom,
        :validUntil,
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
        valid_from = excluded.valid_from,
        valid_until = excluded.valid_until,
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
          validFrom: chunk.validFrom ?? null,
          validUntil: chunk.validUntil ?? null,
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
        valid_from,
        valid_until,
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
        valid_from,
        valid_until,
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

  async enqueuePromotionOutbox(input: {
    outboxId: string;
    payload: PromotionOutboxPayload;
  }): Promise<PromotionOutboxRecord> {
    const timestamp = currentTimestampIso();
    const record: PromotionOutboxRecord = {
      outboxId: input.outboxId,
      state: "pending",
      attempts: 0,
      completedSteps: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      payload: input.payload
    };

    this.database.prepare(`
      INSERT INTO promotion_outbox (
        outbox_id,
        state,
        attempts,
        last_error,
        completed_steps_json,
        created_at,
        updated_at,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(outbox_id) DO UPDATE SET
        state = excluded.state,
        attempts = excluded.attempts,
        last_error = excluded.last_error,
        completed_steps_json = excluded.completed_steps_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(
      record.outboxId,
      record.state,
      record.attempts,
      null,
      JSON.stringify(record.completedSteps),
      record.createdAt,
      record.updatedAt,
      JSON.stringify(record.payload)
    );

    return record;
  }

  async getPromotionOutboxEntry(outboxId: string): Promise<PromotionOutboxRecord | null> {
    const row = this.database.prepare(`
      SELECT
        outbox_id,
        state,
        attempts,
        last_error,
        completed_steps_json,
        created_at,
        updated_at,
        payload_json
      FROM promotion_outbox
      WHERE outbox_id = ?
    `).get(outboxId) as SqlitePromotionOutboxRow | undefined;

    return row ? this.mapPromotionOutboxRow(row) : null;
  }

  async listPromotionOutboxEntries(input: {
    states?: PromotionOutboxState[];
    limit?: number;
  } = {}): Promise<PromotionOutboxRecord[]> {
    const limit = Math.max(1, input.limit ?? 50);
    const states = input.states?.length ? input.states : null;
    const placeholders = states ? states.map(() => "?").join(", ") : "";
    const query = states
      ? `
        SELECT
          outbox_id,
          state,
          attempts,
          last_error,
          completed_steps_json,
          created_at,
          updated_at,
          payload_json
        FROM promotion_outbox
        WHERE state IN (${placeholders})
        ORDER BY created_at ASC
        LIMIT ?
      `
      : `
        SELECT
          outbox_id,
          state,
          attempts,
          last_error,
          completed_steps_json,
          created_at,
          updated_at,
          payload_json
        FROM promotion_outbox
        ORDER BY created_at ASC
        LIMIT ?
      `;
    const statement = this.database.prepare(query);
    const rows = (states
      ? statement.all(...states, limit)
      : statement.all(limit)) as unknown as SqlitePromotionOutboxRow[];

    return rows.map((row) => this.mapPromotionOutboxRow(row));
  }

  async claimPromotionOutboxEntry(outboxId: string): Promise<PromotionOutboxRecord | null> {
    this.database.exec("BEGIN");
    try {
      const row = this.database.prepare(`
        SELECT
          outbox_id,
          state,
          attempts,
          last_error,
          completed_steps_json,
          created_at,
          updated_at,
          payload_json
        FROM promotion_outbox
        WHERE outbox_id = ?
      `).get(outboxId) as SqlitePromotionOutboxRow | undefined;

      if (!row || row.state === "completed") {
        this.database.exec("COMMIT");
        return null;
      }

      const attempts = row.attempts + 1;
      const updatedAt = currentTimestampIso();
      this.database.prepare(`
        UPDATE promotion_outbox
        SET state = ?,
            attempts = ?,
            last_error = NULL,
            updated_at = ?
        WHERE outbox_id = ?
      `).run("processing", attempts, updatedAt, outboxId);
      this.database.exec("COMMIT");

      return this.mapPromotionOutboxRow({
        ...row,
        state: "processing",
        attempts,
        last_error: null,
        updated_at: updatedAt
      });
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async markPromotionOutboxStepCompleted(outboxId: string, stepId: string): Promise<void> {
    const normalizedStepId = stepId.trim();
    if (!normalizedStepId) {
      throw new Error("Promotion outbox step ID is required.");
    }

    this.database.exec("BEGIN");
    try {
      const row = this.database.prepare(`
        SELECT completed_steps_json
        FROM promotion_outbox
        WHERE outbox_id = ?
      `).get(outboxId) as Pick<SqlitePromotionOutboxRow, "completed_steps_json"> | undefined;
      if (!row) {
        this.database.exec("COMMIT");
        return;
      }

      const completedSteps = parseCompletedSteps(row.completed_steps_json);
      if (!completedSteps.includes(normalizedStepId)) {
        completedSteps.push(normalizedStepId);
        this.database.prepare(`
          UPDATE promotion_outbox
          SET completed_steps_json = ?,
              updated_at = ?
          WHERE outbox_id = ?
        `).run(JSON.stringify(completedSteps), currentTimestampIso(), outboxId);
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async completePromotionOutboxEntry(outboxId: string): Promise<void> {
    this.database.prepare(`
      UPDATE promotion_outbox
      SET state = ?,
          last_error = NULL,
          updated_at = ?
      WHERE outbox_id = ?
    `).run("completed", currentTimestampIso(), outboxId);
  }

  async failPromotionOutboxEntry(outboxId: string, lastError: string): Promise<void> {
    this.database.prepare(`
      UPDATE promotion_outbox
      SET state = ?,
          last_error = ?,
          updated_at = ?
      WHERE outbox_id = ?
    `).run("failed", lastError, currentTimestampIso(), outboxId);
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
      ON CONFLICT(promotion_event_id) DO UPDATE SET
        draft_note_id = excluded.draft_note_id,
        canonical_note_id = excluded.canonical_note_id,
        superseded_note_ids_json = excluded.superseded_note_ids_json,
        promoted_at = excluded.promoted_at
    `).run(
      decision.promotionEventId ?? randomUUID(),
      decision.draftNoteId,
      decision.canonicalNoteId,
      JSON.stringify(decision.supersededNoteIds),
      decision.promotedAt
    );
  }

  async upsertNoteRelationships(
    relationships: NoteRelationshipRecord[]
  ): Promise<void> {
    if (relationships.length === 0) {
      return;
    }

    const uniqueRelationships = new Map<string, NoteRelationshipRecord>();
    for (const relationship of relationships) {
      uniqueRelationships.set(
        `${relationship.sourceNoteId}\n${relationship.targetNoteId}\n${relationship.relationshipType}`,
        relationship
      );
    }

    const insertRelationship = this.database.prepare(`
      INSERT INTO note_relationships (
        source_note_id,
        target_note_id,
        relationship_type
      ) VALUES (?, ?, ?)
      ON CONFLICT(source_note_id, target_note_id, relationship_type) DO NOTHING
    `);

    this.database.exec("BEGIN");
    try {
      for (const relationship of uniqueRelationships.values()) {
        insertRelationship.run(
          relationship.sourceNoteId,
          relationship.targetNoteId,
          relationship.relationshipType
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async listNoteRelationships(
    noteId: NoteId,
    input: {
      direction?: NoteRelationshipDirection;
      relationshipType?: NoteRelationshipType;
    } = {}
  ): Promise<NoteRelationshipRecord[]> {
    const directionClause = relationshipDirectionClause(input.direction ?? "outgoing");
    const relationshipTypeClause = input.relationshipType
      ? "AND relationship_type = :relationshipType"
      : "";
    const parameters: Record<string, string> = { noteId };
    if (input.relationshipType) {
      parameters.relationshipType = input.relationshipType;
    }
    const rows = this.database.prepare(`
      SELECT
        source_note_id,
        target_note_id,
        relationship_type
      FROM note_relationships
      WHERE ${directionClause}
        ${relationshipTypeClause}
      ORDER BY relationship_type, source_note_id, target_note_id
    `).all(parameters) as unknown as SqliteNoteRelationshipRow[];

    return rows.map((row) => ({
      sourceNoteId: row.source_note_id,
      targetNoteId: row.target_note_id,
      relationshipType: row.relationship_type as NoteRelationshipType
    }));
  }

  async getTemporalValiditySummary(input: {
    asOf?: string;
    expiringWithinDays?: number;
    corpusId?: MetadataNoteRecord["corpusId"];
  } = {}): Promise<TemporalValiditySummary> {
    const asOf = input.asOf ?? currentDateIso();
    const expiringWithinDays = Math.max(1, input.expiringWithinDays ?? 14);
    const expiryWindowEnd = addDaysIso(asOf, expiringWithinDays);
    const corpusClause = input.corpusId ? "AND corpus_id = :corpusId" : "";

    const statement = this.database.prepare(`
      SELECT
        SUM(
          CASE
            WHEN current_state = 1
              AND lifecycle_state = 'promoted'
              AND valid_until IS NOT NULL
              AND valid_until < :asOf
            THEN 1 ELSE 0
          END
        ) AS expired_current_state_notes,
        SUM(
          CASE
            WHEN current_state = 1
              AND lifecycle_state = 'promoted'
              AND valid_from IS NOT NULL
              AND valid_from > :asOf
            THEN 1 ELSE 0
          END
        ) AS future_dated_current_state_notes,
        SUM(
          CASE
            WHEN current_state = 1
              AND lifecycle_state = 'promoted'
              AND valid_until IS NOT NULL
              AND valid_until >= :asOf
              AND valid_until <= :expiryWindowEnd
            THEN 1 ELSE 0
          END
        ) AS expiring_soon_current_state_notes
      FROM notes
      WHERE 1 = 1
        ${corpusClause}
    `);
    const counts = (
      input.corpusId
        ? statement.get({
            asOf,
            expiryWindowEnd,
            corpusId: input.corpusId
          })
        : statement.get({
            asOf,
            expiryWindowEnd
          })
    ) as {
      expired_current_state_notes: number | null;
      future_dated_current_state_notes: number | null;
      expiring_soon_current_state_notes: number | null;
    };

    return {
      asOf,
      expiringWithinDays,
      expiredCurrentStateNotes: counts.expired_current_state_notes ?? 0,
      futureDatedCurrentStateNotes: counts.future_dated_current_state_notes ?? 0,
      expiringSoonCurrentStateNotes: counts.expiring_soon_current_state_notes ?? 0
    };
  }

  async getTemporalValidityReport(input: {
    asOf?: string;
    expiringWithinDays?: number;
    corpusId?: MetadataNoteRecord["corpusId"];
    limitPerCategory?: number;
  } = {}): Promise<TemporalValidityReport> {
    const asOf = input.asOf ?? currentDateIso();
    const expiringWithinDays = Math.max(1, input.expiringWithinDays ?? 14);
    const limitPerCategory = Math.max(1, input.limitPerCategory ?? 10);
    const expiryWindowEnd = addDaysIso(asOf, expiringWithinDays);
    const summary = await this.getTemporalValiditySummary({
      asOf,
      expiringWithinDays,
      corpusId: input.corpusId
    });

    const [expiredCurrentState, futureDatedCurrentState, expiringSoonCurrentState] =
      await Promise.all([
        this.listTemporalValidityCandidates({
          state: "expired",
          asOf,
          expiryWindowEnd,
          corpusId: input.corpusId,
          limit: limitPerCategory
        }),
        this.listTemporalValidityCandidates({
          state: "future_dated",
          asOf,
          expiryWindowEnd,
          corpusId: input.corpusId,
          limit: limitPerCategory
        }),
        this.listTemporalValidityCandidates({
          state: "expiring_soon",
          asOf,
          expiryWindowEnd,
          corpusId: input.corpusId,
          limit: limitPerCategory
        })
      ]);

    return {
      ...summary,
      limitPerCategory,
      expiredCurrentState,
      futureDatedCurrentState,
      expiringSoonCurrentState
    };
  }

  async getTemporalValidityCandidate(
    noteId: NoteId,
    input: {
      asOf?: string;
      expiringWithinDays?: number;
      corpusId?: MetadataNoteRecord["corpusId"];
    } = {}
  ): Promise<TemporalValidityCandidate | null> {
    const asOf = input.asOf ?? currentDateIso();
    const expiringWithinDays = Math.max(1, input.expiringWithinDays ?? 14);
    const expiryWindowEnd = addDaysIso(asOf, expiringWithinDays);
    const corpusClause = input.corpusId ? "AND corpus_id = :corpusId" : "";
    const row = this.database.prepare(`
      SELECT
        note_id,
        corpus_id,
        note_path,
        note_type,
        lifecycle_state,
        revision,
        updated_at,
        current_state,
        valid_from,
        valid_until,
        summary,
        scope,
        content_hash,
        semantic_signature
      FROM notes
      WHERE note_id = :noteId
        AND current_state = 1
        AND lifecycle_state = 'promoted'
        ${corpusClause}
    `).get(
      input.corpusId
        ? {
            noteId,
            corpusId: input.corpusId
          }
        : {
            noteId
          }
    ) as SqliteNoteRow | undefined;

    if (!row) {
      return null;
    }

    const state = deriveTemporalValidityCandidateState(row, asOf, expiryWindowEnd);
    if (!state) {
      return null;
    }

    return this.mapTemporalValidityCandidate(row, state, asOf);
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
        (:actorId IS NULL OR ae.actor_id = :actorId)
        AND (:actionType IS NULL OR ae.action_type = :actionType)
        AND (:source IS NULL OR ae.source = :source)
        AND (:since IS NULL OR ae.occurred_at >= :since)
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
      actorId: request.actorId ?? null,
      actionType: request.actionType ?? null,
      noteId: request.noteId ?? null,
      source: request.source ?? null,
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
      CREATE TABLE IF NOT EXISTS notes (
        note_id TEXT PRIMARY KEY,
        corpus_id TEXT NOT NULL,
        note_path TEXT NOT NULL UNIQUE,
        note_type TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL,
        revision TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        current_state INTEGER NOT NULL,
        valid_from TEXT,
        valid_until TEXT,
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
        valid_from TEXT,
        valid_until TEXT,
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

      CREATE TABLE IF NOT EXISTS promotion_outbox (
        outbox_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        last_error TEXT,
        completed_steps_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
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
      CREATE INDEX IF NOT EXISTS idx_promotion_outbox_state_created_at ON promotion_outbox(state, created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_entries_occurred_at ON audit_entries(occurred_at);
    `);

    ensureColumnExists(this.database, "notes", "valid_from", "TEXT");
    ensureColumnExists(this.database, "notes", "valid_until", "TEXT");
    ensureColumnExists(this.database, "chunks", "valid_from", "TEXT");
    ensureColumnExists(this.database, "chunks", "valid_until", "TEXT");
    ensureColumnExists(this.database, "promotion_outbox", "completed_steps_json", "TEXT NOT NULL DEFAULT '[]'");
  }

  private async listTemporalValidityCandidates(input: {
    state: TemporalValidityCandidateState;
    asOf: string;
    expiryWindowEnd: string;
    corpusId?: MetadataNoteRecord["corpusId"];
    limit: number;
  }): Promise<TemporalValidityCandidate[]> {
    const { state, asOf, expiryWindowEnd, limit } = input;
    const corpusClause = input.corpusId ? "AND corpus_id = :corpusId" : "";
    const temporalClause =
      state === "expired"
        ? "valid_until IS NOT NULL AND valid_until < :asOf"
        : state === "future_dated"
          ? "valid_from IS NOT NULL AND valid_from > :asOf"
          : `
            valid_until IS NOT NULL
            AND valid_until >= :asOf
            AND valid_until <= :expiryWindowEnd
          `;
    const orderByClause =
      state === "future_dated"
        ? "valid_from ASC, updated_at ASC"
        : "valid_until ASC, updated_at ASC";

    const statement = this.database.prepare(`
      SELECT
        note_id,
        corpus_id,
        note_path,
        note_type,
        lifecycle_state,
        revision,
        updated_at,
        current_state,
        valid_from,
        valid_until,
        summary,
        scope,
        content_hash,
        semantic_signature
      FROM notes
      WHERE current_state = 1
        AND lifecycle_state = 'promoted'
        AND ${temporalClause}
        ${corpusClause}
      ORDER BY ${orderByClause}
      LIMIT :limit
    `);

    const parameters: Record<string, string | number> = {
      asOf,
      limit
    };
    if (state === "expiring_soon") {
      parameters.expiryWindowEnd = expiryWindowEnd;
    }
    if (input.corpusId) {
      parameters.corpusId = input.corpusId;
    }

    const rows = statement.all(parameters) as unknown as SqliteNoteRow[];

    return rows.map((row) => this.mapTemporalValidityCandidate(row, state, asOf));
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
      validFrom: row.valid_from ?? undefined,
      validUntil: row.valid_until ?? undefined,
      summary: row.summary ?? undefined,
      scope: row.scope ?? undefined,
      contentHash: row.content_hash ?? undefined,
      semanticSignature: row.semantic_signature ?? undefined,
      tags: tags.map((tag) => tag.tag)
    };
  }

  private mapTemporalValidityCandidate(
    row: SqliteNoteRow,
    state: TemporalValidityCandidateState,
    asOf: string
  ): TemporalValidityCandidate {
    return {
      noteId: row.note_id,
      corpusId: row.corpus_id,
      notePath: row.note_path,
      noteType: row.note_type,
      lifecycleState: row.lifecycle_state,
      currentState: row.current_state === 1,
      updatedAt: row.updated_at,
      validFrom: row.valid_from ?? undefined,
      validUntil: row.valid_until ?? undefined,
      summary: row.summary ?? undefined,
      scope: row.scope ?? undefined,
      state,
      daysPastDue:
        state === "expired" && row.valid_until
          ? Math.max(0, diffDaysIso(asOf, row.valid_until))
          : undefined,
      daysUntilValidityStart:
        state === "future_dated" && row.valid_from
          ? Math.max(0, diffDaysIso(row.valid_from, asOf))
          : undefined,
      daysUntilExpiry:
        state === "expiring_soon" && row.valid_until
          ? Math.max(0, diffDaysIso(row.valid_until, asOf))
          : undefined
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
      validFrom: row.valid_from ?? undefined,
      validUntil: row.valid_until ?? undefined,
      tokenEstimate: row.token_estimate,
      updatedAt: row.updated_at
    };
  }

  private mapPromotionOutboxRow(row: SqlitePromotionOutboxRow): PromotionOutboxRecord {
    return {
      outboxId: row.outbox_id,
      state: row.state,
      attempts: row.attempts,
      lastError: row.last_error ?? undefined,
      completedSteps: parseCompletedSteps(row.completed_steps_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      payload: JSON.parse(row.payload_json) as PromotionOutboxPayload
    };
  }
}

function parseCompletedSteps(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((step): step is string => typeof step === "string")
      .map((step) => step.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export interface SqliteNoteRow {
  note_id: string;
  corpus_id: MetadataNoteRecord["corpusId"];
  note_path: string;
  note_type: MetadataNoteRecord["noteType"];
  lifecycle_state: MetadataNoteRecord["lifecycleState"];
  revision: string;
  updated_at: string;
  current_state: number;
  valid_from: string | null;
  valid_until: string | null;
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

interface SqliteNoteRelationshipRow {
  source_note_id: NoteId;
  target_note_id: NoteId;
  relationship_type: string;
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
  valid_from: string | null;
  valid_until: string | null;
  token_estimate: number;
  updated_at: string;
}

interface SqlitePromotionOutboxRow {
  outbox_id: string;
  state: PromotionOutboxState;
  attempts: number;
  last_error: string | null;
  completed_steps_json: string;
  created_at: string;
  updated_at: string;
  payload_json: string;
}

function currentTimestampIso(): string {
  return new Date().toISOString();
}

function currentDateIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function diffDaysIso(leftIso: string, rightIso: string): number {
  const left = new Date(`${leftIso}T00:00:00Z`);
  const right = new Date(`${rightIso}T00:00:00Z`);
  return Math.round((left.getTime() - right.getTime()) / 86_400_000);
}

function relationshipDirectionClause(
  direction: NoteRelationshipDirection
): string {
  switch (direction) {
    case "incoming":
      return "target_note_id = :noteId";
    case "both":
      return "(source_note_id = :noteId OR target_note_id = :noteId)";
    case "outgoing":
    default:
      return "source_note_id = :noteId";
  }
}

function deriveTemporalValidityCandidateState(
  row: Pick<SqliteNoteRow, "valid_from" | "valid_until">,
  asOf: string,
  expiryWindowEnd: string
): TemporalValidityCandidateState | null {
  if (row.valid_until && row.valid_until < asOf) {
    return "expired";
  }

  if (row.valid_from && row.valid_from > asOf) {
    return "future_dated";
  }

  if (
    row.valid_until &&
    row.valid_until >= asOf &&
    row.valid_until <= expiryWindowEnd
  ) {
    return "expiring_soon";
  }

  return null;
}

function ensureColumnExists(
  database: DatabaseSync,
  tableName: string,
  columnName: string,
  definition: string
): void {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
