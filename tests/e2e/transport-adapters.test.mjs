import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir as fsMkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

test("brain-cli exposes shared release metadata through the version command", async () => {
  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "brain-cli", "dist", "main.js"),
    ["version"],
    {
      ...process.env,
      MAB_RELEASE_VERSION: "0.2.0",
      MAB_GIT_TAG: "v0.2.0",
      MAB_GIT_COMMIT: "0123456789abcdef",
      MAB_RELEASE_CHANNEL: "tagged"
    }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.release.version, "0.2.0");
  assert.equal(payload.release.gitTag, "v0.2.0");
  assert.equal(payload.release.gitCommit, "0123456789abcdef");
  assert.equal(payload.release.releaseChannel, "tagged");
});

test("brain-cli exposes auth registry status for operators", async () => {
  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "brain-cli", "dist", "main.js"),
    ["auth-status"],
    {
      ...process.env,
      MAB_AUTH_MODE: "enforced",
      MAB_AUTH_ISSUER_SECRET: "cli-issuer-secret",
      MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
        {
          actorId: "operator-cli",
          actorRole: "operator",
          source: "brain-cli",
          allowedTransports: ["cli"],
          allowedCommands: ["query_history"],
          authTokens: [
            {
              token: "current-operator-token",
              validUntil: new Date(Date.now() + 3_600_000).toISOString()
            }
          ]
        }
      ])
    }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.auth.mode, "enforced");
  assert.equal(payload.auth.issuedTokenSupport.enabled, true);
  assert.equal(payload.auth.actorCounts.total, 1);
});

test("brain-cli can introspect issued actor tokens against the current auth policy", async () => {
  const { issueActorAccessToken } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );

  const issuedToken = issueActorAccessToken(
    {
      actorId: "validate-note-http",
      actorRole: "orchestrator",
      source: "brain-api",
      allowedTransports: ["http"],
      allowedCommands: ["validate_note"],
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      issuedAt: new Date().toISOString()
    },
    "cli-issuer-secret"
  );

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "brain-cli", "dist", "main.js"),
    [
      "auth-introspect-token",
      "--json",
      JSON.stringify({
        token: issuedToken,
        expectedTransport: "http",
        expectedCommand: "validate_note"
      })
    ],
    {
      ...process.env,
      MAB_AUTH_MODE: "enforced",
      MAB_AUTH_ISSUER_SECRET: "cli-issuer-secret",
      MAB_AUTH_ACTOR_REGISTRY_JSON: JSON.stringify([
        {
          actorId: "validate-note-http",
          actorRole: "orchestrator",
          source: "brain-api",
          allowedTransports: ["http"],
          allowedCommands: ["validate_note"]
        }
      ])
    }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.inspection.tokenKind, "issued");
  assert.equal(payload.inspection.valid, true);
  assert.equal(payload.inspection.authorization.transportAllowed, true);
  assert.equal(payload.inspection.authorization.commandAllowed, true);
  assert.equal(payload.inspection.matchedActor.actorId, "validate-note-http");
});

test("brain-cli exposes temporal freshness status and refresh candidates for operators", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-cli-freshness-"));
  const sqlitePath = path.join(root, "state", "multi-agent-brain.sqlite");
  await seedTemporalValidityNote(sqlitePath, {
    noteId: "expired-cli-freshness-note",
    notePath: "context_brain/reference/expired-cli-freshness-note.md",
    validFrom: "2026-03-01",
    validUntil: addDaysIso(currentDateIso(), -1),
    summary: "CLI freshness status should show expired refresh candidates."
  });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "brain-cli", "dist", "main.js"),
    ["freshness-status"],
    cliEnvironment(root)
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.freshness.expiredCurrentStateNotes, 1);
  assert.equal(payload.freshness.expiredCurrentState[0].noteId, "expired-cli-freshness-note");
  assert.equal(payload.freshness.expiredCurrentState[0].state, "expired");
});

