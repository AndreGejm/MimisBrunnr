import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServiceContainer } from "../../packages/infrastructure/dist/index.js";

test("imports record imported jobs and never create canonical outputs directly", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-import-pipeline-"));
  const sourcePath = path.join(root, "sample-import.md");
  await writeFile(
    sourcePath,
    [
      "# Imported Note",
      "",
      "This note should remain an imported artifact.",
      "",
      "## Details",
      "",
      "The import pipeline must not canonicalize this content."
    ].join("\n"),
    "utf8"
  );

  const container = buildServiceContainer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "import-pipeline.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `import_pipeline_${randomUUID().slice(0, 8)}`,
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

  assert.ok(container.services.importOrchestrationService);

  const result = await container.services.importOrchestrationService.importResource({
    actor: actor("operator"),
    sourcePath,
    importKind: "document"
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.importJob.authorityState, "imported");
  assert.equal(result.data.canonicalOutputs.length, 0);
  assert.equal(result.data.draftNoteIds.length, 0);
});

function actor(role) {
  return {
    actorId: `${role}-actor`,
    actorRole: role,
    transport: "internal",
    source: "test-suite",
    requestId: randomUUID(),
    initiatedAt: new Date().toISOString(),
    toolName: "import-pipeline-test"
  };
}
