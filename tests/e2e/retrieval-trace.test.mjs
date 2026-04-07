import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServiceContainer } from "../../packages/infrastructure/dist/index.js";

test("retrieve context can emit a bounded trace and packet diff metadata", async (t) => {
  const { container } = await createHarness(t);

  await createCanonicalNote(container);
  await createStagingDraft(container);

  const result = await container.services.retrieveContextService.retrieveContext({
    actor: actor("retrieval"),
    query: "Retrieval Trace Canonical Node",
    corpusIds: ["context_brain"],
    budget: {
      maxTokens: 1200,
      maxSources: 4,
      maxRawExcerpts: 2,
      maxSummarySentences: 6
    },
    includeTrace: true
  });

  assert.equal(result.ok, true);
  assert.ok(result.data.trace);
  assert.equal(result.data.trace.strategy, "flat");
  assert.ok(Array.isArray(result.data.trace.events));
  assert.ok(result.data.trace.events.length > 0);
  assert.ok(result.data.trace.candidateCounts);
  assert.equal(typeof result.data.trace.candidateCounts.lexical, "number");
  assert.equal(
    result.data.trace.packetDiff.deliveredEvidenceCount,
    result.data.packet.evidence.length
  );
  assert.ok(Array.isArray(result.data.trace.packetDiff.selectedEvidenceNoteIds));
  assert.equal(
    result.data.trace.packetDiff.droppedCandidateCount +
      result.data.trace.packetDiff.expandedEvidenceCount,
    Math.abs(result.data.trace.candidateCounts.reranked - result.data.packet.evidence.length)
  );
});

async function createHarness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-retrieval-trace-"));
  const container = buildServiceContainer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "retrieval-trace.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `retrieval_trace_${randomUUID().slice(0, 8)}`,
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

async function createCanonicalNote(container) {
  const noteId = randomUUID();
  const result = await container.services.canonicalNoteService.writeCanonicalNote({
    noteId,
    corpusId: "context_brain",
    notePath: "context_brain/trace/canonical-node.md",
    revision: "",
    frontmatter: {
      noteId,
      title: "Retrieval Trace Canonical Node",
      project: "multi-agent-brain",
      type: "reference",
      status: "promoted",
      updated: currentDateIso(),
      summary: "Canonical trace node for retrieval trace coverage.",
      tags: ["project/multi-agent-brain", "domain/retrieval", "status/promoted"],
      scope: "trace",
      corpusId: "context_brain",
      currentState: true
    },
    body: [
      "## Summary",
      "",
      "Canonical trace node for retrieval trace coverage.",
      "",
      "## Details",
      "",
      "This note exists to exercise retrieval trace output.",
      "",
      "## Sources",
      "",
      "- none"
    ].join("\n")
  });

  assert.equal(result.ok, true);
  return result.data;
}

async function createStagingDraft(container) {
  const result = await container.services.stagingDraftService.createDraft({
    actor: actor("writer"),
    targetCorpus: "context_brain",
    noteType: "reference",
    title: "Retrieval Trace Staging Node",
    sourcePrompt: "Draft a staging node for retrieval trace coverage.",
    supportingSources: [],
    bodyHints: [
      "This staging draft should remain distinct from the canonical note.",
      "Trace metadata must preserve the current retrieval semantics."
    ],
    frontmatterOverrides: {
      scope: "trace"
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
    initiatedAt: new Date().toISOString(),
    toolName: "retrieval-trace-test"
  };
}

function currentDateIso() {
  return new Date().toISOString().slice(0, 10);
}