test("brain-cli creates governed refresh drafts for expired current-state notes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-cli-refresh-draft-"));
  const seeded = await seedCanonicalTemporalNote(root, {
    title: "CLI Refresh Workflow",
    scope: "cli-refresh-workflow",
    validFrom: addDaysIso(currentDateIso(), -14),
    validUntil: addDaysIso(currentDateIso(), -1)
  });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "brain-cli", "dist", "main.js"),
    [
      "create-refresh-draft",
      "--json",
      JSON.stringify({
        noteId: seeded.noteId,
        bodyHints: ["Refresh the expired CLI guidance."]
      })
    ],
    cliEnvironment(root)
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.sourceNoteId, seeded.noteId);
  assert.equal(payload.data.sourceState, "expired");
  assert.deepEqual(payload.data.frontmatter.supersedes, [seeded.noteId]);
});

test("brain-cli can mint issued actor access tokens when the issuer secret is configured", async () => {
  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "brain-cli", "dist", "main.js"),
    [
      "issue-auth-token",
      "--json",
      JSON.stringify({
        actorId: "validate-note-http",
        actorRole: "orchestrator",
        source: "brain-api",
        allowedTransports: ["http"],
        allowedCommands: ["validate_note"],
        ttlMinutes: 60
      })
    ],
    {
      ...process.env,
      MAB_AUTH_ISSUER_SECRET: "cli-issuer-secret"
    }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.match(payload.issuedToken, /^mab1\./);
  assert.equal(payload.claims.actorId, "validate-note-http");
});

test("brain-cli drafts notes through the staging service with JSON input", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-cli-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const requestPath = path.join(root, "draft-note.json");
  await writeFile(
    requestPath,
    JSON.stringify({
      targetCorpus: "context_brain",
      noteType: "decision",
      title: "CLI Draft Policy",
      sourcePrompt: "Draft a CLI policy note.",
      supportingSources: [],
      bodyHints: ["CLI transport should remain thin."]
    }),
    "utf8"
  );

  const result = await runNodeCommand(
    path.join(
      process.cwd(),
      "apps",
      "brain-cli",
      "dist",
      "main.js"
    ),
    ["draft-note", "--input", requestPath],
    cliEnvironment(root)
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.frontmatter.corpusId, "context_brain");
  assert.match(payload.data.draftPath, /^context_brain\//);
});

test("brain-cli exposes direct context-packet assembly as a thin transport command", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-cli-packet-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const requestPath = path.join(root, "context-packet.json");
  await writeFile(
    requestPath,
    JSON.stringify({
      intent: "architecture_recall",
      budget: {
        maxTokens: 320,
        maxSources: 2,
        maxRawExcerpts: 1,
        maxSummarySentences: 2
      },
      includeRawExcerpts: true,
      candidates: [
        {
          noteType: "architecture",
          score: 0.84,
          summary: "Architecture context for bounded retrieval packets.",
          rawText: "Architecture context for bounded retrieval packets with provenance attached.",
          scope: "architecture",
          qualifiers: ["bounded retrieval"],
          tags: ["project/multi-agent-brain"],
          stalenessClass: "current",
          provenance: {
            noteId: "note-1",
            notePath: "context_brain/architecture/retrieval.md",
            headingPath: ["Summary"]
          }
        }
      ]
    }),
    "utf8"
  );

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "brain-cli", "dist", "main.js"),
    ["get-context-packet", "--input", requestPath],
    cliEnvironment(root)
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.packet.packetType, "implementation");
  assert.equal(payload.packet.answerability, "local_answer");
  assert.equal(payload.packet.evidence[0].noteId, "note-1");
});

test("brain-cli rejects malformed request payloads at ingress", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-cli-invalid-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const requestPath = path.join(root, "invalid-context-packet.json");
  await writeFile(
    requestPath,
    JSON.stringify({
      intent: "architecture_recall",
      budget: {
        maxTokens: "320",
        maxSources: 2,
        maxRawExcerpts: 1,
        maxSummarySentences: 2
      },
      includeRawExcerpts: true,
      candidates: []
    }),
    "utf8"
  );

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "brain-cli", "dist", "main.js"),
    ["get-context-packet", "--input", requestPath],
    cliEnvironment(root)
  );

  assert.equal(result.exitCode, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "validation_failed");
});

