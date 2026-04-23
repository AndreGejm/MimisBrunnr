import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServiceContainer } from "../../packages/infrastructure/dist/index.js";

test("namespace service keeps canonical and staging notes distinct", async (t) => {
  const { container } = await createHarness(t);
  assert.ok(container.services.contextNamespaceService);

  const { services } = container;
  const canonical = await createCanonicalNote(services);
  const staging = await createStagingDraft(services);

  const result = await services.contextNamespaceService.listTree({
    ownerScope: "mimisbrunnr",
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
  assert.equal(canonicalNode.ownerScope, "mimisbrunnr");
  assert.equal(canonicalNode.uri, `mimir://mimisbrunnr/note/${canonical.noteId}`);
  assert.equal(stagingNode.contextKind, "note");
  assert.equal(stagingNode.sourceType, "staging_draft");
  assert.equal(stagingNode.ownerScope, "mimisbrunnr");
  assert.equal(stagingNode.uri, `mimir://mimisbrunnr/note/${staging.draftNoteId}`);
  assert.notEqual(canonicalNode.authorityState, stagingNode.authorityState);
});

test("namespace service projects session archives into the sessions scope", async (t) => {
  const { container } = await createHarness(t);
  assert.ok(container.services.contextNamespaceService);

  const { services } = container;
  const archive = await createSessionArchive(services);

  const scopedResult = await services.contextNamespaceService.listTree({
    ownerScope: "sessions",
    authorityStates: ["session"]
  });

  assert.equal(scopedResult.ok, true);
  assert.equal(scopedResult.data.nodes.length, 1);
  assert.deepEqual(scopedResult.data.nodes[0], {
    uri: archive.uri,
    ownerScope: "sessions",
    contextKind: "session_archive",
    authorityState: "session",
    sourceType: "session_archive",
    sourceRef: archive.archiveId,
    freshness: {
      validFrom: archive.createdAt,
      validUntil: archive.createdAt,
      freshnessClass: "current",
      freshnessReason: "Immutable session archive."
    },
    representationAvailability: {
      L0: false,
      L1: false,
      L2: true
    },
    promotionStatus: "not_applicable",
    supersessionStatus: "archived",
    createdAt: archive.createdAt,
    updatedAt: archive.createdAt
  });

  const readResult = await services.contextNamespaceService.readNode({
    uri: archive.uri
  });
  assert.equal(readResult.ok, true);
  assert.deepEqual(readResult.data.node, scopedResult.data.nodes[0]);
});

test("namespace service projects imported artifacts into the imports scope", async (t) => {
  const { container, root } = await createHarness(t);
  assert.ok(container.services.contextNamespaceService);

  const { services } = container;
  const importJob = await createImportedArtifact(services, root);

  const scopedResult = await services.contextNamespaceService.listTree({
    ownerScope: "imports",
    authorityStates: ["imported"]
  });

  assert.equal(scopedResult.ok, true);
  assert.equal(scopedResult.data.nodes.length, 1);
  assert.deepEqual(scopedResult.data.nodes[0], {
    uri: `mimir://imports/resource/${importJob.importJobId}`,
    ownerScope: "imports",
    contextKind: "resource",
    authorityState: "imported",
    sourceType: "import_artifact",
    sourceRef: importJob.importJobId,
    freshness: {
      validFrom: importJob.createdAt,
      validUntil: importJob.updatedAt,
      freshnessClass: "current",
      freshnessReason: "Imported artifacts remain read-only until reviewed."
    },
    representationAvailability: {
      L0: false,
      L1: false,
      L2: true
    },
    promotionStatus: "not_applicable",
    supersessionStatus: "not_applicable",
    createdAt: importJob.createdAt,
    updatedAt: importJob.updatedAt
  });

  const readResult = await services.contextNamespaceService.readNode({
    uri: `mimir://imports/resource/${importJob.importJobId}`
  });
  assert.equal(readResult.ok, true);
  assert.deepEqual(readResult.data.node, scopedResult.data.nodes[0]);
});

async function createHarness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-context-namespace-"));
  const container = buildServiceContainer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "context-namespace.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_namespace_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 8080,
    logLevel: "error"
  });

  t.after(async () => {
    container.dispose?.();
    await rm(root, { recursive: true, force: true });
  });

  return {
    root,
    container,
    services: container.services
  };
}

async function createCanonicalNote(services) {
  const noteId = randomUUID();
  const note = {
    noteId,
    corpusId: "mimisbrunnr",
    notePath: "mimisbrunnr/namespace/canonical-node.md",
    revision: "",
    frontmatter: {
      noteId,
      title: "Namespace Canonical Node",
      project: "mimir",
      type: "reference",
      status: "promoted",
      updated: "2026-04-06",
      summary: "Canonical namespace node for projection coverage.",
      tags: [
        "project/mimir",
        "domain/metadata",
        "status/promoted"
      ],
      scope: "namespace",
      corpusId: "mimisbrunnr",
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
    targetCorpus: "mimisbrunnr",
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

async function createSessionArchive(services) {
  const result = await services.sessionArchiveService.createArchive({
    sessionId: "context-namespace-session",
    messages: [
      {
        role: "user",
        content: "Summarize the namespace projection rules."
      },
      {
        role: "assistant",
        content: "Canonical and staging nodes stay distinct in the namespace."
      }
    ]
  });

  assert.equal(result.ok, true);
  return result.data.archive;
}

async function createImportedArtifact(services, root) {
  const sourcePath = path.join(root, "imports", "namespace-import.md");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(
    sourcePath,
    [
      "# Namespace Import",
      "",
      "Imported artifacts should appear in the shared imports namespace.",
      "",
      "## Details",
      "",
      "This source stays imported until explicitly reviewed."
    ].join("\n"),
    "utf8"
  );

  const result = await services.importOrchestrationService.importResource({
    actor: actor("operator"),
    sourcePath,
    importKind: "document"
  });

  assert.equal(result.ok, true);
  return result.data.importJob;
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
