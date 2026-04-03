import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir as fsMkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

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