test("brain-cli executes coding tasks through the vendored runtime bridge", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-cli-coding-"));
  const repoRoot = path.join(root, "repo");
  await fsMkdir(path.join(repoRoot, ".git"), { recursive: true });
  await fsMkdir(path.join(repoRoot, "src"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "src", "foo.py"),
    'def greet(name: str) -> str:\n    return f"Hello, {name}"\n',
    "utf8"
  );
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const requestPath = path.join(root, "coding-task.json");
  await writeFile(
    requestPath,
    JSON.stringify({
      taskType: "propose_fix",
      task: "Fix the writer promotion bug.",
      context: "The bug affects writer promotion.",
      filePath: "src/foo.py"
    }),
    "utf8"
  );

  const result = await runNodeCommand(
    path.join(process.cwd(), "apps", "brain-cli", "dist", "main.js"),
    ["execute-coding-task", "--input", requestPath],
    cliEnvironment(root, {
      MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL: "http://127.0.0.1:1",
      MAB_OLLAMA_BASE_URL: "http://127.0.0.1:1"
    }),
    repoRoot
  );

  assert.equal(result.exitCode, 1, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "fail");
  assert.doesNotMatch(payload.reason, /allowed_patch_root|LOCAL_EXPERT_REPO_ROOT/i);
});

test("brain-api exposes validation as a thin HTTP transport over services", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-"));
  const { createBrainApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")
    ).href
  );

  const api = createBrainApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 18181,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const liveResponse = await fetch("http://127.0.0.1:18181/health/live");
  assert.equal(liveResponse.status, 200);
  const livePayload = await liveResponse.json();
  assert.equal(livePayload.mode, "live");
  assert.ok(["pass", "degraded"].includes(livePayload.status));
  assert.equal(typeof livePayload.release.version, "string");

  const noteId = randomUUID();
  const response = await fetch("http://127.0.0.1:18181/v1/notes/validate", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      targetCorpus: "context_brain",
      notePath: "context_brain/decision/invalid-http-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId,
        title: "Invalid HTTP Decision",
        project: "multi-agent-brain",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "Missing required sections.",
        tags: ["project/multi-agent-brain", "domain/orchestration", "status/promoted"],
        scope: "validation",
        corpusId: "context_brain",
        currentState: false
      },
      body: "## Context\n\nOnly one section exists."
    })
  });

  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.valid, false);
  assert.ok(payload.violations.some((issue) => issue.field === "body.sections"));
});

test("brain-api exposes shared release metadata through the system version route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-version-"));
  const { createBrainApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")
    ).href
  );
  const { loadEnvironment } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );

  const api = createBrainApiServer(
    loadEnvironment({
      ...process.env,
      MAB_NODE_ENV: "test",
      MAB_RELEASE_VERSION: "0.3.0",
      MAB_GIT_TAG: "v0.3.0",
      MAB_GIT_COMMIT: "abcdef0123456789",
      MAB_RELEASE_CHANNEL: "tagged",
      MAB_VAULT_ROOT: path.join(root, "vault", "canonical"),
      MAB_STAGING_ROOT: path.join(root, "vault", "staging"),
      MAB_SQLITE_PATH: path.join(root, "state", "multi-agent-brain.sqlite"),
      MAB_QDRANT_URL: "http://127.0.0.1:6333",
      MAB_QDRANT_COLLECTION: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
      MAB_EMBEDDING_PROVIDER: "hash",
      MAB_REASONING_PROVIDER: "heuristic",
      MAB_DRAFTING_PROVIDER: "disabled",
      MAB_RERANKER_PROVIDER: "local",
      MAB_API_HOST: "127.0.0.1",
      MAB_API_PORT: "18187",
      MAB_LOG_LEVEL: "error"
    })
  );

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const response = await fetch("http://127.0.0.1:18187/v1/system/version");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.release.version, "0.3.0");
  assert.equal(payload.release.gitTag, "v0.3.0");
  assert.equal(payload.release.gitCommit, "abcdef0123456789");
  assert.equal(payload.release.releaseChannel, "tagged");
});

