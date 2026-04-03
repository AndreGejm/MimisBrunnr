import { createHash, randomUUID } from "node:crypto";
import type { CanonicalNoteRecord } from "../ports/canonical-note-repository.js";
import type { EmbeddingProvider } from "../ports/embedding-provider.js";
import type { LexicalIndex } from "../ports/lexical-index.js";
import type { MetadataControlStore } from "../ports/metadata-control-store.js";
import type { StagingNoteRepository } from "../ports/staging-note-repository.js";
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

    for (const supersededRecord of supersededRecords) {
      const supersededWrite = await this.canonicalNoteService.writeCanonicalNote({
        ...supersededRecord,
        frontmatter: {
          ...supersededRecord.frontmatter,
          status: "superseded",
          currentState: false,
          supersededBy: promotedNoteId,
          updated: currentDateIso(),
          tags: normalizeSupersededTags(
            supersededRecord.frontmatter.tags.filter((tag) => tag !== "status/current")
          )
        }
      });

      if (!supersededWrite.ok) {
        await this.recordAuditForRejection(
          request,
          [draft.noteId, supersededRecord.noteId],
          [],
          "Failed while superseding an existing canonical note.",
          supersededWrite.error.details
        );
        return {
          ok: false,
          error: {
            code: "write_failed",
            message: "Failed to supersede an existing canonical note.",
            details: supersededWrite.error.details
          }
        };
      }

      const supersededChunks = this.chunkingService.chunkCanonicalNote(supersededWrite.data);
      await this.syncChunkState(supersededRecord.noteId, supersededChunks);
    }

    const canonicalWrite = await this.canonicalNoteService.writeCanonicalNote(canonicalNote);
    if (!canonicalWrite.ok) {
      await this.recordAuditForRejection(
        request,
        [draft.noteId],
        [],
        "Failed to persist canonical note state.",
        canonicalWrite.error.details
      );
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: canonicalWrite.error.message,
          details: canonicalWrite.error.details
        }
      };
    }

    const promotedChunks = this.chunkingService.chunkCanonicalNote(canonicalWrite.data);
    await this.syncChunkState(promotedNoteId, promotedChunks);

    let snapshotChunks: ChunkRecord[] = [];
    const snapshotWrite = request.promoteAsCurrentState
      ? await this.canonicalNoteService.writeCurrentStateSnapshot(canonicalWrite.data)
      : undefined;
    if (snapshotWrite?.ok) {
      snapshotChunks = this.chunkingService.chunkCanonicalNote(snapshotWrite.data);
      await this.syncChunkState(snapshotWrite.data.noteId, snapshotChunks);
    }
    await this.metadataControlStore.recordPromotion({
      draftNoteId: draft.noteId,
      canonicalNoteId: promotedNoteId,
      supersededNoteIds,
      promotedAt: currentTimestampIso()
    });

    const promotedDraft = await this.stagingNoteRepository.updateDraft({
      ...draft,
      lifecycleState: "promoted",
      frontmatter: {
        ...draft.frontmatter,
        status: "promoted",
        updated: currentDateIso(),
        currentState: false
      }
    });
    await this.metadataControlStore.upsertNote({
      noteId: promotedDraft.noteId,
      corpusId: promotedDraft.corpusId,
      notePath: promotedDraft.draftPath,
      noteType: promotedDraft.frontmatter.type,
      lifecycleState: promotedDraft.lifecycleState,
      revision: promotedDraft.revision,
      updatedAt: promotedDraft.frontmatter.updated,
      currentState: promotedDraft.frontmatter.currentState,
      summary: promotedDraft.frontmatter.summary,
      scope: promotedDraft.frontmatter.scope,
      tags: promotedDraft.frontmatter.tags
    });

    const auditEntry = await this.auditHistoryService.recordAction({
      actionType: "promote_note",
      actorId: request.actor.actorId,
      actorRole: request.actor.actorRole,
      source: request.actor.source,
      toolName: request.actor.toolName,
      occurredAt: currentTimestampIso(),
      outcome: "accepted",
      affectedNoteIds: [
        draft.noteId,
        promotedNoteId,
        ...supersededNoteIds,
        ...(snapshotWrite?.ok ? [snapshotWrite.data.noteId] : [])
      ],
      affectedChunkIds: [
        ...promotedChunks.map((chunk) => chunk.chunkId),
        ...snapshotChunks.map((chunk) => chunk.chunkId)
      ],
      detail: {
        targetCorpus: request.targetCorpus,
        canonicalPath: canonicalWrite.data.notePath,
        supersededNoteIds,
        snapshotNotePath: snapshotWrite?.ok ? snapshotWrite.data.notePath : undefined
      }
    });

    return {
      ok: true,
      data: {
        promotedNoteId,
        canonicalPath: canonicalWrite.data.notePath,
        supersededNoteIds,
        chunkCount: promotedChunks.length,
        auditEntryId: auditEntry.ok ? auditEntry.data.auditEntryId : ""
      },
      warnings: [
        ...(auditEntry.ok ? [] : [auditEntry.error.message]),
        ...(snapshotWrite && !snapshotWrite.ok ? [snapshotWrite.error.message] : [])
      ].filter(Boolean)
    };
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
