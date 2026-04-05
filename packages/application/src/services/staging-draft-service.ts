import { randomUUID } from "node:crypto";
import type {
  StagingDraftRecord,
  StagingNoteRepository
} from "../ports/staging-note-repository.js";
import type { MetadataControlStore } from "../ports/metadata-control-store.js";
import type { DraftingProvider } from "../ports/drafting-provider.js";
import { NOTE_VALIDATION_POLICY, NoteValidationService } from "./note-validation-service.js";
import type {
  DraftNoteRequest,
  DraftNoteResponse,
  ServiceResult
} from "@multi-agent-brain/contracts";
import type { ControlledTag, NoteFrontmatter, NoteId, NoteType } from "@multi-agent-brain/domain";

type DraftNoteErrorCode = "forbidden" | "validation_failed" | "write_failed" | "not_found";

const ALLOWED_DRAFT_ACTOR_ROLES = new Set(["writer", "orchestrator", "operator", "system"]);

export class StagingDraftService {
  constructor(
    private readonly stagingNoteRepository: StagingNoteRepository,
    private readonly metadataControlStore: MetadataControlStore,
    private readonly noteValidationService: NoteValidationService,
    private readonly draftingProvider?: DraftingProvider
  ) {}

  async createDraft(
    request: DraftNoteRequest
  ): Promise<ServiceResult<DraftNoteResponse, DraftNoteErrorCode>> {
    if (!ALLOWED_DRAFT_ACTOR_ROLES.has(request.actor.actorRole)) {
      return {
        ok: false,
        error: {
          code: "forbidden",
          message: `Actor role '${request.actor.actorRole}' cannot create staging drafts.`
        }
      };
    }

    const corpusViolation = validateDraftCorpusBoundaries(request);
    if (corpusViolation) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: corpusViolation,
          details: {
            targetCorpus: request.targetCorpus,
            supportingSources: request.supportingSources.map((source) => source.notePath)
          }
        }
      };
    }

    const draftNoteId = request.frontmatterOverrides?.noteId ?? randomUUID();
    const frontmatter = buildDraftFrontmatter(request, draftNoteId);
    const draftPath = buildDraftPath(request.targetCorpus, request.title, draftNoteId);
    const generatedDraft = await this.generateDraftBody(request, draftNoteId);
    const body = generatedDraft.body;
    const validation = this.noteValidationService.validate({
      actor: request.actor,
      targetCorpus: request.targetCorpus,
      notePath: draftPath,
      frontmatter,
      body,
      validationMode: "draft"
    });

    if (!validation.valid || !validation.normalizedFrontmatter) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: "Draft note did not satisfy deterministic schema validation.",
          details: {
            violations: validation.violations
          }
        }
      };
    }

    try {
      const persisted = await this.stagingNoteRepository.createDraft({
        noteId: draftNoteId,
        corpusId: request.targetCorpus,
        draftPath,
        revision: "",
        lifecycleState: validation.normalizedFrontmatter.status,
        frontmatter: validation.normalizedFrontmatter,
        body
      });

      await this.metadataControlStore.upsertNote({
        noteId: persisted.noteId,
        corpusId: persisted.corpusId,
        notePath: persisted.draftPath,
        noteType: persisted.frontmatter.type,
        lifecycleState: persisted.lifecycleState,
        revision: persisted.revision,
        updatedAt: persisted.frontmatter.updated,
        currentState: persisted.frontmatter.currentState,
        validFrom: persisted.frontmatter.validFrom,
        validUntil: persisted.frontmatter.validUntil,
        summary: persisted.frontmatter.summary,
        scope: persisted.frontmatter.scope,
        tags: persisted.frontmatter.tags
      });

      return {
        ok: true,
        data: {
          draftNoteId: persisted.noteId,
          lifecycleState: persisted.lifecycleState,
          draftPath: persisted.draftPath,
          frontmatter: persisted.frontmatter,
          body: persisted.body,
          warnings: [
            ...generatedDraft.warnings,
            ...validation.violations
            .filter((violation) => violation.severity === "warning")
            .map((violation) => violation.message)
          ]
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: "Failed to persist staging draft state.",
          details: {
            reason: error instanceof Error ? error.message : String(error)
          }
        }
      };
    }
  }

  async getDraft(
    noteId: NoteId
  ): Promise<ServiceResult<StagingDraftRecord, DraftNoteErrorCode>> {
    const draft = await this.stagingNoteRepository.getById(noteId);
    if (!draft) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `Staging draft '${noteId}' was not found.`
        }
      };
    }

    return {
      ok: true,
      data: draft
    };
  }

  async listDraftsByCorpus(
    corpusId: DraftNoteRequest["targetCorpus"]
  ): Promise<StagingDraftRecord[]> {
    return this.stagingNoteRepository.listByCorpus(corpusId);
  }

  private async generateDraftBody(
    request: DraftNoteRequest,
    draftNoteId: NoteId
  ): Promise<{ body: string; warnings: string[] }> {
    const fallbackBody = buildDraftBody(
      request.noteType,
      request.bodyHints ?? [],
      request.supportingSources.map((source) => source.notePath)
    );

    if (!this.draftingProvider) {
      return {
        body: fallbackBody,
        warnings: []
      };
    }

    try {
      const generated = await this.draftingProvider.draftStructuredNote({
        ...request,
        frontmatterOverrides: {
          ...request.frontmatterOverrides,
          noteId: draftNoteId
        }
      });

      if (!generated.body.trim()) {
        return {
          body: fallbackBody,
          warnings: ["Local drafting provider returned an empty body; deterministic fallback was used."]
        };
      }

      return {
        body: generated.body,
        warnings: generated.warnings ?? []
      };
    } catch (error) {
      return {
        body: fallbackBody,
        warnings: [
          `Local drafting provider failed; deterministic fallback was used. Reason: ${error instanceof Error ? error.message : String(error)}`
        ]
      };
    }
  }
}

