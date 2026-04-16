import type {
  AcceptNoteRequest,
  AcceptNoteResult,
  ListReviewQueueRequest,
  ListReviewQueueResult,
  ReadReviewNoteRequest,
  ReadReviewNoteResult,
  RejectNoteRequest,
  RejectNoteResult,
  ReviewState,
  ReviewStep
} from "@mimir/contracts";
import type { CorpusId } from "@mimir/domain";
import type { MetadataControlStore } from "../ports/metadata-control-store.js";
import type {
  StagingDraftRecord,
  StagingNoteRepository
} from "../ports/staging-note-repository.js";
import type { PromotionOrchestratorService } from "./promotion-orchestrator-service.js";

const REVIEWABLE_CORPORA: ReadonlyArray<CorpusId> = [
  "mimisbrunnr",
  "general_notes"
];

export class ReviewCommandService {
  constructor(
    private readonly stagingNoteRepository: StagingNoteRepository,
    private readonly metadataControlStore: MetadataControlStore,
    private readonly promotionOrchestratorService: PromotionOrchestratorService
  ) {}

  async listQueue(request: ListReviewQueueRequest): Promise<ListReviewQueueResult> {
    const corpora = request.targetCorpus ? [request.targetCorpus] : REVIEWABLE_CORPORA;
    const drafts = (
      await Promise.all(
        corpora.map((corpusId) => this.stagingNoteRepository.listByCorpus(corpusId))
      )
    ).flat();

    const items = drafts
      .filter((draft) => shouldIncludeReviewDraft(draft.lifecycleState, request.includeRejected === true))
      .map((draft) => ({
        draftNoteId: draft.noteId,
        title: draft.frontmatter.title,
        targetCorpus: draft.corpusId,
        scope: draft.frontmatter.scope,
        noteType: draft.frontmatter.type,
        updatedAt: draft.frontmatter.updated,
        reviewState: reviewStateForLifecycle(draft.lifecycleState),
        authorityRisk: "medium" as const,
        warningSummary: summarizeReviewWarnings(draft.lifecycleState, draft.body)
      }))
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.title.localeCompare(right.title)
      );

    return {
      ok: true,
      data: {
        items
      }
    };
  }

  async readNote(request: ReadReviewNoteRequest): Promise<ReadReviewNoteResult> {
    const draft = await this.stagingNoteRepository.getById(request.draftNoteId);
    if (!draft) {
      return reviewNotFound(request.draftNoteId);
    }

    const warnings = summarizeReviewWarnings(draft.lifecycleState, draft.body);

    return {
      ok: true,
      data: {
        draftNoteId: draft.noteId,
        draftPath: draft.draftPath,
        title: draft.frontmatter.title,
        targetCorpus: draft.corpusId,
        scope: draft.frontmatter.scope,
        noteType: draft.frontmatter.type,
        updatedAt: draft.frontmatter.updated,
        reviewState: reviewStateForLifecycle(draft.lifecycleState),
        authorityRisk: "medium",
        promotionEligible: shouldIncludeReviewDraft(draft.lifecycleState, false),
        body: draft.body,
        provenance: [],
        warnings: warnings.map((message, index) => ({
          code: `review_warning_${index + 1}`,
          message
        }))
      }
    };
  }

  async acceptNote(request: AcceptNoteRequest): Promise<AcceptNoteResult> {
    const draft = await this.stagingNoteRepository.getById(request.draftNoteId);
    if (!draft) {
      return reviewNotFound(request.draftNoteId);
    }

    if (!shouldIncludeReviewDraft(draft.lifecycleState, false)) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: `Draft note '${request.draftNoteId}' is not eligible for review from lifecycle state '${draft.lifecycleState}'.`,
          details: {
            draftNoteId: request.draftNoteId,
            lifecycleState: draft.lifecycleState
          }
        }
      };
    }

    const promoted = await this.promotionOrchestratorService.promoteDraft({
      actor: request.actor,
      draftNoteId: request.draftNoteId,
      targetCorpus: draft.corpusId,
      expectedDraftRevision: draft.revision,
      promoteAsCurrentState: draft.frontmatter.currentState
    });

    if (!promoted.ok) {
      return promoted;
    }

    const steps: ReviewStep[] = [
      {
        step: "reviewability_check",
        status: "succeeded",
        message: "Draft is reviewable under the current Mimir staging lifecycle."
      },
      {
        step: "promote_note",
        status: "succeeded",
        message: "Draft promoted through the Mimir promotion service."
      }
    ];

    return {
      ok: true,
      data: {
        draftNoteId: request.draftNoteId,
        accepted: true,
        finalReviewState: "promotion_ready",
        promotedNoteId: promoted.data.promotedNoteId,
        canonicalPath: promoted.data.canonicalPath,
        supersededNoteIds: promoted.data.supersededNoteIds,
        steps,
        retrievalWarning:
          promoted.data.chunkCount > 0
            ? undefined
            : "Promoted note did not produce retrievable chunks."
      },
      warnings: promoted.warnings
    };
  }

  async rejectNote(request: RejectNoteRequest): Promise<RejectNoteResult> {
    const draft = await this.stagingNoteRepository.getById(request.draftNoteId);
    if (!draft) {
      return reviewNotFound(request.draftNoteId);
    }

    const updated = await this.stagingNoteRepository.updateDraft({
      ...draft,
      lifecycleState: "rejected",
      frontmatter: {
        ...draft.frontmatter,
        status: "rejected",
        updated: currentDateIso(),
        tags: replaceStatusTags(draft.frontmatter.tags, "status/rejected")
      },
      body: appendReviewNotes(draft.body, request.reviewNotes)
    });

    await this.metadataControlStore.upsertNote({
      noteId: updated.noteId,
      corpusId: updated.corpusId,
      notePath: updated.draftPath,
      noteType: updated.frontmatter.type,
      lifecycleState: updated.lifecycleState,
      revision: updated.revision,
      updatedAt: currentTimestampIso(),
      currentState: updated.frontmatter.currentState,
      validFrom: updated.frontmatter.validFrom,
      validUntil: updated.frontmatter.validUntil,
      summary: updated.frontmatter.summary,
      scope: updated.frontmatter.scope,
      tags: updated.frontmatter.tags
    });

    return {
      ok: true,
      data: {
        draftNoteId: request.draftNoteId,
        rejected: true,
        finalReviewState: "rejected",
        draftPath: updated.draftPath,
        steps: [
          {
            step: "mark_rejected",
            status: "succeeded",
            message: "Draft was marked rejected in the staging repository."
          }
        ]
      }
    };
  }
}

