import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServiceContainer } from "../../packages/infrastructure/dist/index.js";

test("promotion regenerates derived L0 and L1 context representations", async (t) => {
  const { container } = await createHarness(t);
  assert.ok(container.services.contextRepresentationService);

  const draft = await container.services.stagingDraftService.createDraft({
    actor: actor("writer"),
    targetCorpus: "mimisbrunnr",
    noteType: "reference",
    title: "Representation Canonical Node",
    sourcePrompt: "Draft a note that exercises derived representation regeneration.",
    supportingSources: [],
    bodyHints: [
      "The promotion path should regenerate derived representations.",
      "The derived rows must remain non-authoritative."
    ],
    frontmatterOverrides: {
      scope: "representation"
    }
  });

  assert.equal(draft.ok, true);

  const promoted = await container.services.promotionOrchestratorService.promoteDraft({
    actor: actor("orchestrator"),
    draftNoteId: draft.data.draftNoteId,
    targetCorpus: "mimisbrunnr",
    promoteAsCurrentState: false
  });

  assert.equal(promoted.ok, true);

  const canonical = await container.services.canonicalNoteService.getCanonicalNote(
    promoted.data.promotedNoteId
  );
  assert.equal(canonical.ok, true);

  const representations = await container.services.contextRepresentationService.listForNode(
    promoted.data.promotedNoteId
  );

  assert.equal(representations.ok, true);
  assert.equal(representations.data.noteId, promoted.data.promotedNoteId);
  assert.equal(representations.data.representations.L0.layer, "L0");
  assert.equal(representations.data.representations.L1.layer, "L1");
  assert.equal(representations.data.representations.L0.generatedAt.length > 0, true);
  assert.equal(representations.data.representations.L1.generatedAt.length > 0, true);
  assert.match(representations.data.representations.L0.sourceHash, /^[0-9a-f]{64}$/);
  assert.match(representations.data.representations.L1.sourceHash, /^[0-9a-f]{64}$/);
  assert.equal(
    representations.data.representations.L0.content,
    `${canonical.data.frontmatter.title}\n\n${canonical.data.frontmatter.summary ?? ""}`.trim()
  );
  assert.equal(
    representations.data.representations.L1.content,
    `${canonical.data.frontmatter.title}\n\n${canonical.data.frontmatter.summary ?? ""}\n\n${canonical.data.body}`.trim()
  );
});

async function createHarness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-context-representations-"));
  const container = buildServiceContainer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "context-representations.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_representations_${randomUUID().slice(0, 8)}`,
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

function actor(role) {
  return {
    actorId: `${role}-actor`,
    actorRole: role,
    transport: "internal",
    source: "test-suite",
    requestId: randomUUID(),
    initiatedAt: new Date().toISOString(),
    toolName: "context-representations-test"
  };
}
