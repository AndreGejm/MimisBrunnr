import { createHash, randomUUID } from "node:crypto";
import type { CanonicalNoteRecord } from "../ports/canonical-note-repository.js";
import type { EmbeddingProvider } from "../ports/embedding-provider.js";
import type { LexicalIndex } from "../ports/lexical-index.js";
import type { MetadataControlStore } from "../ports/metadata-control-store.js";
import type {
  StagingDraftRecord,
  StagingNoteRepository
} from "../ports/staging-note-repository.js";
import type { VectorIndex } from "../ports/vector-index.js";
import { AuditHistoryService } from "./audit-history-service.js";
import { CanonicalNoteService } from "./canonical-note-service.js";
import { ChunkingService } from "./chunking-service.js";
import { NoteValidationService } from "./note-validation-service.js";
import type { PromoteNoteRequest, PromoteNoteResponse, ServiceResult } from "@multi-agent-brain/contracts";
import type { ChunkRecord, ControlledTag, NoteFrontmatter, NoteId } from "@multi-agent-brain/domain";

type PromoteNoteErrorCode =
  | "forbidden"
  | "not_found"
  | "revision_conflict"
  | "validation_failed"
  | "duplicate_detected"
  | "write_failed";

const PROMOTION_ROLES = new Set(["orchestrator", "operator", "system"]);

interface ProcessedPromotionResult {
  outboxId: string;
  promotedNoteId: NoteId;
  canonicalPath: string;
  supersededNoteIds: NoteId[];
  chunkCount: number;
  promotedChunks: ChunkRecord[];
  snapshotChunks: ChunkRecord[];
  affectedNoteIds: NoteId[];
  snapshotNotePath?: string;
}

export class PromotionOrchestratorService {
  constructor(
    private readonly stagingNoteRepository: StagingNoteRepository,
    private readonly canonicalNoteService: CanonicalNoteService,
    private readonly noteValidationService: NoteValidationService,
    private readonly metadataControlStore: MetadataControlStore,
    private readonly chunkingService: ChunkingService,
    private readonly auditHistoryService: AuditHistoryService,
    private readonly lexicalIndex?: LexicalIndex,
    private readonly vectorIndex?: VectorIndex,
    private readonly embeddingProvider?: EmbeddingProvider
  ) {}

