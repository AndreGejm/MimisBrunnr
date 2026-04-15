import { createHash } from "node:crypto";
import type { CanonicalNoteRecord } from "../ports/canonical-note-repository.js";
import type {
  ContextRepresentationLayer,
  ContextRepresentationRecord,
  ContextRepresentationStore
} from "../ports/context-representation-store.js";
import type { ServiceResult } from "@mimir/contracts";

export interface ContextRepresentationSet {
  noteId: string;
  representations: Record<ContextRepresentationLayer, ContextRepresentationRecord>;
}

export class ContextRepresentationService {
  constructor(private readonly representationStore: ContextRepresentationStore) {}

  async regenerateForCanonicalNote(note: CanonicalNoteRecord): Promise<void> {
    const title = normalizeSection(note.frontmatter.title);
    const summary = normalizeSection(note.frontmatter.summary ?? "");
    const body = normalizeSection(note.body);
    const contentSeed = [title, summary || body, body].filter(Boolean).join("\n\n");
    const generatedAt = new Date().toISOString();
    const sourceHash = hashText(contentSeed);

    await this.representationStore.upsertRepresentations({
      noteId: note.noteId,
      representations: {
        L0: {
          noteId: note.noteId,
          layer: "L0",
          content: [title, summary || body].filter(Boolean).join("\n\n"),
          generatedAt,
          sourceHash
        },
        L1: {
          noteId: note.noteId,
          layer: "L1",
          content: [title, summary || body, body].filter(Boolean).join("\n\n"),
          generatedAt,
          sourceHash
        }
      }
    });
  }

  async listForNode(
    noteId: string
  ): Promise<ServiceResult<ContextRepresentationSet, "not_found">> {
    const representations = await this.representationStore.listRepresentations(noteId);
    if (representations.length === 0) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `Context representations for '${noteId}' were not found.`
        }
      };
    }

    const byLayer = new Map(
      representations.map((representation) => [representation.layer, representation] as const)
    );
    const l0 = byLayer.get("L0");
    const l1 = byLayer.get("L1");
    if (!l0 || !l1) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `Context representations for '${noteId}' were incomplete.`
        }
      };
    }

    return {
      ok: true,
      data: {
        noteId,
        representations: {
          L0: l0,
          L1: l1
        }
      }
    };
  }
}

function normalizeSection(value: string): string {
  return value.trim();
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
