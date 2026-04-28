import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServiceContainer } from "../../packages/infrastructure/dist/index.js";

test("import-resource rejects self-asserted operators without auth-policy allowance", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-import-pipeline-"));
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
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: false,
      actorRegistry: [
        {
          actorId: "authorized-import-operator",
          actorRole: "operator",
          source: "test-suite",
          allowedTransports: ["internal"],
          allowedCommands: ["import_resource"]
        }
      ]
    }
  });

  t.after(async () => {
    container.dispose?.();
    await rm(root, { recursive: true, force: true });
  });

  await assert.rejects(
    () => container.orchestrator.importResource({
      actor: actor("self-asserted-operator", "operator"),
      sourcePath,
      importKind: "document"
    }),
    (error) => {
      assert.equal(error?.name, "ActorAuthorizationError");
      assert.equal(error?.code, "unauthorized");
      assert.match(String(error?.message ?? ""), /not registered/i);
      return true;
    }
  );
});

test("imports record imported jobs and never create canonical outputs directly", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-import-pipeline-"));
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
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: false,
      actorRegistry: [
        {
          actorId: "authorized-import-operator",
          actorRole: "operator",
          source: "test-suite",
          allowedTransports: ["internal"],
          allowedCommands: ["import_resource"]
        }
      ]
    }
  });

  t.after(async () => {
    container.dispose?.();
    await rm(root, { recursive: true, force: true });
  });

  const result = await container.orchestrator.importResource({
    actor: actor("authorized-import-operator", "operator"),
    sourcePath,
    importKind: "document"
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.importJob.authorityState, "imported");
  assert.equal(result.data.canonicalOutputs.length, 0);
  assert.equal(result.data.draftNoteIds.length, 0);
});

test("import-resource enforces configured source roots without changing allowed imports", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-import-policy-"));
  const allowedRoot = path.join(root, "allowed");
  const blockedRoot = path.join(root, "blocked");
  const allowedSourcePath = path.join(allowedRoot, "allowed-import.md");
  const blockedSourcePath = path.join(blockedRoot, "blocked-import.md");
  await mkdir(allowedRoot, { recursive: true });
  await mkdir(blockedRoot, { recursive: true });
  await writeFile(allowedSourcePath, "# Allowed\n\nThis import is inside policy.", "utf8");
  await writeFile(blockedSourcePath, "# Blocked\n\nThis import is outside policy.", "utf8");

  const container = buildServiceContainer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "import-policy.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `import_policy_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    importAllowedRoots: [allowedRoot],
    apiHost: "127.0.0.1",
    apiPort: 8080,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: false,
      actorRegistry: [
        {
          actorId: "authorized-import-operator",
          actorRole: "operator",
          source: "test-suite",
          allowedTransports: ["internal"],
          allowedCommands: ["import_resource"]
        }
      ]
    }
  });

  t.after(async () => {
    container.dispose?.();
    await rm(root, { recursive: true, force: true });
  });

  const allowed = await container.orchestrator.importResource({
    actor: actor("authorized-import-operator", "operator"),
    sourcePath: allowedSourcePath,
    importKind: "document"
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.data.importJob.sourcePath, path.resolve(allowedSourcePath));

  const blocked = await container.orchestrator.importResource({
    actor: actor("authorized-import-operator", "operator"),
    sourcePath: blockedSourcePath,
    importKind: "document"
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "forbidden");
  assert.match(blocked.error.message, /outside configured import roots/i);
});

function actor(actorId, role) {
  return {
    actorId,
    actorRole: role,
    transport: "internal",
    source: "test-suite",
    requestId: randomUUID(),
    initiatedAt: new Date().toISOString(),
    toolName: "import-pipeline-test"
  };
}