  async promoteDraft(
    request: PromoteNoteRequest
  ): Promise<ServiceResult<PromoteNoteResponse, PromoteNoteErrorCode>> {
    if (!PROMOTION_ROLES.has(request.actor.actorRole)) {
      return {
        ok: false,
        error: {
          code: "forbidden",
          message: `Actor role '${request.actor.actorRole}' cannot promote notes.`
        }
      };
    }

    const draft = await this.stagingNoteRepository.getById(request.draftNoteId);
    if (!draft) {
      await this.recordAuditForRejection(request, [], [], "Draft note was not found.");
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `Draft note '${request.draftNoteId}' was not found.`
        }
      };
    }

    if (request.expectedDraftRevision && draft.revision !== request.expectedDraftRevision) {
      await this.recordAuditForRejection(
        request,
        [draft.noteId],
        [],
        "Draft revision did not match the expected revision."
      );
      return {
        ok: false,
        error: {
          code: "revision_conflict",
          message: "Draft revision conflict detected.",
          details: {
            expectedDraftRevision: request.expectedDraftRevision,
            actualDraftRevision: draft.revision
          }
        }
      };
    }

    const promotedNoteId = randomUUID();
    const targetPath = request.targetPath ?? buildCanonicalPath(request.targetCorpus, draft.frontmatter.title, promotedNoteId);
    const candidateFrontmatter: NoteFrontmatter = {
      ...draft.frontmatter,
      noteId: promotedNoteId,
      status: "promoted",
      updated: currentDateIso(),
      corpusId: request.targetCorpus,
      currentState: request.promoteAsCurrentState,
      supersededBy: undefined,
      supersedes: []
    };

    const validation = this.noteValidationService.validate({
      actor: request.actor,
      targetCorpus: request.targetCorpus,
      notePath: targetPath,
      frontmatter: candidateFrontmatter,
      body: draft.body,
      validationMode: "promotion"
    });

    if (!validation.valid || !validation.normalizedFrontmatter) {
      await this.recordAuditForRejection(
        request,
        [draft.noteId],
        [],
        "Promotion validation failed.",
        { violations: validation.violations }
      );
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: "Draft note failed promotion validation.",
          details: {
            violations: validation.violations
          }
        }
      };
    }

    const contentHash = hashText(draft.body);
    const semanticSignature = buildSemanticSignature(
      validation.normalizedFrontmatter.title,
      validation.normalizedFrontmatter.summary,
      validation.normalizedFrontmatter.scope
    );
    const duplicates = await this.metadataControlStore.findPotentialDuplicates({
      corpusId: request.targetCorpus,
      contentHash,
      semanticSignature
    });
    const exactDuplicate = duplicates.find(
      (duplicate) =>
        duplicate.lifecycleState !== "superseded" &&
        duplicate.contentHash === contentHash
    );

    if (exactDuplicate) {
      await this.recordAuditForRejection(
        request,
        [draft.noteId, exactDuplicate.noteId],
        [],
        "Promotion rejected because an identical canonical note already exists.",
        { duplicateNoteId: exactDuplicate.noteId }
      );
      return {
        ok: false,
        error: {
          code: "duplicate_detected",
          message: "An identical canonical note already exists.",
          details: {
            duplicateNoteId: exactDuplicate.noteId,
            duplicateNotePath: exactDuplicate.notePath
          }
        }
      };
    }

    const nowDate = currentDateIso();
    const nowTimestamp = currentTimestampIso();
    const supersededRecords = request.promoteAsCurrentState
      ? await this.findSupersededRecords(request.targetCorpus, draft.frontmatter)
      : [];
    const supersededNoteIds = supersededRecords.map((note) => note.noteId);
    const normalizedFrontmatter: NoteFrontmatter = {
      ...validation.normalizedFrontmatter,
      supersedes: supersededNoteIds,
      tags: normalizePromotedTags(
        validation.normalizedFrontmatter.tags,
        request.promoteAsCurrentState
      )
    };
    const canonicalNote: CanonicalNoteRecord = {
      noteId: promotedNoteId,
      corpusId: request.targetCorpus,
      notePath: targetPath,
      revision: "",
      frontmatter: normalizedFrontmatter,
      body: draft.body
    };
    const supersededWrites: CanonicalNoteRecord[] = supersededRecords.map((supersededRecord): CanonicalNoteRecord => ({
      ...supersededRecord,
      frontmatter: {
        ...supersededRecord.frontmatter,
        status: "superseded",
        currentState: false,
        supersededBy: promotedNoteId,
        updated: nowDate,
        tags: normalizeSupersededTags(
          supersededRecord.frontmatter.tags.filter((tag) => tag !== "status/current")
        )
      }
    }));
    const snapshotResult = request.promoteAsCurrentState
      ? this.canonicalNoteService.prepareCurrentStateSnapshot(canonicalNote)
      : undefined;
    if (snapshotResult && !snapshotResult.ok) {
      await this.recordAuditForRejection(
        request,
        [draft.noteId],
        [],
        "Failed to prepare the current-state snapshot note.",
        snapshotResult.error.details
      );
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: snapshotResult.error.message,
          details: snapshotResult.error.details
        }
      };
    }

    const promotedDraftPlan: StagingDraftRecord = {
      ...draft,
      lifecycleState: "promoted",
      frontmatter: {
        ...draft.frontmatter,
        status: "promoted",
        updated: nowDate,
        currentState: false
      }
    };
    const outboxId = randomUUID();
    const queuedPromotion = await this.metadataControlStore.enqueuePromotionOutbox({
      outboxId,
      payload: {
        actor: request.actor,
        targetCorpus: request.targetCorpus,
        canonicalWrites: [
          ...supersededWrites,
          canonicalNote,
          ...(snapshotResult?.ok ? [snapshotResult.data] : [])
        ],
        draftUpdate: promotedDraftPlan,
        promotionDecision: {
          promotionEventId: outboxId,
          draftNoteId: draft.noteId,
          canonicalNoteId: promotedNoteId,
          supersededNoteIds,
          promotedAt: nowTimestamp
        }
      }
    });
    const processedPromotion = await this.processPromotionOutboxEntry(queuedPromotion.outboxId);
    if (!processedPromotion.ok) {
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: processedPromotion.error.message,
          details: {
            ...processedPromotion.error.details,
            outboxId: queuedPromotion.outboxId
          }
        }
      };
    }

    const auditEntry = await this.auditHistoryService.recordAction({
      actionType: "promote_note",
      actorId: request.actor.actorId,
      actorRole: request.actor.actorRole,
      source: request.actor.source,
      toolName: request.actor.toolName,
      occurredAt: currentTimestampIso(),
      outcome: "accepted",
      affectedNoteIds: processedPromotion.data.affectedNoteIds,
      affectedChunkIds: [
        ...processedPromotion.data.promotedChunks.map((chunk) => chunk.chunkId),
        ...processedPromotion.data.snapshotChunks.map((chunk) => chunk.chunkId)
      ],
      detail: {
        targetCorpus: request.targetCorpus,
        canonicalPath: processedPromotion.data.canonicalPath,
        supersededNoteIds: processedPromotion.data.supersededNoteIds,
        snapshotNotePath: processedPromotion.data.snapshotNotePath,
        outboxId: processedPromotion.data.outboxId
      }
    });

    return {
      ok: true,
      data: {
        promotedNoteId: processedPromotion.data.promotedNoteId,
        canonicalPath: processedPromotion.data.canonicalPath,
        supersededNoteIds: processedPromotion.data.supersededNoteIds,
        chunkCount: processedPromotion.data.chunkCount,
        auditEntryId: auditEntry.ok ? auditEntry.data.auditEntryId : ""
      },
      warnings: [...(auditEntry.ok ? [] : [auditEntry.error.message])].filter(Boolean)
    };
  }

  async replayPendingPromotions(limit = 25): Promise<{
    processedOutboxIds: string[];
    failedOutboxIds: string[];
  }> {
    const queuedPromotions = await this.metadataControlStore.listPromotionOutboxEntries({
      states: ["pending", "failed", "processing"],
      limit
    });
    const processedOutboxIds: string[] = [];
    const failedOutboxIds: string[] = [];

    for (const queuedPromotion of queuedPromotions) {
      const result = await this.processPromotionOutboxEntry(queuedPromotion.outboxId);
      if (result.ok) {
        processedOutboxIds.push(queuedPromotion.outboxId);
      } else {
        failedOutboxIds.push(queuedPromotion.outboxId);
      }
    }

    return {
      processedOutboxIds,
      failedOutboxIds
    };
  }

  private async processPromotionOutboxEntry(
    outboxId: string
  ): Promise<ServiceResult<ProcessedPromotionResult, "write_failed">> {
    const queuedPromotion = await this.metadataControlStore.claimPromotionOutboxEntry(outboxId);
    if (!queuedPromotion) {
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: `Promotion outbox entry '${outboxId}' could not be claimed.`,
          details: {
            outboxId
          }
        }
      };
    }

    const canonicalPath =
      queuedPromotion.payload.canonicalWrites.find(
        (note) => note.noteId === queuedPromotion.payload.promotionDecision.canonicalNoteId
      )?.notePath ?? "";

    try {
      let promotedChunks: ChunkRecord[] = [];
      let snapshotChunks: ChunkRecord[] = [];
      let snapshotNotePath: string | undefined;

      for (const canonicalWrite of queuedPromotion.payload.canonicalWrites) {
        const persisted = await this.canonicalNoteService.writeCanonicalNote(canonicalWrite);
        if (!persisted.ok) {
          throw new Error(
            `${persisted.error.message}${persisted.error.details ? ` ${JSON.stringify(persisted.error.details)}` : ""}`
          );
        }

        const chunks = this.chunkingService.chunkCanonicalNote(persisted.data);
        await this.syncChunkState(persisted.data.noteId, chunks);

        if (persisted.data.noteId === queuedPromotion.payload.promotionDecision.canonicalNoteId) {
          promotedChunks = chunks;
        }

        if (persisted.data.frontmatter.tags.includes("topic/current-state-snapshot")) {
          snapshotChunks = chunks;
          snapshotNotePath = persisted.data.notePath;
        }
      }

      await this.metadataControlStore.recordPromotion(
        queuedPromotion.payload.promotionDecision
      );

      const promotedDraft = await this.stagingNoteRepository.updateDraft(
        queuedPromotion.payload.draftUpdate
      );
      await this.metadataControlStore.upsertNote(
        mapDraftMetadataRecord(promotedDraft)
      );
      await this.metadataControlStore.completePromotionOutboxEntry(outboxId);

      return {
        ok: true,
        data: {
          outboxId,
          promotedNoteId: queuedPromotion.payload.promotionDecision.canonicalNoteId,
          canonicalPath,
          supersededNoteIds: queuedPromotion.payload.promotionDecision.supersededNoteIds,
          chunkCount: promotedChunks.length,
          promotedChunks,
          snapshotChunks,
          affectedNoteIds: [
            queuedPromotion.payload.promotionDecision.draftNoteId,
            queuedPromotion.payload.promotionDecision.canonicalNoteId,
            ...queuedPromotion.payload.promotionDecision.supersededNoteIds,
            ...(snapshotNotePath
              ? queuedPromotion.payload.canonicalWrites
                  .filter((note) => note.notePath === snapshotNotePath)
                  .map((note) => note.noteId)
              : [])
          ],
          snapshotNotePath
        }
      };
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error);
      await this.metadataControlStore.failPromotionOutboxEntry(outboxId, lastError);
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: "Failed while processing the promotion outbox entry.",
          details: {
            outboxId,
            reason: lastError
          }
        }
      };
    }
  }

  private async syncChunkState(
    noteId: NoteId,
    chunks: ChunkRecord[]
  ): Promise<void> {
    await this.metadataControlStore.removeChunksByNoteId(noteId);
    await this.metadataControlStore.upsertChunks(chunks);

    if (this.lexicalIndex) {
      await this.lexicalIndex.removeByNoteId(noteId);
      await this.lexicalIndex.upsertChunks(chunks);
    }

    if (this.vectorIndex && this.embeddingProvider) {
      await this.vectorIndex.removeByNoteId(noteId);
      const embeddings = await this.embeddingProvider.embedTexts(
        chunks.map((chunk) => buildEmbeddingText(chunk))
      );

      await this.vectorIndex.upsertEmbeddings(
        chunks.map((chunk, index) => ({
          chunkId: chunk.chunkId,
          noteId: chunk.noteId,
          embedding: embeddings[index],
          corpusId: chunk.corpusId,
          noteType: chunk.noteType,
          stalenessClass: chunk.stalenessClass,
          updatedAt: chunk.updatedAt
        }))
      );
    }
  }

  private async findSupersededRecords(
    targetCorpus: PromoteNoteRequest["targetCorpus"],
    sourceFrontmatter: NoteFrontmatter
  ): Promise<CanonicalNoteRecord[]> {
    const canonicalNotes = await this.canonicalNoteService.listCanonicalNotes(targetCorpus);
    if (!canonicalNotes.ok) {
      return [];
    }

    return canonicalNotes.data.filter((note) => {
      if (!note.frontmatter.currentState) {
        return false;
      }

      if (note.frontmatter.type !== sourceFrontmatter.type) {
        return false;
      }

      if (note.frontmatter.project !== sourceFrontmatter.project) {
        return false;
      }

      return (
        note.frontmatter.title.trim().toLowerCase() === sourceFrontmatter.title.trim().toLowerCase() ||
        note.frontmatter.scope.trim().toLowerCase() === sourceFrontmatter.scope.trim().toLowerCase()
      );
    });
  }

  private async recordAuditForRejection(
    request: PromoteNoteRequest,
    affectedNoteIds: NoteId[],
    affectedChunkIds: string[],
    reason: string,
    detail?: Record<string, unknown>
  ): Promise<void> {
    await this.auditHistoryService.recordAction({
      actionType: "promote_note",
      actorId: request.actor.actorId,
      actorRole: request.actor.actorRole,
      source: request.actor.source,
      toolName: request.actor.toolName,
      occurredAt: currentTimestampIso(),
      outcome: "rejected",
      affectedNoteIds,
      affectedChunkIds,
      detail: {
        reason,
        request: {
          draftNoteId: request.draftNoteId,
          targetCorpus: request.targetCorpus,
          promoteAsCurrentState: request.promoteAsCurrentState
        },
        ...detail
      }
    });
  }
}

