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

test("hierarchical retrieval is opt-in and preserves bounded packet guarantees", async (t) => {
  const { container } = await createHarness(t);

  await createCanonicalNote(container);
  await createStagingDraft(container);

  const validated = validateTransportRequest("search-context", {
    query: "Hierarchical Retrieval Canonical Node",
    corpusIds: ["mimisbrunnr"],
    budget: {
      maxTokens: 1200,
      maxSources: 3,
      maxRawExcerpts: 2,
      maxSummarySentences: 6
    },
    strategy: "hierarchical"
  });
  assert.equal(validated.strategy, "hierarchical");

  const flatResult = await container.services.retrieveContextService.retrieveContext({
    actor: actor("retrieval"),
    query: "Hierarchical Retrieval Canonical Node",
    corpusIds: ["mimisbrunnr"],
    budget: {
      maxTokens: 1200,
      maxSources: 3,
      maxRawExcerpts: 2,
      maxSummarySentences: 6
    },
    includeTrace: true
  });

  assert.equal(flatResult.ok, true);
  assert.equal(flatResult.data.trace.strategy, "flat");

  const hierarchicalResult = await container.services.retrieveContextService.retrieveContext({
    actor: actor("retrieval"),
    query: "Hierarchical Retrieval Canonical Node",
    corpusIds: ["mimisbrunnr"],
    budget: {
      maxTokens: 1200,
      maxSources: 3,
      maxRawExcerpts: 2,
      maxSummarySentences: 6
    },
    strategy: "hierarchical",
    includeTrace: true
  });

  assert.equal(hierarchicalResult.ok, true);
  assert.equal(hierarchicalResult.data.trace.strategy, "hierarchical");
  assert.ok(hierarchicalResult.data.retrievalHealth);
  assert.match(hierarchicalResult.data.retrievalHealth.status, /healthy|degraded|unhealthy/);
  assert.equal(typeof hierarchicalResult.data.retrievalHealth.deliveredCandidates, "number");
  assert.ok(hierarchicalResult.data.packet.evidence.length <= 3);
  assert.ok(Array.isArray(hierarchicalResult.data.trace.events));
  assert.ok(hierarchicalResult.data.trace.events.length > 0);
});

async function createHarness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-hierarchical-retrieval-"));
  const container = buildServiceContainer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "hierarchical-retrieval.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `hierarchical_retrieval_${randomUUID().slice(0, 8)}`,
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
    corpusId: "mimisbrunnr",
    notePath: "mimisbrunnr/hierarchy/canonical-node.md",
    revision: "",
    frontmatter: {
      noteId,
      title: "Hierarchical Retrieval Canonical Node",
      project: "mimir",
      type: "reference",
      status: "promoted",
      updated: currentDateIso(),
      summary: "Canonical note for hierarchical retrieval coverage.",
      tags: ["project/mimir", "domain/retrieval", "status/promoted"],
      scope: "hierarchy",
      corpusId: "mimisbrunnr",
      currentState: true
    },
    body: [
      "## Summary",
      "",
      "Canonical note for hierarchical retrieval coverage.",
      "",
      "## Details",
      "",
      "This note exists to exercise hierarchical retrieval output.",
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
    targetCorpus: "mimisbrunnr",
    noteType: "reference",
    title: "Hierarchical Retrieval Staging Node",
    sourcePrompt: "Draft a staging node for hierarchical retrieval coverage.",
    supportingSources: [],
    bodyHints: [
      "This staging draft should remain distinct from the canonical note.",
      "The hierarchical branch must stay bounded."
    ],
    frontmatterOverrides: {
      scope: "hierarchy"
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
    toolName: "hierarchical-retrieval-test"
  };
}

function currentDateIso() {
  return new Date().toISOString().slice(0, 10);
}
