import type { CanonicalNoteService } from "./canonical-note-service.js";
import type { StagingDraftService } from "./staging-draft-service.js";
import type { MetadataControlStore } from "../ports/metadata-control-store.js";
import type { AuditHistoryService } from "./audit-history-service.js";
import type {
  CreateRefreshDraftBatchRequest,
  CreateRefreshDraftBatchResponse,
  CreateRefreshDraftRequest,
  CreateRefreshDraftResponse,
  ServiceResult
} from "@mimir/contracts";
import type {
  ControlledTag,
  NoteFrontmatter
} from "@mimir/domain";

type TemporalRefreshErrorCode =
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "write_failed";

const ALLOWED_REFRESH_ACTOR_ROLES = new Set(["operator", "orchestrator", "system"]);
const DEFAULT_BATCH_LIMIT_PER_CATEGORY = 5;
const DEFAULT_BATCH_MAX_DRAFTS = 10;
const DEFAULT_BATCH_SOURCE_STATES: CreateRefreshDraftResponse["sourceState"][] = [
  "expired",
  "future_dated",
  "expiring_soon"
];

export class TemporalRefreshService {
  constructor(
    private readonly metadataControlStore: MetadataControlStore,
    private readonly canonicalNoteService: CanonicalNoteService,
    private readonly stagingDraftService: StagingDraftService,
    private readonly auditHistoryService?: AuditHistoryService
  ) {}