test("brain-api exposes auth registry status through the system auth route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-auth-status-"));
  const { createBrainApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")
    ).href
  );

  const api = createBrainApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 18188,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: true,
      actorRegistry: [
        {
          actorId: "operator-http",
          actorRole: "operator",
          authToken: "operator-http-secret",
          source: "brain-api-admin",
          allowedTransports: ["http"],
          allowedAdminActions: ["view_auth_status"]
        }
      ],
      issuerSecret: "api-issuer-secret",
      issuedTokenRequireRegistryMatch: true
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const unauthorized = await fetch("http://127.0.0.1:18188/v1/system/auth");
  assert.equal(unauthorized.status, 401);

  const response = await fetch("http://127.0.0.1:18188/v1/system/auth", {
    headers: {
      "x-brain-actor-id": "operator-http",
      "x-brain-actor-role": "operator",
      "x-brain-source": "brain-api-admin",
      "x-brain-actor-token": "operator-http-secret"
    }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.auth.mode, "enforced");
  assert.equal(payload.auth.issuedTokenSupport.enabled, true);
  assert.equal(payload.auth.actorCounts.total, 1);
});

test("brain-api can issue short-lived actor tokens through the protected auth route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-issue-token-"));
  const { createBrainApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")
    ).href
  );

  const api = createBrainApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 18192,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: true,
      actorRegistry: [
        {
          actorId: "operator-http",
          actorRole: "operator",
          authToken: "operator-http-secret",
          source: "brain-api-admin",
          allowedTransports: ["http"],
          allowedAdminActions: ["issue_auth_token", "inspect_auth_token"]
        },
        {
          actorId: "validate-note-http",
          actorRole: "orchestrator",
          source: "brain-api",
          allowedTransports: ["http"],
          allowedCommands: ["validate_note"]
        }
      ],
      issuerSecret: "api-issuer-secret",
      issuedTokenRequireRegistryMatch: true
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const response = await fetch("http://127.0.0.1:18192/v1/system/auth/issue-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-brain-actor-id": "operator-http",
      "x-brain-actor-role": "operator",
      "x-brain-source": "brain-api-admin",
      "x-brain-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      actorId: "validate-note-http",
      actorRole: "orchestrator",
      source: "brain-api",
      allowedTransports: ["http"],
      allowedCommands: ["validate_note"],
      ttlMinutes: 60
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.match(payload.issuedToken, /^mab1\./);
  assert.equal(payload.claims.actorId, "validate-note-http");
});

test("brain-api can introspect actor tokens through the protected auth route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-introspect-token-"));
  const { createBrainApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")
    ).href
  );

  const api = createBrainApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 18193,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: true,
      actorRegistry: [
        {
          actorId: "operator-http",
          actorRole: "operator",
          authToken: "operator-http-secret",
          source: "brain-api-admin",
          allowedTransports: ["http"],
          allowedAdminActions: ["issue_auth_token", "inspect_auth_token"]
        },
        {
          actorId: "validate-note-http",
          actorRole: "orchestrator",
          source: "brain-api",
          allowedTransports: ["http"],
          allowedCommands: ["validate_note"]
        }
      ],
      issuerSecret: "api-issuer-secret",
      issuedTokenRequireRegistryMatch: true
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const issueResponse = await fetch("http://127.0.0.1:18193/v1/system/auth/issue-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-brain-actor-id": "operator-http",
      "x-brain-actor-role": "operator",
      "x-brain-source": "brain-api-admin",
      "x-brain-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      actorId: "validate-note-http",
      actorRole: "orchestrator",
      source: "brain-api",
      allowedTransports: ["http"],
      allowedCommands: ["validate_note"],
      ttlMinutes: 60
    })
  });

  assert.equal(issueResponse.status, 200);
  const issuedPayload = await issueResponse.json();

  const response = await fetch("http://127.0.0.1:18193/v1/system/auth/introspect-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-brain-actor-id": "operator-http",
      "x-brain-actor-role": "operator",
      "x-brain-source": "brain-api-admin",
      "x-brain-actor-token": "operator-http-secret"
    },
    body: JSON.stringify({
      token: issuedPayload.issuedToken,
      expectedTransport: "http",
      expectedCommand: "validate_note"
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.inspection.tokenKind, "issued");
  assert.equal(payload.inspection.valid, true);
  assert.equal(payload.inspection.authorization.transportAllowed, true);
  assert.equal(payload.inspection.authorization.commandAllowed, true);
  assert.equal(payload.inspection.matchedActor.actorId, "validate-note-http");
});