function buildDraftFrontmatter(request: DraftNoteRequest, noteId: NoteId): NoteFrontmatter {
  const baseTags = new Set<ControlledTag>([
    "project/multi-agent-brain",
    "status/draft",
    request.targetCorpus === "context_brain" ? "domain/retrieval" : "artifact/application"
  ]);

  for (const tag of request.frontmatterOverrides?.tags ?? []) {
    baseTags.add(tag);
  }

  if (request.targetCorpus === "general_notes") {
    baseTags.delete("status/current");
  }

  return {
    noteId,
    title: request.title,
    project: request.frontmatterOverrides?.project ?? "multi-agent-brain",
    type: request.noteType,
    status: request.frontmatterOverrides?.status ?? "draft",
    updated: request.frontmatterOverrides?.updated ?? currentDateIso(),
    summary: request.frontmatterOverrides?.summary ?? summarizePrompt(request.sourcePrompt),
    tags: [...baseTags],
    scope: request.frontmatterOverrides?.scope ?? (request.targetCorpus === "context_brain" ? "staging" : "general_notes"),
    corpusId: request.targetCorpus,
    currentState: request.targetCorpus === "general_notes"
      ? false
      : (request.frontmatterOverrides?.currentState ?? false),
    validFrom: request.frontmatterOverrides?.validFrom,
    validUntil: request.frontmatterOverrides?.validUntil,
    supersedes: request.frontmatterOverrides?.supersedes,
    supersededBy: request.targetCorpus === "general_notes"
      ? undefined
      : request.frontmatterOverrides?.supersededBy
  };
}

function buildDraftPath(targetCorpus: DraftNoteRequest["targetCorpus"], title: string, noteId: NoteId): string {
  return `${targetCorpus}/${slugify(title)}-${noteId.slice(0, 8)}.md`;
}

function buildDraftBody(noteType: NoteType, bodyHints: string[], sourcePaths: string[]): string {
  const sections = NOTE_VALIDATION_POLICY.requiredSectionsByType[noteType] ?? [];
  const sourceBlock = sourcePaths.length > 0
    ? `\n## Sources\n${sourcePaths.map((sourcePath) => `- ${sourcePath}`).join("\n")}`
    : "";
  const hintsBlock = bodyHints.length > 0
    ? `\n## Draft Hints\n${bodyHints.map((hint) => `- ${hint}`).join("\n")}`
    : "";

  return [
    ...sections.map((section) => `## ${section}\n\nTBD.`),
    sourceBlock.trim(),
    hintsBlock.trim()
  ]
    .filter(Boolean)
    .join("\n\n");
}

function summarizePrompt(sourcePrompt: string): string {
  const normalized = sourcePrompt.replace(/\s+/g, " ").trim();
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
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

function validateDraftCorpusBoundaries(request: DraftNoteRequest): string | undefined {
  if (request.targetCorpus !== "context_brain") {
    return undefined;
  }

  const leakingSources = request.supportingSources
    .map((source) => source.notePath.replace(/\\/g, "/"))
    .filter((notePath) => notePath.startsWith("general_notes/"));

  if (leakingSources.length === 0) {
    return undefined;
  }

  return "Context-brain drafts cannot directly source from general_notes without explicit promotion.";
}
