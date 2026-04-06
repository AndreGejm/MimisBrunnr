import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CanonicalNoteService,
  ContextNamespaceService,
  NoteValidationService,
  StagingDraftService
} from "../../packages/application/dist/index.js";
import {
  FileSystemCanonicalNoteRepository,
  FileSystemStagingNoteRepository,
  SqliteContextNamespaceStore,
  SqliteMetadataControlStore
} from "../../packages/infrastructure/dist/index.js";

test("namespace service keeps canonical and staging notes distinct", async (t) => {
  const { services } = await createHarness(t);
  const canonical = await createCanonicalNote(services);
  const staging = await createStagingDraft(services);

  const result = await services.contextNamespaceService.listTree({
    ownerScope: "context_brain",
    authorityStates: ["canonical", "staging"]
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.nodes.length, 2);

  const canonicalNode = result.data.nodes.find((node) => node.authorityState === "canonical");
  const stagingNode = result.data.nodes.find((node) => node.authorityState === "staging");

  assert.ok(canonicalNode, "expected canonical namespace node");
  assert.ok(stagingNode, "expected staging namespace node");
  assert.equal(canonicalNode.contextKind, "note");
  assert.equal(canonicalNode.sourceType, "canonical_note");
  assert.equal(canonicalNode.ownerScope, "context_brain");
  assert.equal(canonicalNode.uri, `mab://context_brain/note/${canonical.noteId}`);
  assert.equal(stagingNode.contextKind, "note");
  assert.equal(stagingNode.sourceType, "staging_draft");
  assert.equal(stagingNode.ownerScope, "context_brain");
  assert.equal(stagingNode.uri, `mab://context_brain/note/${staging.draftNoteId}`);
  assert.notEqual(canonicalNode.authorityState, stagingNode.authorityState);
});

async function createHarness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-context-namespace-"));
  const vaultRoot = path.join(root, "vault", "canonical");
  const stagingRoot = path.join(root, "vault", "staging");
  const sqlitePath = path.join(root, "state", "context-namespace.sqlite");

  const canonicalNoteRepository = new FileSystemCanonicalNoteRepository(vaultRoot);
  const stagingNoteRepository = new FileSystemStagingNoteRepository(stagingRoot);
  const metadataControlStore = new SqliteMetadataControlStore(sqlitePath);
  const noteValidationService = new NoteValidationService();
  const canonicalNoteService = new CanonicalNoteService(
    canonicalNoteRepository,
    metadataControlStore
  );
  const stagingDraftService = new StagingDraftService(
    stagingNoteRepository,
    metadataControlStore,
    noteValidationService
  );
  const contextNamespaceStore = new SqliteContextNamespaceStore(sqlitePath);
  const contextNamespaceService = new ContextNamespaceService(contextNamespaceStore);

  t.after(async () => {
    contextNamespaceStore.close?.();
    metadataControlStore.close?.();
    await rm(root, { recursive: true, force: true });
  });

  return {
    root,
    services: {
      canonicalNoteService,
      stagingDraftService,
      contextNamespaceService
    }
  };
}

async function createCanonicalNote(services) {
  const noteId = randomUUID();
  const note = {
    noteId,
    corpusId: "context_brain",
    notePath: "context_brain/namespace/canonical-node.md",
    revision: "",
    frontmatter: {
      noteId,
      title: "Namespace Canonical Node",
      project: "multi-agent-brain",
      type: "reference",
      status: "promoted",
      updated: "2026-04-06",
      summary: "Canonical namespace node for projection coverage.",
      tags: [
        "project/multi-agent-brain",
        "domain/metadata",
        "status/promoted"
      ],
      scope: "namespace",
      corpusId: "context_brain",
      currentState: true
    },
    body: [
      "## Summary",
      "",
      "Canonical namespace node for projection coverage.",
      "",
      "## Details",
      "",
      "This canonical note should appear as a canonical namespace node.",
      "",
      "## Sources",
      "",
      "- none"
    ].join("\n")
  };

  const result = await services.canonicalNoteService.writeCanonicalNote(note);
  assert.equal(result.ok, true);
  return result.data;
}

async function createStagingDraft(services) {
  const result = await services.stagingDraftService.createDraft({
    actor: actor("writer"),
    targetCorpus: "context_brain",
    noteType: "reference",
    title: "Namespace Staging Node",
    sourcePrompt: "Draft a staging namespace node for the projection test.",
    supportingSources: [],
    bodyHints: [
      "This staging draft should remain distinct from the canonical node.",
      "The namespace projection must preserve authority state."
    ],
    frontmatterOverrides: {
      scope: "namespace"
    }
  });

  assert.equal(result.ok, true);
  return result.data;
}

function actor(role) {
  return {
    actorId: `${role}-actor`,
    actorRole: role,
    transport: "internal",
    source: "test-suite",
    requestId: randomUUID(),
    initiatedAt: "2026-04-06T00:00:00.000Z",
    toolName: "context-namespace-test"
  };
}