test("brain-api exposes temporal freshness reports through the system freshness route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-freshness-"));
  const sqlitePath = path.join(root, "state", "multi-agent-brain.sqlite");
  await seedTemporalValidityNote(sqlitePath, {
    noteId: "expiring-api-freshness-note",
    notePath: "context_brain/reference/expiring-api-freshness-note.md",
    validFrom: addDaysIso(currentDateIso(), -7),
    validUntil: addDaysIso(currentDateIso(), 3),
    summary: "API freshness route should show expiring refresh candidates."
  });

  const { createBrainApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")
    ).href
  );

  const api = createBrainApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath,
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 18190,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const response = await fetch(
    "http://127.0.0.1:18190/v1/system/freshness?expiringWithinDays=7&limitPerCategory=5"
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.freshness.expiringSoonCurrentStateNotes, 1);
  assert.equal(payload.freshness.limitPerCategory, 5);
  assert.equal(
    payload.freshness.expiringSoonCurrentState[0].noteId,
    "expiring-api-freshness-note"
  );
  assert.equal(payload.freshness.expiringSoonCurrentState[0].state, "expiring_soon");
});

test("brain-api creates governed refresh drafts through the temporal freshness route", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-refresh-draft-"));
  const seeded = await seedCanonicalTemporalNote(root, {
    title: "API Refresh Workflow",
    scope: "api-refresh-workflow",
    validFrom: addDaysIso(currentDateIso(), -30),
    validUntil: addDaysIso(currentDateIso(), -1)
  });

  const { createBrainApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")
    ).href
  );

  const api = createBrainApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 18191,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const response = await fetch(
    "http://127.0.0.1:18191/v1/system/freshness/refresh-draft",
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        noteId: seeded.noteId,
        bodyHints: ["Refresh the expired API guidance."]
      })
    }
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.sourceNoteId, seeded.noteId);
  assert.equal(payload.data.sourceState, "expired");
  assert.deepEqual(payload.data.frontmatter.supersedes, [seeded.noteId]);
});

test("brain-api exposes direct context-packet assembly over HTTP", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-packet-"));
  const { createBrainApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")
    ).href
  );

  const api = createBrainApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 18183,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const response = await fetch("http://127.0.0.1:18183/v1/context/packet", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      intent: "architecture_recall",
      budget: {
        maxTokens: 320,
        maxSources: 2,
        maxRawExcerpts: 1,
        maxSummarySentences: 2
      },
      includeRawExcerpts: false,
      candidates: [
        {
          noteType: "architecture",
          score: 0.84,
          summary: "HTTP route can assemble a bounded packet directly.",
          scope: "architecture",
          qualifiers: ["bounded retrieval"],
          tags: ["project/multi-agent-brain"],
          stalenessClass: "current",
          provenance: {
            noteId: "note-http-1",
            notePath: "context_brain/architecture/http-packet.md",
            headingPath: ["Summary"]
          }
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.packet.packetType, "implementation");
  assert.equal(payload.packet.evidence[0].noteId, "note-http-1");
});

test("brain-api rejects malformed request payloads at ingress", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-invalid-"));
  const { createBrainApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")
    ).href
  );

  const api = createBrainApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 18185,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const response = await fetch("http://127.0.0.1:18185/v1/context/search", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query: "invalid budget",
      corpusIds: ["context_brain"],
      budget: {
        maxTokens: "320",
        maxSources: 2,
        maxRawExcerpts: 1,
        maxSummarySentences: 2
      }
    })
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "validation_failed");
});

