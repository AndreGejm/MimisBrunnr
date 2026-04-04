import { createHash } from "node:crypto";
import type {
  CanonicalNoteRecord,
  CanonicalNoteRepository
} from "../ports/canonical-note-repository.js";
import type { MetadataControlStore } from "../ports/metadata-control-store.js";
import type { ControlledTag, CorpusId, NoteId } from "@multi-agent-brain/domain";
import type { ServiceResult } from "@multi-agent-brain/contracts";

type CanonicalNoteErrorCode = "not_found" | "write_failed";

export class CanonicalNoteService {
  constructor(
    private readonly canonicalNoteRepository: CanonicalNoteRepository,
    private readonly metadataControlStore: MetadataControlStore
  ) {}

  async getCanonicalNote(
    noteId: NoteId
  ): Promise<ServiceResult<CanonicalNoteRecord, CanonicalNoteErrorCode>> {
    const note = await this.canonicalNoteRepository.getById(noteId);
    if (!note) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `Canonical note '${noteId}' was not found.`
        }
      };
    }

    return {
      ok: true,
      data: note
    };
  }

  async getCanonicalNoteByPath(
    notePath: string
  ): Promise<ServiceResult<CanonicalNoteRecord, CanonicalNoteErrorCode>> {
    const note = await this.canonicalNoteRepository.getByPath(notePath);
    if (!note) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `Canonical note '${notePath}' was not found.`
        }
      };
    }

    return {
      ok: true,
      data: note
    };
  }

  async listCanonicalNotes(
    corpusId: CorpusId
  ): Promise<ServiceResult<CanonicalNoteRecord[], CanonicalNoteErrorCode>> {
    return {
      ok: true,
      data: await this.canonicalNoteRepository.listByCorpus(corpusId)
    };
  }

  async writeCanonicalNote(
    note: CanonicalNoteRecord
  ): Promise<ServiceResult<CanonicalNoteRecord, CanonicalNoteErrorCode>> {
    try {
      const policyViolation = validateCanonicalCorpusPolicy(note);
      if (policyViolation) {
        return {
          ok: false,
          error: {
            code: "write_failed",
            message: policyViolation
          }
        };
      }

      const persisted = await this.persistCanonicalNote(note);
      return {
        ok: true,
        data: persisted
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: "Failed to persist canonical note state.",
          details: {
            reason: error instanceof Error ? error.message : String(error)
          }
        }
      };
    }
  }

  async writeCurrentStateSnapshot(
    note: CanonicalNoteRecord
  ): Promise<ServiceResult<CanonicalNoteRecord, CanonicalNoteErrorCode>> {
    const preparedSnapshot = this.prepareCurrentStateSnapshot(note);
    if (!preparedSnapshot.ok) {
      return preparedSnapshot;
    }

    try {
      const persisted = await this.persistCanonicalNote(preparedSnapshot.data);
      return {
        ok: true,
        data: persisted
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: "Failed to persist current-state snapshot note.",
          details: {
            reason: error instanceof Error ? error.message : String(error)
          }
        }
      };
    }
  }

  prepareCurrentStateSnapshot(
    note: CanonicalNoteRecord
  ): ServiceResult<CanonicalNoteRecord, CanonicalNoteErrorCode> {
    if (note.corpusId !== "context_brain" || !note.frontmatter.currentState) {
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: "Current-state snapshots can only be generated for context_brain current-state notes."
        }
      };
    }

    if (note.frontmatter.tags.includes("topic/current-state-snapshot")) {
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: "Snapshot notes cannot generate additional snapshots."
        }
      };
    }

    return {
      ok: true,
      data: buildCurrentStateSnapshot(note)
    };
  }

  async writeCanonicalNotes(
    notes: CanonicalNoteRecord[]
  ): Promise<ServiceResult<CanonicalNoteRecord[], CanonicalNoteErrorCode>> {
    const persistedNotes: CanonicalNoteRecord[] = [];
    for (const note of notes) {
      const persisted = await this.writeCanonicalNote(note);
      if (!persisted.ok) {
        return {
          ok: false,
          error: persisted.error
        };
      }

      persistedNotes.push(persisted.data);
    }

    return {
      ok: true,
      data: persistedNotes
    };
  }

  private async persistCanonicalNote(note: CanonicalNoteRecord): Promise<CanonicalNoteRecord> {
    const persisted = await this.canonicalNoteRepository.writeCanonicalNote(note);

    await this.metadataControlStore.upsertNote({
      noteId: persisted.noteId,
      corpusId: persisted.corpusId,
      notePath: persisted.notePath,
      noteType: persisted.frontmatter.type,
      lifecycleState: persisted.frontmatter.status,
      revision: persisted.revision,
      updatedAt: persisted.frontmatter.updated,
      currentState: persisted.frontmatter.currentState,
      validFrom: persisted.frontmatter.validFrom,
      validUntil: persisted.frontmatter.validUntil,
      summary: persisted.frontmatter.summary,
      scope: persisted.frontmatter.scope,
      tags: persisted.frontmatter.tags,
      contentHash: hashText(persisted.body),
      semanticSignature: buildSemanticSignature(
        persisted.frontmatter.title,
        persisted.frontmatter.summary,
        persisted.frontmatter.scope
      )
    });

    return persisted;
  }
}

