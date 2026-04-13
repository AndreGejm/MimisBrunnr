import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const infrastructure = await import("../../packages/infrastructure/dist/index.js");
const orchestration = await import("../../packages/orchestration/dist/index.js");
const domain = await import("../../packages/domain/dist/index.js");

test("search-context validation preserves includeTrace and retrieval returns health", async (t) => {
  const { container } = await createHarness(t);
  await createCanonicalNote(container, {
    title: "Hermes Retrieval Health",
    body: "Vector retrieval degradation should be visible while lexical fallback remains active."
  });

  const validated = infrastructure.validateTransportRequest("search-context", {
    query: "Hermes Retrieval Health",
    corpusIds: ["context_brain"],
    budget: {
      maxTokens: 1200,
      maxSources: 4,
      maxRawExcerpts: 1,
      maxSummarySentences: 4
    },
    includeTrace: true
  });

  assert.equal(validated.includeTrace, true);

  const result = await container.orchestrator.searchContext({
    ...validated,
    actor: actor("retrieval")
  });

  assert.equal(result.ok, true);
  assert.ok(result.data.trace);
  assert.ok(result.data.retrievalHealth);
  assert.match(result.data.retrievalHealth.status, /healthy|degraded|unhealthy/);
  assert.equal(typeof result.data.retrievalHealth.deliveredCandidates, "number");
});