test("brain-api enforces registered actor tokens when auth mode is enforced", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-auth-"));
  const { createBrainApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")
    ).href
  );

  const api = createBrainApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 18184,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: true,
      actorRegistry: [
        {
          actorId: "validate-note-http",
          actorRole: "orchestrator",
          authToken: "http-secret",
          source: "brain-api",
          allowedTransports: ["http"],
          allowedCommands: ["validate_note"]
        }
      ]
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const unauthenticated = await fetch("http://127.0.0.1:18184/v1/notes/validate", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      targetCorpus: "context_brain",
      notePath: "context_brain/decision/auth-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId: randomUUID(),
        title: "Auth Note",
        project: "multi-agent-brain",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "Should require a token.",
        tags: ["project/multi-agent-brain", "domain/orchestration", "status/promoted"],
        scope: "auth",
        corpusId: "context_brain",
        currentState: false
      },
      body: [
        "## Context",
        "",
        "Auth context.",
        "",
        "## Decision",
        "",
        "Auth decision.",
        "",
        "## Rationale",
        "",
        "Auth rationale.",
        "",
        "## Consequences",
        "",
        "Auth consequences."
      ].join("\n")
    })
  });

  assert.equal(unauthenticated.status, 401);
  const unauthenticatedPayload = await unauthenticated.json();
  assert.equal(unauthenticatedPayload.error.code, "unauthorized");

  const authenticated = await fetch("http://127.0.0.1:18184/v1/notes/validate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-brain-actor-token": "http-secret"
    },
    body: JSON.stringify({
      actor: {
        actorId: "validate-note-http",
        actorRole: "orchestrator",
        source: "brain-api",
        authToken: "http-secret"
      },
      targetCorpus: "context_brain",
      notePath: "context_brain/decision/auth-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId: randomUUID(),
        title: "Auth Note",
        project: "multi-agent-brain",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "Should validate once authenticated.",
        tags: ["project/multi-agent-brain", "domain/orchestration", "status/promoted"],
        scope: "auth",
        corpusId: "context_brain",
        currentState: false
      },
      body: [
        "## Context",
        "",
        "Auth context.",
        "",
        "## Decision",
        "",
        "Auth decision.",
        "",
        "## Rationale",
        "",
        "Auth rationale.",
        "",
        "## Consequences",
        "",
        "Auth consequences."
      ].join("\n")
    })
  });

  assert.equal(authenticated.status, 200);
  const authenticatedPayload = await authenticated.json();
  assert.equal(authenticatedPayload.valid, true);
});

test("brain-api loads a file-backed actor registry and honors rotated credential windows", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-auth-file-"));
  const registryPath = path.join(root, "config", "actor-registry.json");
  await fsMkdir(path.dirname(registryPath), { recursive: true });
  const now = Date.now();
  await writeFile(
    registryPath,
    JSON.stringify(
      {
        actors: [
          {
            actorId: "validate-note-http",
            actorRole: "orchestrator",
            authTokens: [
              {
                token: "expired-http-secret",
                label: "previous",
                validUntil: new Date(now - 60_000).toISOString()
              },
              {
                token: "current-http-secret",
                label: "current",
                validFrom: new Date(now - 60_000).toISOString(),
                validUntil: new Date(now + 3_600_000).toISOString()
              }
            ],
            source: "brain-api",
            allowedTransports: ["http"],
            allowedCommands: ["validate_note"]
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const { createBrainApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")
    ).href
  );
  const { loadEnvironment } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );

  const api = createBrainApiServer(
    loadEnvironment({
      ...process.env,
      MAB_NODE_ENV: "test",
      MAB_VAULT_ROOT: path.join(root, "vault", "canonical"),
      MAB_STAGING_ROOT: path.join(root, "vault", "staging"),
      MAB_SQLITE_PATH: path.join(root, "state", "multi-agent-brain.sqlite"),
      MAB_QDRANT_URL: "http://127.0.0.1:6333",
      MAB_QDRANT_COLLECTION: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
      MAB_EMBEDDING_PROVIDER: "hash",
      MAB_REASONING_PROVIDER: "heuristic",
      MAB_DRAFTING_PROVIDER: "disabled",
      MAB_RERANKER_PROVIDER: "local",
      MAB_API_HOST: "127.0.0.1",
      MAB_API_PORT: "18186",
      MAB_LOG_LEVEL: "error",
      MAB_AUTH_MODE: "enforced",
      MAB_AUTH_ACTOR_REGISTRY_PATH: registryPath
    })
  );

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const expired = await fetch("http://127.0.0.1:18186/v1/notes/validate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-brain-actor-token": "expired-http-secret"
    },
    body: JSON.stringify({
      targetCorpus: "context_brain",
      notePath: "context_brain/decision/auth-file-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId: randomUUID(),
        title: "Auth File Note",
        project: "multi-agent-brain",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "File-backed auth should reject expired credentials.",
        tags: ["project/multi-agent-brain", "domain/orchestration", "status/promoted"],
        scope: "auth",
        corpusId: "context_brain",
        currentState: false
      },
      body: [
        "## Context",
        "",
        "Auth context.",
        "",
        "## Decision",
        "",
        "Auth decision.",
        "",
        "## Rationale",
        "",
        "Auth rationale.",
        "",
        "## Consequences",
        "",
        "Auth consequences."
      ].join("\n")
    })
  });

  assert.equal(expired.status, 401);
  const expiredPayload = await expired.json();
  assert.equal(expiredPayload.error.code, "unauthorized");
  assert.match(expiredPayload.error.message, /expired|inactive/i);

  const current = await fetch("http://127.0.0.1:18186/v1/notes/validate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-brain-actor-token": "current-http-secret"
    },
    body: JSON.stringify({
      targetCorpus: "context_brain",
      notePath: "context_brain/decision/auth-file-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId: randomUUID(),
        title: "Auth File Note",
        project: "multi-agent-brain",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "File-backed auth should accept active credentials.",
        tags: ["project/multi-agent-brain", "domain/orchestration", "status/promoted"],
        scope: "auth",
        corpusId: "context_brain",
        currentState: false
      },
      body: [
        "## Context",
        "",
        "Auth context.",
        "",
        "## Decision",
        "",
        "Auth decision.",
        "",
        "## Rationale",
        "",
        "Auth rationale.",
        "",
        "## Consequences",
        "",
        "Auth consequences."
      ].join("\n")
    })
  });

  assert.equal(current.status, 200);
  const currentPayload = await current.json();
  assert.equal(currentPayload.valid, true);
});

