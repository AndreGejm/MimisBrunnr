import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildServiceContainer } from "../../packages/infrastructure/dist/index.js";

test("session archives are immutable non-authoritative artifacts", async (t) => {
  const { container } = await createHarness(t);

  assert.ok(container.orchestrator.createSessionArchive);

  const result = await container.orchestrator.createSessionArchive({
    actor: actor("operator"),
    sessionId: "session-123",
    messages: [{ role: "user", content: "Summarize writer promotion rules." }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.archive.authorityState, "session");
  assert.equal(result.data.archive.promotionStatus, "not_applicable");
  assert.equal(result.data.archive.messageCount, 1);

  const canonicalNotes = await container.services.canonicalNoteService.listCanonicalNotes(
    "mimisbrunnr"
  );
  assert.equal(canonicalNotes.ok, true);
  assert.equal(canonicalNotes.data.length, 0);

  const stagingDrafts = await container.services.stagingDraftService.listDraftsByCorpus(
    "mimisbrunnr"
  );
  assert.equal(stagingDrafts.length, 0);
});

test("session archive route rejects self-asserted operators and accepts authorized actors", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-session-archives-api-"));
  const { createMimirApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "mimir-api", "dist", "server.js")
    ).href
  );

  const api = createMimirApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "session-archives.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `session_archives_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 0,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: false,
      actorRegistry: [
        {
          actorId: "session-archive-http",
          actorRole: "operator",
          source: "mimir-api",
          allowedTransports: ["http"],
          allowedCommands: ["create_session_archive"],
          authToken: "archive-secret"
        }
      ],
      issuedTokenRequireRegistryMatch: true,
      revokedIssuedTokenIds: []
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();
  const baseUrl = apiBaseUrl(api);

  const unauthorized = await fetch(`${baseUrl}/v1/history/session-archives`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      actor: {
        actorId: "self-asserted-operator",
        actorRole: "operator",
        source: "mimir-api"
      },
      sessionId: "session-unauthorized",
      messages: [{ role: "user", content: "This request should be rejected." }]
    })
  });

  assert.equal(unauthorized.status, 401);
  const unauthorizedPayload = await unauthorized.json();
  assert.equal(unauthorizedPayload.error.code, "unauthorized");

  const authorized = await fetch(`${baseUrl}/v1/history/session-archives`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mimir-actor-token": "archive-secret"
    },
    body: JSON.stringify({
      actor: {
        actorId: "session-archive-http",
        actorRole: "operator",
        source: "mimir-api",
        authToken: "archive-secret"
      },
      sessionId: "session-authorized",
      messages: [{ role: "user", content: "This request should succeed." }]
    })
  });

  assert.equal(authorized.status, 200);
  const authorizedPayload = await authorized.json();
  assert.equal(authorizedPayload.ok, true);
  assert.equal(authorizedPayload.data.archive.authorityState, "session");
  assert.equal(authorizedPayload.data.archive.promotionStatus, "not_applicable");
});

async function createHarness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-session-archives-"));
  const container = buildServiceContainer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "session-archives.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `session_archives_${randomUUID().slice(0, 8)}`,
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
    initiatedAt: "2026-04-06T00:00:00.000Z",
    toolName: "session-archives-test"
  };
}

function apiBaseUrl(api) {
  const address = api.server.address();
  assert.ok(address && typeof address === "object" && typeof address.port === "number");
  return `http://127.0.0.1:${address.port}`;
}