function mapDraftMetadataRecord(
  draft: Awaited<ReturnType<StagingNoteRepository["updateDraft"]>>
) {
  return {
    noteId: draft.noteId,
    corpusId: draft.corpusId,
    notePath: draft.draftPath,
    noteType: draft.frontmatter.type,
    lifecycleState: draft.lifecycleState,
    revision: draft.revision,
    updatedAt: draft.frontmatter.updated,
    currentState: draft.frontmatter.currentState,
    validFrom: draft.frontmatter.validFrom,
    validUntil: draft.frontmatter.validUntil,
    summary: draft.frontmatter.summary,
    scope: draft.frontmatter.scope,
    tags: draft.frontmatter.tags
  };
}

function normalizePromotedTags(
  tags: ControlledTag[],
  currentState: boolean
): ControlledTag[] {
  const nextTags = new Set<ControlledTag>(tags);
  nextTags.delete("status/draft");
  nextTags.delete("status/staged");
  nextTags.delete("status/superseded");
  nextTags.add("status/promoted");
  if (currentState) {
    nextTags.add("status/current");
  } else {
    nextTags.delete("status/current");
  }
  return [...nextTags];
}

function normalizeSupersededTags(tags: ControlledTag[]): ControlledTag[] {
  const nextTags = new Set<ControlledTag>(tags);
  nextTags.delete("status/current");
  nextTags.delete("status/promoted");
  nextTags.add("status/superseded");
  return [...nextTags];
}

function buildCanonicalPath(targetCorpus: PromoteNoteRequest["targetCorpus"], title: string, noteId: NoteId): string {
  return `${targetCorpus}/${slugify(title)}-${noteId.slice(0, 8)}.md`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function currentDateIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentTimestampIso(): string {
  return new Date().toISOString();
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildSemanticSignature(title: string, summary: string, scope: string): string {
  return hashText(`${title}\n${summary}\n${scope}`);
}

function buildEmbeddingText(chunk: ChunkRecord): string {
  return [
    chunk.noteType,
    chunk.notePath,
    chunk.headingPath.join(" > "),
    chunk.summary,
    chunk.scope,
    ...chunk.qualifiers,
    chunk.rawText
  ]
    .filter(Boolean)
    .join("\n");
}