test("brain-api accepts centrally issued actor tokens for registered actors", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-issued-token-"));
  const { createBrainApiServer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")
    ).href
  );
  const { issueActorAccessToken } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );

  const issuerSecret = "issued-token-secret";
  const api = createBrainApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    apiHost: "127.0.0.1",
    apiPort: 18189,
    logLevel: "error",
    auth: {
      mode: "enforced",
      allowAnonymousInternal: true,
      actorRegistry: [
        {
          actorId: "validate-note-http",
          actorRole: "orchestrator",
          source: "brain-api",
          allowedTransports: ["http"],
          allowedCommands: ["validate_note"]
        }
      ],
      issuerSecret,
      issuedTokenRequireRegistryMatch: true
    }
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const issuedToken = issueActorAccessToken(
    {
      actorId: "validate-note-http",
      actorRole: "orchestrator",
      source: "brain-api",
      allowedTransports: ["http"],
      allowedCommands: ["validate_note"],
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      issuedAt: new Date().toISOString()
    },
    issuerSecret
  );

  const response = await fetch("http://127.0.0.1:18189/v1/notes/validate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-brain-actor-token": issuedToken
    },
    body: JSON.stringify({
      actor: {
        actorId: "validate-note-http",
        actorRole: "orchestrator",
        source: "brain-api",
        authToken: issuedToken
      },
      targetCorpus: "context_brain",
      notePath: "context_brain/decision/issued-token-note.md",
      validationMode: "promotion",
      frontmatter: {
        noteId: randomUUID(),
        title: "Issued Token Note",
        project: "multi-agent-brain",
        type: "decision",
        status: "promoted",
        updated: currentDateIso(),
        summary: "Issued tokens should work for registered operators.",
        tags: ["project/multi-agent-brain", "domain/orchestration", "status/promoted"],
        scope: "auth",
        corpusId: "context_brain",
        currentState: false
      },
      body: [
        "## Context",
        "",
        "Issued-token auth context.",
        "",
        "## Decision",
        "",
        "Issued-token auth decision.",
        "",
        "## Rationale",
        "",
        "Issued-token auth rationale.",
        "",
        "## Consequences",
        "",
        "Issued-token auth consequences."
      ].join("\n")
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.valid, true);
});

