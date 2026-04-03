import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const infrastructure = await import("../../packages/infrastructure/dist/index.js");
const application = await import("../../packages/application/dist/index.js");

test("ollama embedding provider returns embeddings from the OpenAI-compatible local model API", async () => {
  const provider = new infrastructure.OllamaEmbeddingProvider({
    baseUrl: "http://127.0.0.1:12434",
    model: "docker.io/ai/qwen3-embedding:0.6B-F16",
    fetchImplementation: async (url, init) => {
      assert.match(String(url), /\/engines\/v1\/embeddings$/);
      const payload = JSON.parse(String(init.body));
      assert.equal(payload.model, "docker.io/ai/qwen3-embedding:0.6B-F16");
      return new Response(
        JSON.stringify({
          data: [
            { embedding: [0.1, 0.2, 0.3] },
            { embedding: [0.3, 0.2, 0.1] }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  const embeddings = await provider.embedTexts(["alpha", "beta"]);
  assert.deepEqual(embeddings, [
    [0.1, 0.2, 0.3],
    [0.3, 0.2, 0.1]
  ]);
});

test("ollama embedding provider falls back to the engine-qualified OpenAI endpoint when needed", async () => {
  const seenPaths = [];
  const provider = new infrastructure.OllamaEmbeddingProvider({
    baseUrl: "http://127.0.0.1:12434",
    model: "docker.io/ai/qwen3-embedding:0.6B-F16",
    fetchImplementation: async (url, init) => {
      const requestUrl = String(url);
      seenPaths.push(requestUrl);

      if (/\/engines\/v1\/embeddings$/.test(requestUrl)) {
        return new Response(
          JSON.stringify({ error: "not found" }),
          {
            status: 404,
            headers: { "content-type": "application/json" }
          }
        );
      }

      assert.match(requestUrl, /\/engines\/llama\.cpp\/v1\/embeddings$/);
      const payload = JSON.parse(String(init.body));
      assert.equal(payload.model, "docker.io/ai/qwen3-embedding:0.6B-F16");
      return new Response(
        JSON.stringify({
          data: [
            { embedding: [0.4, 0.5, 0.6] }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  const embeddings = await provider.embedTexts(["alpha"]);
  assert.deepEqual(embeddings, [
    [0.4, 0.5, 0.6]
  ]);
  assert.deepEqual(seenPaths.map((value) => new URL(value).pathname), [
    "/engines/v1/embeddings",
    "/engines/llama.cpp/v1/embeddings"
  ]);
});

test("ollama embedding provider falls back to the legacy embed path when OpenAI-compatible endpoints are unavailable", async () => {
  const seenPaths = [];
  const provider = new infrastructure.OllamaEmbeddingProvider({
    baseUrl: "http://127.0.0.1:12434",
    model: "docker.io/ai/qwen3-embedding:0.6B-F16",
    fetchImplementation: async (url, init) => {
      const requestUrl = String(url);
      seenPaths.push(requestUrl);

      if (
        /\/engines\/v1\/embeddings$/.test(requestUrl) ||
        /\/engines\/llama\.cpp\/v1\/embeddings$/.test(requestUrl) ||
        /\/api\/embeddings$/.test(requestUrl)
      ) {
        return new Response(
          JSON.stringify({ error: "not found" }),
          {
            status: 404,
            headers: { "content-type": "application/json" }
          }
        );
      }

      assert.match(requestUrl, /\/api\/embed$/);
      const payload = JSON.parse(String(init.body));
      assert.equal(payload.model, "docker.io/ai/qwen3-embedding:0.6B-F16");
      return new Response(
        JSON.stringify({
          embeddings: [
            [0.7, 0.8, 0.9]
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  const embeddings = await provider.embedTexts(["alpha"]);
  assert.deepEqual(embeddings, [
    [0.7, 0.8, 0.9]
  ]);
  assert.deepEqual(seenPaths.map((value) => new URL(value).pathname), [
    "/engines/v1/embeddings",
    "/engines/llama.cpp/v1/embeddings",
    "/api/embeddings",
    "/api/embed"
  ]);
});

test("ollama local reasoning provider parses structured reasoning outputs", async () => {
  const responses = [
    { response: JSON.stringify({ intent: "debugging" }) },
    { response: JSON.stringify({ answerability: "partial" }) },
    { response: JSON.stringify({ summary: "Local context is partial." }) }
  ];

  const provider = new infrastructure.OllamaLocalReasoningProvider({
    baseUrl: "http://127.0.0.1:12434",
    model: "qwen3",
    fetchImplementation: async () =>
      new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });

  const intent = await provider.classifyIntent("Why is the writer failing to promote notes?");
  assert.equal(intent, "debugging");

  const answerability = await provider.assessAnswerability({
    query: "Why is the writer failing to promote notes?",
    intent,
    candidates: []
  });
  assert.equal(answerability, "partial");

  const uncertainty = await provider.summarizeUncertainty("promotion failure", ["limited evidence"]);
  assert.equal(uncertainty, "Local context is partial.");
});

test("openai-compatible paid reasoning provider parses structured reasoning outputs", async () => {
  const seenAuthorizations = [];
  const responses = [
    { choices: [{ message: { content: JSON.stringify({ intent: "architecture_recall" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ answerability: "needs_escalation" }) } }] },
    { choices: [{ message: { content: JSON.stringify({ summary: "Escalate to the paid provider for authoritative synthesis." }) } }] }
  ];

  const provider = new infrastructure.OpenAiCompatibleLocalReasoningProvider({
    baseUrl: "https://paid.example.test/v1",
    apiKey: "top-secret",
    model: "gpt-paid-test",
    fetchImplementation: async (url, init) => {
      assert.match(String(url), /\/v1\/chat\/completions$/);
      seenAuthorizations.push(init.headers.authorization);
      const payload = JSON.parse(String(init.body));
      assert.equal(payload.model, "gpt-paid-test");
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const intent = await provider.classifyIntent("How is the retrieval architecture composed?");
  assert.equal(intent, "architecture_recall");

  const answerability = await provider.assessAnswerability({
    query: "How is the retrieval architecture composed?",
    intent,
    candidates: []
  });
  assert.equal(answerability, "needs_escalation");

  const uncertainty = await provider.summarizeUncertainty("retrieval architecture", ["no local evidence"]);
  assert.equal(
    uncertainty,
    "Escalate to the paid provider for authoritative synthesis."
  );
  assert.deepEqual(seenAuthorizations, [
    "Bearer top-secret",
    "Bearer top-secret",
    "Bearer top-secret"
  ]);
});

test("ollama reranker provider returns candidates in model-selected order", async () => {
  const provider = new infrastructure.OllamaRerankerProvider({
    baseUrl: "http://127.0.0.1:12434",
    model: "qwen3-reranker",
    fetchImplementation: async (url, init) => {
      assert.match(String(url), /\/api\/generate$/);
      const payload = JSON.parse(String(init.body));
      assert.equal(payload.model, "qwen3-reranker");
      return new Response(
        JSON.stringify({
          response: JSON.stringify({ orderedIndices: [2, 0, 1] })
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  const reordered = await provider.rerankCandidates({
    query: "Which note is the current decision?",
    intent: "decision_lookup",
    limit: 2,
    candidates: [
      {
        noteType: "decision",
        score: 0.5,
        summary: "First candidate",
        scope: "current state",
        qualifiers: [],
        tags: ["project/multi-agent-brain"],
        stalenessClass: "current",
        provenance: {
          noteId: "note-1",
          chunkId: "chunk-1",
          notePath: "context_brain/decision/one.md",
          headingPath: ["Context"]
        }
      },
      {
        noteType: "decision",
        score: 0.4,
        summary: "Second candidate",
        scope: "current state",
        qualifiers: [],
        tags: ["project/multi-agent-brain"],
        stalenessClass: "current",
        provenance: {
          noteId: "note-2",
          chunkId: "chunk-2",
          notePath: "context_brain/decision/two.md",
          headingPath: ["Decision"]
        }
      },
      {
        noteType: "decision",
        score: 0.3,
        summary: "Third candidate",
        scope: "current state",
        qualifiers: [],
        tags: ["project/multi-agent-brain"],
        stalenessClass: "current",
        provenance: {
          noteId: "note-3",
          chunkId: "chunk-3",
          notePath: "context_brain/decision/three.md",
          headingPath: ["Consequences"]
        }
      }
    ]
  });

  assert.equal(reordered.length, 2);
  assert.equal(reordered[0].provenance.noteId, "note-3");
  assert.equal(reordered[1].provenance.noteId, "note-1");
});

test("staging draft service uses the drafting provider output before deterministic validation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-drafting-"));
  const sqlitePath = path.join(root, "state", "multi-agent-brain.sqlite");
  const metadataControlStore = new infrastructure.SqliteMetadataControlStore(sqlitePath);

  t.after(async () => {
    metadataControlStore.close();
    await rm(root, { recursive: true, force: true });
  });

  const stagingRepository = new infrastructure.FileSystemStagingNoteRepository(
    path.join(root, "vault", "staging")
  );
  const noteValidationService = new application.NoteValidationService();
  const stagingDraftService = new application.StagingDraftService(
    stagingRepository,
    metadataControlStore,
    noteValidationService,
    {
      providerId: "fake-local-drafting",
      async draftStructuredNote(request) {
        return {
          draftNoteId: request.frontmatterOverrides?.noteId ?? randomUUID(),
          lifecycleState: "draft",
          draftPath: "",
          frontmatter: {
            noteId: request.frontmatterOverrides?.noteId ?? randomUUID(),
            title: request.title,
            project: "multi-agent-brain",
            type: request.noteType,
            status: "draft",
            updated: new Date().toISOString().slice(0, 10),
            summary: request.sourcePrompt,
            tags: ["project/multi-agent-brain", "status/draft"],
            scope: "staging",
            corpusId: request.targetCorpus,
            currentState: false
          },
          body: [
            "## Context",
            "",
            "Generated by local drafting.",
            "",
            "## Decision",
            "",
            "Use the drafting provider when available.",
            "",
            "## Rationale",
            "",
            "This keeps the service transport-agnostic.",
            "",
            "## Consequences",
            "",
            "Validation still governs the output."
          ].join("\n"),
          warnings: ["used local drafting provider"]
        };
      }
    }
  );

  const result = await stagingDraftService.createDraft({
    actor: {
      actorId: "writer-test",
      actorRole: "writer",
      transport: "internal",
      source: "test-suite",
      requestId: randomUUID(),
      initiatedAt: new Date().toISOString()
    },
    targetCorpus: "context_brain",
    noteType: "decision",
    title: "Local Drafted Decision",
    sourcePrompt: "Create a promoted drafting policy.",
    supportingSources: []
  });

  assert.equal(result.ok, true);
  assert.match(result.data.body, /Generated by local drafting/);
  assert.ok(result.data.warnings.includes("used local drafting provider"));
});