  async createRefreshDraft(
    request: CreateRefreshDraftRequest
  ): Promise<ServiceResult<CreateRefreshDraftResponse, TemporalRefreshErrorCode>> {
    if (!ALLOWED_REFRESH_ACTOR_ROLES.has(request.actor.actorRole)) {
      return {
        ok: false,
        error: {
          code: "forbidden",
          message: `Actor role '${request.actor.actorRole}' cannot create temporal refresh drafts.`
        }
      };
    }

    const candidate = await this.metadataControlStore.getTemporalValidityCandidate(
      request.noteId,
      {
        asOf: request.asOf,
        expiringWithinDays: request.expiringWithinDays
      }
    );
    if (!candidate) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: `Note '${request.noteId}' is not currently an expired, future-dated, or expiring-soon current-state note.`
        }
      };
    }

    const canonical = await this.canonicalNoteService.getCanonicalNoteByPath(
      candidate.notePath
    );
    if (!canonical.ok) {
      return {
        ok: false,
        error: canonical.error
      };
    }

    const sourceNote = canonical.data;
    const existingDraft = await this.findExistingRefreshDraft(
      sourceNote.corpusId,
      sourceNote.noteId
    );
    if (existingDraft) {
      const auditResult = await this.auditHistoryService?.recordAction({
        actionType: "create_refresh_draft",
        actorId: request.actor.actorId,
        actorRole: request.actor.actorRole,
        source: request.actor.source,
        toolName: request.actor.toolName,
        occurredAt: new Date().toISOString(),
        outcome: "partial",
        affectedNoteIds: [sourceNote.noteId, existingDraft.noteId],
        affectedChunkIds: [],
        detail: {
          sourceState: candidate.state,
          sourceNotePath: sourceNote.notePath,
          sourceValidity: {
            validFrom: candidate.validFrom,
            validUntil: candidate.validUntil
          },
          reusedExistingDraft: true
        }
      });

      return {
        ok: true,
        data: {
          sourceNoteId: sourceNote.noteId,
          sourceNotePath: sourceNote.notePath,
          sourceState: candidate.state,
          draftNoteId: existingDraft.noteId,
          draftPath: existingDraft.draftPath,
          frontmatter: existingDraft.frontmatter,
          body: existingDraft.body,
          reusedExistingDraft: true,
          warnings: [
            "An open refresh draft already exists for this canonical note; the existing draft was reused.",
            ...(auditResult && !auditResult.ok ? [auditResult.error.message] : [])
          ]
        }
      };
    }

    const draftResult = await this.stagingDraftService.createDraft({
      actor: request.actor,
      targetCorpus: sourceNote.corpusId,
      noteType: sourceNote.frontmatter.type,
      title: buildRefreshTitle(sourceNote.frontmatter.title),
      sourcePrompt: buildRefreshPrompt(sourceNote.frontmatter, candidate),
      supportingSources: [
        {
          noteId: sourceNote.noteId,
          notePath: sourceNote.notePath,
          headingPath: ["Summary"],
          excerpt: sourceNote.frontmatter.summary
        }
      ],
      frontmatterOverrides: buildRefreshFrontmatterOverrides(
        sourceNote.frontmatter,
        candidate.state
      ),
      bodyHints: buildRefreshBodyHints(sourceNote.frontmatter, candidate, request.bodyHints)
    });

    if (!draftResult.ok) {
      return {
        ok: false,
        error: draftResult.error
      };
    }

    const auditResult = await this.auditHistoryService?.recordAction({
      actionType: "create_refresh_draft",
      actorId: request.actor.actorId,
      actorRole: request.actor.actorRole,
      source: request.actor.source,
      toolName: request.actor.toolName,
      occurredAt: new Date().toISOString(),
      outcome: "accepted",
      affectedNoteIds: [sourceNote.noteId, draftResult.data.draftNoteId],
      affectedChunkIds: [],
      detail: {
        sourceState: candidate.state,
        sourceNotePath: sourceNote.notePath,
        sourceValidity: {
          validFrom: candidate.validFrom,
          validUntil: candidate.validUntil
        },
        reusedExistingDraft: false
      }
    });

    return {
      ok: true,
      data: {
        sourceNoteId: sourceNote.noteId,
        sourceNotePath: sourceNote.notePath,
        sourceState: candidate.state,
        draftNoteId: draftResult.data.draftNoteId,
        draftPath: draftResult.data.draftPath,
        frontmatter: draftResult.data.frontmatter,
        body: draftResult.data.body,
        reusedExistingDraft: false,
        warnings: [
          ...draftResult.data.warnings,
          ...(auditResult && !auditResult.ok ? [auditResult.error.message] : [])
        ]
      }
    };
  }

  async createRefreshDraftBatch(
    request: CreateRefreshDraftBatchRequest
  ): Promise<ServiceResult<CreateRefreshDraftBatchResponse, TemporalRefreshErrorCode>> {
    if (!ALLOWED_REFRESH_ACTOR_ROLES.has(request.actor.actorRole)) {
      return {
        ok: false,
        error: {
          code: "forbidden",
          message: `Actor role '${request.actor.actorRole}' cannot create temporal refresh drafts.`
        }
      };
    }

    const report = await this.metadataControlStore.getTemporalValidityReport({
      asOf: request.asOf,
      expiringWithinDays: request.expiringWithinDays,
      corpusId: request.corpusId,
      limitPerCategory:
        request.limitPerCategory ?? DEFAULT_BATCH_LIMIT_PER_CATEGORY
    });
    const sourceStates =
      request.sourceStates?.length
        ? request.sourceStates
        : DEFAULT_BATCH_SOURCE_STATES;
    const orderedCandidates = flattenTemporalCandidates(report, sourceStates);

    if (orderedCandidates.length === 0) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message:
            "No expired, future-dated, or expiring-soon current-state notes matched the requested refresh criteria."
        }
      };
    }

    const maxDrafts = request.maxDrafts ?? DEFAULT_BATCH_MAX_DRAFTS;
    const selectedCandidates = orderedCandidates.slice(0, maxDrafts);
    const deferredCandidates = orderedCandidates.slice(selectedCandidates.length);
    const drafts: CreateRefreshDraftResponse[] = [];
    const skipped = deferredCandidates.map((candidate) => ({
      noteId: candidate.noteId,
      sourceState: candidate.state,
      reason: "Skipped because the batch reached its maxDrafts limit."
    }));
    const warningSet = new Set<string>();

    for (const candidate of selectedCandidates) {
      const result = await this.createRefreshDraft({
        actor: request.actor,
        noteId: candidate.noteId,
        asOf: report.asOf,
        expiringWithinDays: report.expiringWithinDays,
        bodyHints: request.bodyHints
      });

      if (!result.ok) {
        skipped.push({
          noteId: candidate.noteId,
          sourceState: candidate.state,
          reason: result.error.message
        });
        continue;
      }

      drafts.push(result.data);
      for (const warning of result.data.warnings) {
        warningSet.add(warning);
      }
    }

    if (deferredCandidates.length > 0) {
      warningSet.add(
        `${deferredCandidates.length} additional refresh candidate(s) were left pending because the batch maxDrafts limit was reached.`
      );
    }

    return {
      ok: true,
      data: {
        asOf: report.asOf,
        expiringWithinDays: report.expiringWithinDays,
        corpusId: request.corpusId,
        limitPerCategory: report.limitPerCategory,
        maxDrafts,
        sourceStates,
        candidatesConsidered: orderedCandidates.length,
        candidatesRemaining: deferredCandidates.length,
        createdCount: drafts.filter((draft) => !draft.reusedExistingDraft).length,
        reusedCount: drafts.filter((draft) => draft.reusedExistingDraft).length,
        drafts,
        skipped,
        warnings: [...warningSet]
      }
    };
  }

  private async findExistingRefreshDraft(
    corpusId: NoteFrontmatter["corpusId"],
    sourceNoteId: NoteFrontmatter["noteId"]
  ) {
    const drafts = await this.stagingDraftService.listDraftsByCorpus(corpusId);
    return drafts
      .filter(
        (draft) =>
          draft.lifecycleState === "draft" &&
          draft.frontmatter.supersedes?.includes(sourceNoteId)
      )
      .sort((left, right) => {
        const updatedCompare = right.frontmatter.updated.localeCompare(left.frontmatter.updated);
        if (updatedCompare !== 0) {
          return updatedCompare;
        }

        return left.noteId.localeCompare(right.noteId);
      })[0];
  }
}