test("brain-api exposes coding execution through the root orchestrator", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-api-coding-"));
  const repoRoot = path.join(root, "repo");
  await fsMkdir(path.join(repoRoot, ".git"), { recursive: true });
  await fsMkdir(path.join(repoRoot, "src"), { recursive: true });
  await writeFile(
    path.join(repoRoot, "src", "foo.py"),
    'def greet(name: str) -> str:\n    return f"Hello, {name}"\n',
    "utf8"
  );
  const { createBrainApiServer } = await import(
    pathToFileURL(path.join(process.cwd(), "apps", "brain-api", "dist", "server.js")).href
  );

  const api = createBrainApiServer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    providerEndpoints: {
      dockerOllamaBaseUrl: "http://127.0.0.1:1"
    },
    apiHost: "127.0.0.1",
    apiPort: 18182,
    logLevel: "error"
  });

  t.after(async () => {
    await api.close();
    await rm(root, { recursive: true, force: true });
  });

  await api.listen();

  const response = await fetch("http://127.0.0.1:18182/v1/coding/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      taskType: "propose_fix",
      task: "Fix the writer promotion bug.",
      context: "The bug affects writer promotion.",
      repoRoot,
      filePath: "src/foo.py"
    })
  });

  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.equal(payload.status, "fail");
  assert.doesNotMatch(payload.reason, /allowed_patch_root|LOCAL_EXPERT_REPO_ROOT/i);
});

function cliEnvironment(root, overrides = {}) {
  return {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_VAULT_ROOT: path.join(root, "vault", "canonical"),
    MAB_STAGING_ROOT: path.join(root, "vault", "staging"),
    MAB_SQLITE_PATH: path.join(root, "state", "multi-agent-brain.sqlite"),
    MAB_QDRANT_URL: "http://127.0.0.1:6333",
    MAB_QDRANT_COLLECTION: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    MAB_EMBEDDING_PROVIDER: "hash",
    MAB_REASONING_PROVIDER: "heuristic",
    MAB_DRAFTING_PROVIDER: "disabled",
    MAB_RERANKER_PROVIDER: "local",
    MAB_LOG_LEVEL: "error",
    ...overrides
  };
}

function runNodeCommand(scriptPath, args, env, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function currentDateIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateIso, days) {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seedTemporalValidityNote(sqlitePath, input) {
  const { SqliteMetadataControlStore } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );
  const store = new SqliteMetadataControlStore(sqlitePath);

  try {
    await store.upsertNote({
      noteId: input.noteId,
      corpusId: "context_brain",
      notePath: input.notePath,
      noteType: "reference",
      lifecycleState: "promoted",
      revision: currentDateIso(),
      updatedAt: currentDateIso(),
      currentState: true,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      summary: input.summary,
      scope: "temporal-validity",
      tags: ["project/multi-agent-brain", "status/current"],
      contentHash: `sha256:${input.noteId}`,
      semanticSignature: input.noteId
    });
  } finally {
    store.close();
  }
}

async function seedCanonicalTemporalNote(root, input) {
  const { buildServiceContainer } = await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );

  const container = buildServiceContainer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `context_brain_chunks_${randomUUID().slice(0, 8)}`,
    embeddingProvider: "hash",
    reasoningProvider: "heuristic",
    draftingProvider: "disabled",
    rerankerProvider: "local",
    logLevel: "error"
  });
  try {
    const draft = await container.services.stagingDraftService.createDraft({
      actor: testActor("writer"),
      targetCorpus: "context_brain",
      noteType: "reference",
      title: input.title,
      sourcePrompt: `Refresh seed for ${input.title}`,
      supportingSources: [],
      bodyHints: [
        "This canonical note exists only to exercise the refresh workflow.",
        "It should become a governed staging refresh draft when its validity expires."
      ],
      frontmatterOverrides: {
        scope: input.scope,
        validFrom: input.validFrom,
        validUntil: input.validUntil
      }
    });

    assert.equal(draft.ok, true);

    const promoted = await container.services.promotionOrchestratorService.promoteDraft({
      actor: testActor("orchestrator"),
      draftNoteId: draft.data.draftNoteId,
      targetCorpus: "context_brain",
      promoteAsCurrentState: true
    });

    assert.equal(promoted.ok, true);
    return { noteId: promoted.data.promotedNoteId };
  } finally {
    container.dispose();
  }
}

function testActor(role) {
  return {
    actorId: `${role}-actor`,
    actorRole: role,
    transport: "internal",
    source: "transport-test-seed",
    requestId: randomUUID(),
    initiatedAt: new Date().toISOString(),
    toolName: "seed"
  };
}
