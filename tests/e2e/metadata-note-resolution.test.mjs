import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import * as application from "../../packages/application/dist/index.js";

test("canonical lookup resolves through metadata path instead of repository-wide ID scan", async () => {
  const note = canonicalNote();
  const service = new application.CanonicalNoteService(
    {
      async getById() {
        throw new Error("canonical getById scan should not be used when metadata has the path");
      },
      async getByPath(notePath) {
        assert.equal(notePath, note.notePath);
        return note;
      },
      async listByCorpus() {
        return [];
      },
      async writeCanonicalNote(record) {
        return record;
      },
      async exists() {
        return true;
      }
    },
    {
      async getNoteById(noteId) {
        assert.equal(noteId, note.noteId);
        return metadataRecordForCanonical(note);
      }
    }
  );

  const result = await service.getCanonicalNote(note.noteId);

  assert.equal(result.ok, true);
  assert.equal(result.data.noteId, note.noteId);
});

test("staging lookup resolves through metadata path instead of repository-wide ID scan", async () => {
  const draft = stagingDraft();
  const service = new application.StagingDraftService(
    {
      async createDraft(record) {
        return record;
      },
      async updateDraft(record) {
        return record;
      },
      async getById() {
        throw new Error("staging getById scan should not be used when metadata has the path");
      },
      async getByPath(draftPath) {
        assert.equal(draftPath, draft.draftPath);
        return draft;
      },
      async listByCorpus() {
        return [];
      }
    },
    {
      async getNoteById(noteId) {
        assert.equal(noteId, draft.noteId);
        return metadataRecordForDraft(draft);
      }
    },
    {
      validate() {
        return { ok: true, data: { findings: [] } };
      }
    }
  );

  const result = await service.getDraft(draft.noteId);

  assert.equal(result.ok, true);
  assert.equal(result.data.noteId, draft.noteId);
});

function canonicalNote() {
  const noteId = randomUUID();
  return {
    noteId,
    corpusId: "mimisbrunnr",
    notePath: "mimisbrunnr/architecture/indexed-canonical.md",
    revision: "rev-canonical",
    frontmatter: {
      noteId,
      title: "Indexed Canonical",
      project: "mimir",
      type: "reference",
      status: "promoted",
      updated: "2026-04-23",
      summary: "Canonical lookup should resolve through metadata.",
      tags: ["project/mimir", "status/promoted"],
      scope: "metadata-resolution",
      corpusId: "mimisbrunnr",
      currentState: false
    },
    body: "## Summary\n\nCanonical lookup should resolve through metadata."
  };
}

function stagingDraft() {
  const noteId = randomUUID();
  return {
    noteId,
    corpusId: "mimisbrunnr",
    draftPath: "mimisbrunnr/staging/indexed-draft.md",
    revision: "rev-draft",
    lifecycleState: "draft",
    frontmatter: {
      noteId,
      title: "Indexed Draft",
      project: "mimir",
      type: "decision",
      status: "draft",
      updated: "2026-04-23",
      summary: "Staging lookup should resolve through metadata.",
      tags: ["project/mimir", "status/draft"],
      scope: "metadata-resolution",
      corpusId: "mimisbrunnr",
      currentState: false
    },
    body: "## Context\n\nStaging lookup should resolve through metadata."
  };
}

function metadataRecordForCanonical(note) {
  return {
    noteId: note.noteId,
    corpusId: note.corpusId,
    notePath: note.notePath,
    noteType: note.frontmatter.type,
    lifecycleState: note.frontmatter.status,
    revision: note.revision,
    updatedAt: note.frontmatter.updated,
    currentState: note.frontmatter.currentState,
    validFrom: note.frontmatter.validFrom,
    validUntil: note.frontmatter.validUntil,
    summary: note.frontmatter.summary,
    scope: note.frontmatter.scope,
    tags: note.frontmatter.tags,
    contentHash: "canonical-hash",
    semanticSignature: "canonical-signature"
  };
}

function metadataRecordForDraft(draft) {
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
    tags: draft.frontmatter.tags,
    contentHash: "draft-hash",
    semanticSignature: "draft-signature"
  };
}
