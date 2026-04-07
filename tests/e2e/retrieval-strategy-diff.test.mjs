import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildServiceContainer,
  validateTransportRequest
} from "../../packages/infrastructure/dist/index.js";

test("flat and hierarchical retrieval can be compared side-by-side for the same fixture", async (t) => {
  const { container } = await createHarness(t);

  await createAndPromote(container, {
    title: "Writer Promotion Policy",
    noteType: "decision",
    scope: "retrieval-strategy-diff-a",
    bodyHints: [
      "Writer promotion policy stays behind orchestrator review.",
      "Promotion happens after staging validation."
    ],
    promoteAsCurrentState: true
  });

  await createAndPromote(container, {
    title: "Writer Promotion Constraints",
    noteType: "constraint",
    scope: "retrieval-strategy-diff-b",
    bodyHints: [
      "Writers draft notes but never promote canonical memory directly.",
      "Retrieval should preserve the flat baseline while comparing alternatives."
    ]
  });

  await createAndPromote(container, {
    title: "Writer Promotion Rollout",
    noteType: "architecture",
    scope: "retrieval-strategy-diff-c",
    bodyHints: [
      "Hierarchical retrieval must stay opt-in during rollout.",
      "Packet diff checks compare hierarchical packets against the flat baseline."
    ]
  });

  const validatedDefault = validateTransportRequest("search-context", {
    query: "writer promotion policy",
    corpusIds: ["context_brain"],
    budget: {
      maxTokens: 600,
      maxSources: 3,
      maxRawExcerpts: 1,
      maxSummarySentences: 4
    }
  });
  assert.equal(validatedDefault.strategy, undefined);

  const validatedHierarchical = validateTransportRequest("search-context", {
    query: "writer promotion policy",
    corpusIds: ["context_brain"],
    budget: {
      maxTokens: 600,
      maxSources: 3,
      maxRawExcerpts: 1,
      maxSummarySentences: 4
    },
    strategy: "hierarchical"
  });
  assert.equal(validatedHierarchical.strategy, "hierarchical");

  const flat = await retrieve(container, {
    query: "writer promotion policy"
  });
  const hierarchical = await retrieve(container, {
    query: "writer promotion policy",
    strategy: "hierarchical"
  });

  assert.equal(flat.ok, true);
  assert.equal(hierarchical.ok, true);
  assert.equal(flat.data.trace.strategy, "flat");
  assert.equal(hierarchical.data.trace.strategy, "hierarchical");
  assert.ok(Array.isArray(hierarchical.data.trace.events));
  assert.ok(hierarchical.data.trace.events.length > 0);
  assert.ok(flat.data.packet.evidence.length <= 3);
  assert.ok(hierarchical.data.packet.evidence.length <= 3);

  const flatSignature = packetSignature(flat.data.packet.evidence);
  const hierarchicalSignature = packetSignature(hierarchical.data.packet.evidence);
  const packetSelectionDiff = comparePacketSelections(
    flat.data.packet.evidence,
    hierarchical.data.packet.evidence
  );

  assert.deepEqual(
    [...flat.data.trace.packetDiff.selectedEvidenceNoteIds].sort(),
    [...flatSignature.selectedNoteIds].sort()
  );
  assert.deepEqual(
    [...hierarchical.data.trace.packetDiff.selectedEvidenceNoteIds].sort(),
    [...hierarchicalSignature.selectedNoteIds].sort()
  );
  assert.equal(
    flat.data.trace.packetDiff.deliveredEvidenceCount,
    flat.data.packet.evidence.length
  );
  assert.equal(
    hierarchical.data.trace.packetDiff.deliveredEvidenceCount,
    hierarchical.data.packet.evidence.length
  );
  assert.ok(packetSelectionDiff.symmetricDifference.length <= 3);
  assert.ok(packetSelectionDiff.sharedNoteIds.length >= 1);
});

async function retrieve(container, input) {
  return container.services.retrieveContextService.retrieveContext({
    actor: actor("retrieval"),
    query: input.query,
    corpusIds: ["context_brain"],
    budget: {
      maxTokens: 600,
      maxSources: 3,
      maxRawExcerpts: 1,
      maxSummarySentences: 4
    },
    strategy: input.strategy,
    includeTrace: true
  });
}

function packetSignature(evidence) {
  const selectedNoteIds = [...new Set(evidence.map((source) => source.noteId))];
  return {
    selectedNoteIds
  };
}

function comparePacketSelections(flatEvidence, hierarchicalEvidence) {
  const flatNoteIds = packetSignature(flatEvidence).selectedNoteIds;
  const hierarchicalNoteIds = packetSignature(hierarchicalEvidence).selectedNoteIds;
  const flatSet = new Set(flatNoteIds);
  const hierarchicalSet = new Set(hierarchicalNoteIds);

  return {
    sharedNoteIds: flatNoteIds.filter((noteId) => hierarchicalSet.has(noteId)),
    symmetricDifference: [
      ...flatNoteIds.filter((noteId) => !hierarchicalSet.has(noteId)),
      ...hierarchicalNoteIds.filter((noteId) => !flatSet.has(noteId))
    ]
  };
}

async function createHarness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-retrieval-strategy-diff-"));
  const container = buildServiceContainer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "retrieval-strategy-diff.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `retrieval_strategy_diff_${randomUUID().slice(0, 8)}`,
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

  return { container };
}

async function createAndPromote(container, input) {
  const draft = await container.services.stagingDraftService.createDraft({
    actor: actor("writer"),
    targetCorpus: "context_brain",
    noteType: input.noteType,
    title: input.title,
    sourcePrompt: `Draft ${input.title}`,
    supportingSources: [],
    bodyHints: input.bodyHints,
    frontmatterOverrides: {
      scope: input.scope
    }
  });

  assert.equal(draft.ok, true);

  const promoted = await container.services.promotionOrchestratorService.promoteDraft({
    actor: actor("orchestrator"),
    draftNoteId: draft.data.draftNoteId,
    targetCorpus: "context_brain",
    promoteAsCurrentState: input.promoteAsCurrentState ?? false
  });

  assert.equal(promoted.ok, true);
  return promoted.data;
}

function actor(role) {
  return {
    actorId: `${role}-actor`,
    actorRole: role,
    transport: "internal",
    source: "test-suite",
    requestId: randomUUID(),
    initiatedAt: new Date().toISOString(),
    toolName: "retrieval-strategy-diff-test"
  };
}