function validateCanonicalCorpusPolicy(note: CanonicalNoteRecord): string | undefined {
  const normalizedPath = note.notePath.replace(/\\/g, "/");
  if (!normalizedPath.startsWith(`${note.corpusId}/`)) {
    return `Canonical note path '${note.notePath}' must remain inside the '${note.corpusId}' corpus root.`;
  }

  if (note.corpusId === "general_notes") {
    if (note.frontmatter.currentState) {
      return "General notes cannot be marked as current-state canonical context.";
    }

    if (note.frontmatter.tags.includes("status/current")) {
      return "General notes cannot carry the status/current tag.";
    }
  }

  return undefined;
}

function buildCurrentStateSnapshot(note: CanonicalNoteRecord): CanonicalNoteRecord {
  const snapshotPath = buildSnapshotPath(note);
  const snapshotId = hashText(`snapshot:${note.corpusId}:${snapshotPath}`).slice(0, 32);

  return {
    noteId: snapshotId,
    corpusId: note.corpusId,
    notePath: snapshotPath,
    revision: "",
    frontmatter: {
      noteId: snapshotId,
      title: `${note.frontmatter.title} Current`,
      project: note.frontmatter.project,
      type: "reference",
      status: "promoted",
      updated: note.frontmatter.updated,
      summary: `Current-state snapshot for ${note.frontmatter.title}. ${note.frontmatter.summary}`.trim(),
      tags: normalizeSnapshotTags(note.frontmatter.tags),
      scope: note.frontmatter.scope,
      corpusId: note.corpusId,
      currentState: false,
      validFrom: note.frontmatter.validFrom,
      validUntil: note.frontmatter.validUntil,
      supersedes: undefined,
      supersededBy: undefined
    },
    body: [
      "## Summary",
      "",
      note.frontmatter.summary,
      "",
      "## Details",
      "",
      `- Canonical note: ${note.notePath}`,
      `- Canonical note ID: ${note.noteId}`,
      `- Note type: ${note.frontmatter.type}`,
      `- Scope: ${note.frontmatter.scope}`,
      `- Updated: ${note.frontmatter.updated}`,
      `- Project: ${note.frontmatter.project}`,
      "",
      "## Sources",
      "",
      `- ${note.notePath}`
    ].join("\n")
  };
}

function normalizeSnapshotTags(tags: ControlledTag[]): ControlledTag[] {
  const nextTags = new Set<ControlledTag>(tags);
  nextTags.delete("status/current");
  nextTags.delete("status/superseded");
  nextTags.delete("status/draft");
  nextTags.add("status/promoted");
  nextTags.add("topic/current-state-snapshot");
  return [...nextTags].sort();
}

function buildSnapshotPath(note: CanonicalNoteRecord): string {
  const projectSlug = slugify(note.frontmatter.project);
  const titleSlug = slugify(note.frontmatter.title);
  return `${note.corpusId}/current-state/${projectSlug}/${titleSlug}-current.md`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildSemanticSignature(title: string, summary: string, scope: string): string {
  return hashText(`${title}\n${summary}\n${scope}`);
}