function flattenTemporalCandidates(
  report: {
    expiredCurrentState: Array<{
      noteId: NoteFrontmatter["noteId"];
      state: CreateRefreshDraftResponse["sourceState"];
    }>;
    futureDatedCurrentState: Array<{
      noteId: NoteFrontmatter["noteId"];
      state: CreateRefreshDraftResponse["sourceState"];
    }>;
    expiringSoonCurrentState: Array<{
      noteId: NoteFrontmatter["noteId"];
      state: CreateRefreshDraftResponse["sourceState"];
    }>;
  },
  sourceStates: ReadonlyArray<CreateRefreshDraftResponse["sourceState"]>
) {
  const candidatesByState = {
    expired: report.expiredCurrentState,
    future_dated: report.futureDatedCurrentState,
    expiring_soon: report.expiringSoonCurrentState
  } satisfies Record<
    CreateRefreshDraftResponse["sourceState"],
    Array<{
      noteId: NoteFrontmatter["noteId"];
      state: CreateRefreshDraftResponse["sourceState"];
    }>
  >;

  return sourceStates.flatMap((state) => candidatesByState[state]);
}

function buildRefreshTitle(title: string): string {
  return `Refresh ${title}`;
}

function buildRefreshPrompt(
  frontmatter: NoteFrontmatter,
  candidate: {
    state: CreateRefreshDraftResponse["sourceState"];
    validFrom?: string;
    validUntil?: string;
  }
): string {
  const temporalClause =
    candidate.state === "expired"
      ? `Its validity window ended on ${candidate.validUntil ?? "an unknown date"}.`
      : candidate.state === "future_dated"
        ? `Its validity window does not begin until ${candidate.validFrom ?? "an unknown date"}.`
        : `Its validity window will end on ${candidate.validUntil ?? "an unknown date"}.`;

  return [
    `Refresh the canonical note '${frontmatter.title}' in scope '${frontmatter.scope}'.`,
    `The note is currently flagged as ${candidate.state.replace(/_/g, " ")}.`,
    temporalClause,
    "Preserve provenance, update any stale claims, and prepare the draft for normal validation and promotion."
  ].join(" ");
}

function buildRefreshFrontmatterOverrides(
  frontmatter: NoteFrontmatter,
  sourceState: CreateRefreshDraftResponse["sourceState"]
): Partial<NoteFrontmatter> {
  return {
    project: frontmatter.project,
    scope: frontmatter.scope,
    summary: `Refresh draft for ${frontmatter.title} (${sourceState.replace(/_/g, " ")}).`,
    tags: buildRefreshTags(frontmatter.tags),
    currentState: false,
    supersedes: [frontmatter.noteId],
    supersededBy: undefined,
    validFrom: undefined,
    validUntil: undefined
  };
}

function buildRefreshBodyHints(
  frontmatter: NoteFrontmatter,
  candidate: {
    state: CreateRefreshDraftResponse["sourceState"];
    validFrom?: string;
    validUntil?: string;
    summary?: string;
    notePath: string;
  },
  requestBodyHints: string[] | undefined
): string[] {
  const hints = [
    `Refresh the canonical note at ${candidate.notePath}.`,
    `Previous summary: ${frontmatter.summary}`,
    `Current temporal status: ${candidate.state.replace(/_/g, " ")}.`,
    candidate.validFrom ? `Previous validFrom: ${candidate.validFrom}` : undefined,
    candidate.validUntil ? `Previous validUntil: ${candidate.validUntil}` : undefined,
    candidate.summary ? `Candidate summary: ${candidate.summary}` : undefined,
    ...(requestBodyHints ?? [])
  ];

  return [...new Set(hints.filter((hint): hint is string => Boolean(hint?.trim())))];
}

function buildRefreshTags(tags: ControlledTag[]): ControlledTag[] {
  const nextTags = new Set<ControlledTag>();

  for (const tag of tags) {
    if (tag.startsWith("status/")) {
      continue;
    }

    nextTags.add(tag);
  }

  nextTags.add("risk/stale-context");
  return [...nextTags].sort();
}