test("session archive search returns bounded non-authoritative recall", async (t) => {
  const { container } = await createHarness(t);

  const archive = await container.orchestrator.createSessionArchive({
    actor: actor("operator"),
    sessionId: "hermes-session-recall",
    messages: [
      {
        role: "user",
        content: "Use Hermes only for non-authoritative session recall and agent ergonomics."
      },
      {
        role: "assistant",
        content: "Do not copy autonomous background memory writes into MultiagentBrain."
      }
    ]
  });

  assert.equal(archive.ok, true);

  const result = await container.orchestrator.searchSessionArchives({
    actor: actor("retrieval"),
    query: "Hermes session recall ergonomics",
    sessionId: "hermes-session-recall",
    limit: 5,
    maxTokens: 200
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.hits.length, 1);
  assert.equal(result.data.hits[0].authority, "non_authoritative");
  assert.equal(result.data.hits[0].promotionStatus, "not_applicable");
  assert.match(result.data.hits[0].content, /session recall/);
  assert.equal(result.data.truncated, false);
});

test("assemble-agent-context fences canonical memory and session recall", async (t) => {
  const { container } = await createHarness(t);

  await createCanonicalNote(container, {
    title: "Hermes Context Assembly",
    body: "Canonical memory remains governed while retrieved context can help local agents."
  });
  await container.orchestrator.createSessionArchive({
    actor: actor("operator"),
    sessionId: "hermes-context-session",
    messages: [
      {
        role: "assistant",
        content: "Session recall is continuity only and remains non-authoritative."
      }
    ]
  });

  const result = await container.orchestrator.assembleAgentContext({
    actor: actor("retrieval"),
    query: "Hermes context assembly session recall",
    corpusIds: ["context_brain"],
    includeSessionArchives: true,
    sessionId: "hermes-context-session",
    budget: {
      maxTokens: 1600,
      maxSources: 4,
      maxRawExcerpts: 1,
      maxSummarySentences: 4
    },
    includeTrace: true
  });

  assert.equal(result.ok, true);
  assert.match(result.data.contextBlock, /<agent-context source="multi-agent-brain"/);
  assert.match(result.data.contextBlock, /<canonical-memory>/);
  assert.match(result.data.contextBlock, /<session-recall authority="non_authoritative">/);
  assert.match(result.data.contextBlock, /not new user input/i);
  assert.ok(result.data.sourceSummary.some((source) => source.source === "session_archive"));
});

test("execute-coding-task can inject fenced memory context before the local bridge", async () => {
  let capturedRequest;
  const fakeBrainController = {
    async assembleAgentContext(request) {
      assert.equal(request.query, "promotion flow");
      return {
        ok: true,
        data: {
          contextBlock: "<agent-context source=\"multi-agent-brain\" authority=\"retrieved\">memory</agent-context>",
          tokenEstimate: 42,
          truncated: false,
          sourceSummary: [{ source: "canonical_memory", authority: "canonical", count: 1 }]
        }
      };
    }
  };
  const fakeCodingController = {
    async executeTask(request) {
      capturedRequest = request;
      return {
        status: "success",
        reason: "captured",
        attempts: 1
      };
    }
  };
  const orchestrator = new orchestration.MultiAgentOrchestrator(
    new orchestration.TaskFamilyRouter(),
    fakeBrainController,
    fakeCodingController,
    new orchestration.ActorAuthorizationPolicy(),
    modelRoleRegistry(),
    new orchestration.RoleProviderRegistry()
  );

  const result = await orchestrator.executeCodingTask({
    actor: actor("operator"),
    taskType: "propose_fix",
    task: "Explain promotion flow",
    context: "base context",
    memoryContext: {
      query: "promotion flow",
      corpusIds: ["context_brain"],
      budget: {
        maxTokens: 800,
        maxSources: 2,
        maxRawExcerpts: 1,
        maxSummarySentences: 2
      }
    }
  });

  assert.equal(result.status, "success");
  assert.match(capturedRequest.context, /base context/);
  assert.match(capturedRequest.context, /<agent-context source="multi-agent-brain"/);
  assert.deepEqual(capturedRequest.memoryContext, undefined);
});

test("qwen3-coder local profile declares large-context deterministic coding metadata", () => {
  assert.equal(domain.QWEN3_CODER_LOCAL_PROFILE.id, "qwen3-coder");
  assert.equal(domain.QWEN3_CODER_LOCAL_PROFILE.role, "coding");
  assert.equal(domain.QWEN3_CODER_LOCAL_PROFILE.contextWindowTokens, 262144);
  assert.equal(domain.QWEN3_CODER_LOCAL_PROFILE.recommendedTemperature, 0);
  assert.equal(domain.QWEN3_CODER_LOCAL_PROFILE.recommendedSeed, 42);
  assert.ok(domain.QWEN3_CODER_LOCAL_PROFILE.cautions.some((item) => /authority/i.test(item)));
});

async function createHarness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-hermes-bridge-"));
  const container = infrastructure.buildServiceContainer({
    nodeEnv: "test",
    vaultRoot: path.join(root, "vault", "canonical"),
    stagingRoot: path.join(root, "vault", "staging"),
    sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
    qdrantUrl: "http://127.0.0.1:6333",
    qdrantCollection: `hermes_bridge_${randomUUID().slice(0, 8)}`,
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

async function createCanonicalNote(container, input) {
  const noteId = randomUUID();
  const result = await container.services.canonicalNoteService.writeCanonicalNote({
    noteId,
    corpusId: "context_brain",
    notePath: `context_brain/reference/${noteId}.md`,
    revision: "",
    frontmatter: {
      noteId,
      title: input.title,
      project: "multi-agent-brain",
      type: "reference",
      status: "promoted",
      updated: new Date().toISOString().slice(0, 10),
      summary: input.body,
      tags: ["project/multi-agent-brain", "domain/retrieval", "status/promoted"],
      scope: "hermes-bridge",
      corpusId: "context_brain",
      currentState: false
    },
    body: [
      "## Summary",
      "",
      input.body,
      "",
      "## Details",
      "",
      input.body,
      "",
      "## Sources",
      "",
      "- test fixture"
    ].join("\n")
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
    toolName: "hermes-bridge-runtime-test"
  };
}

function modelRoleRegistry() {
  return new orchestration.ModelRoleRegistry([
    binding("coding_primary", "docker_ollama", "qwen3-coder"),
    binding("brain_primary", "internal_heuristic", "heuristic"),
    binding("embedding_primary", "internal_hash", "hash"),
    binding("reranker_primary", "internal_heuristic", "heuristic"),
    binding("paid_escalation", "disabled")
  ]);
}

function binding(role, providerId, modelId) {
  return {
    role,
    providerId,
    modelId,
    temperature: 0,
    seed: 42,
    timeoutMs: 30_000
  };
}