function shouldIncludeReviewDraft(
  lifecycleState: StagingDraftRecord["lifecycleState"],
  includeRejected: boolean
): boolean {
  if (["promoted", "superseded", "archived"].includes(lifecycleState)) {
    return false;
  }

  if (lifecycleState === "rejected") {
    return includeRejected;
  }

  return true;
}

function reviewStateForLifecycle(
  lifecycleState: StagingDraftRecord["lifecycleState"]
): ReviewState {
  if (lifecycleState === "rejected") {
    return "rejected";
  }

  if (lifecycleState === "promoted") {
    return "promoted";
  }

  if (lifecycleState === "superseded") {
    return "superseded";
  }

  if (lifecycleState === "archived") {
    return "archived";
  }

  if (lifecycleState === "validated") {
    return "promotion_ready";
  }

  return "unreviewed";
}

function summarizeReviewWarnings(
  lifecycleState: StagingDraftRecord["lifecycleState"],
  body: string
): string[] {
  const warnings: string[] = [];

  if (lifecycleState === "draft") {
    warnings.push("Draft has not reached the staged lifecycle state yet.");
  }

  if (lifecycleState === "rejected") {
    warnings.push("Draft has already been rejected.");
  }

  if (lifecycleState === "promoted") {
    warnings.push("Draft has already been promoted and is no longer reviewable.");
  }

  if (lifecycleState === "superseded") {
    warnings.push("Draft has been superseded and is no longer reviewable.");
  }

  if (lifecycleState === "archived") {
    warnings.push("Draft has been archived and is no longer reviewable.");
  }

  if (body.trim() === "") {
    warnings.push("Draft body is empty.");
  }

  return warnings;
}

function reviewNotFound(draftNoteId: string) {
  return {
    ok: false as const,
    error: {
      code: "not_found",
      message: `Draft note '${draftNoteId}' was not found.`,
      details: {
        draftNoteId
      }
    }
  };
}

function replaceStatusTags(
  tags: StagingDraftRecord["frontmatter"]["tags"],
  statusTag: StagingDraftRecord["frontmatter"]["tags"][number]
): StagingDraftRecord["frontmatter"]["tags"] {
  const nextTags = new Set(tags.filter((tag) => !tag.startsWith("status/")));
  nextTags.add(statusTag);
  return [...nextTags];
}

function appendReviewNotes(body: string, reviewNotes: string | undefined): string {
  if (!reviewNotes?.trim()) {
    return body;
  }

  return `${body.trimEnd()}\n\n## Review Notes\n\n${reviewNotes.trim()}\n`;
}

function currentDateIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentTimestampIso(): string {
  return new Date().toISOString();
}
