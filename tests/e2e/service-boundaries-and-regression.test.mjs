import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir as fsMkdir, mkdtemp, rm, writeFile as fsWriteFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServiceContainer } from "../../packages/infrastructure/dist/index.js";

test("retrieval actors cannot create staging drafts", async (t) => {
  const { container } = await createHarness(t);

  const result = await container.services.stagingDraftService.createDraft({
    actor: actor("retrieval"),
    targetCorpus: "context_brain",
    noteType: "decision",
    title: "Retrieval Boundary",
    sourcePrompt: "Create a retrieval note.",
    supportingSources: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "forbidden");
});

test("writer actors cannot promote drafts", async (t) => {
  const { container } = await createHarness(t);

  const draft = await createDraft(container, {
    actorRole: "writer",
    targetCorpus: "context_brain",
    noteType: "decision",
    title: "Writer Promotion Boundary",
    sourcePrompt: "Draft a policy note."
  });

  const result = await container.services.promotionOrchestratorService.promoteDraft({
    actor: actor("writer"),
    draftNoteId: draft.draftNoteId,
    targetCorpus: "context_brain",
    expectedDraftRevision: draft.frontmatter.noteId ? undefined : undefined,
    promoteAsCurrentState: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "forbidden");
});

test("context-brain drafts reject general-notes source leakage", async (t) => {
  const { container } = await createHarness(t);

  const result = await container.services.stagingDraftService.createDraft({
    actor: actor("writer"),
    targetCorpus: "context_brain",
    noteType: "decision",
    title: "Leaky Draft",
    sourcePrompt: "Turn freeform notes into canonical context.",
    supportingSources: [
      {
        noteId: randomUUID(),
        notePath: "general_notes/scratch/freeform.md",
        headingPath: ["Scratch"],
        excerpt: "Temporary freeform note"
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_failed");
  assert.match(result.error.message, /general_notes/i);
});

test("general notes cannot be written as current-state canonical context", async (t) => {
  const { container } = await createHarness(t);
  const noteId = randomUUID();

  const result = await container.services.canonicalNoteService.writeCanonicalNote({
    noteId,
    corpusId: "general_notes",
    notePath: "general_notes/reference/general-current.md",
    revision: "",
    frontmatter: {
      noteId,
      title: "General Current",
      project: "multi-agent-brain",
      type: "reference",
      status: "promoted",
      updated: currentDateIso(),
      summary: "Should not be allowed as current-state canonical context.",
      tags: ["project/multi-agent-brain", "status/current", "artifact/application"],
      scope: "general_notes",
      corpusId: "general_notes",
      currentState: true
    },
    body: "## Summary\n\nBlocked.\n\n## Details\n\nBlocked.\n\n## Sources\n\n- none"
  });

  assert.equal(result.ok, false);
  assert.match(result.error.message, /general notes cannot be marked as current-state/i);
});

test("promotion of a current-state context note creates a deterministic snapshot note", async (t) => {
  const { container } = await createHarness(t);

  const draft = await createDraft(container, {
    actorRole: "writer",
    targetCorpus: "context_brain",
    noteType: "decision",
    title: "Writer Agent Policy",
    sourcePrompt: "Draft the current writer-agent policy.",
    bodyHints: [
      "Writer agent only writes to staging.",
      "Orchestrator alone promotes canonical notes."
    ],
    frontmatterOverrides: {
      scope: "writer-policy"
    }
  });

  const result = await container.services.promotionOrchestratorService.promoteDraft({
    actor: actor("orchestrator"),
    draftNoteId: draft.draftNoteId,
    targetCorpus: "context_brain",
    promoteAsCurrentState: true
  });

  assert.equal(result.ok, true);
  const notes = await container.services.canonicalNoteService.listCanonicalNotes("context_brain");
  assert.equal(notes.ok, true);

  const snapshot = notes.data.find((note) =>
    note.notePath.startsWith("context_brain/current-state/")
  );

  assert.ok(snapshot, "expected a current-state snapshot note to be created");
  assert.equal(snapshot.frontmatter.type, "reference");
  assert.equal(snapshot.frontmatter.currentState, false);
  assert.ok(snapshot.frontmatter.tags.includes("topic/current-state-snapshot"));
});

test("chunking preserves code fences, heading hierarchy, and adjacency", async (t) => {
  const { container } = await createHarness(t);
  const noteId = randomUUID();
  const chunks = container.services.chunkingService.chunkCanonicalNote({
    noteId,
    corpusId: "context_brain",
    notePath: "context_brain/architecture/chunking-example.md",
    revision: "",
    frontmatter: {
      noteId,
      title: "Chunking Example",
      project: "multi-agent-brain",
      type: "architecture",
      status: "promoted",
      updated: currentDateIso(),
      summary: "Chunking behavior example.",
      tags: ["project/multi-agent-brain", "domain/chunking", "status/promoted"],
      scope: "chunking",
      corpusId: "context_brain",
      currentState: true
    },
    body: [
      "## Context",
      "",
      "This section explains chunking.",
      "",
      "```ts",
      "export function keepCodeFence() {",
      "  return true;",
      "}",
      "```",
      "",
      "## Data Flow",
      "",
      "- preserve headings",
      "- preserve adjacency",
      "",
      "Additional implementation details."
    ].join("\n")
  });

  assert.ok(chunks.length >= 2);
  assert.ok(chunks.some((chunk) => chunk.rawText.includes("```ts")));
  assert.equal(chunks[0].headingPath[0], "Chunking Example");
  assert.ok(chunks[0].nextChunkId);
  assert.equal(chunks[1].prevChunkId, chunks[0].chunkId);
});

test("retrieval packets stay within explicit source and raw-excerpt budgets", async (t) => {
  const { container } = await createHarness(t);

  await createAndPromote(container, {
    title: "Writer Staging Rules",
    noteType: "decision",
    bodyHints: [
      "Writer staging policy requires drafts only.",
      "Writers never promote canonical memory."
    ],
    scope: "writer-staging-a",
    promoteAsCurrentState: true
  });

  await createAndPromote(container, {
    title: "Promotion Policy",
    noteType: "constraint",
    bodyHints: [
      "Promotion policy is deterministic.",
      "Writer staging policy defers promotion to the orchestrator."
    ],
    scope: "writer-staging-b",
    promoteAsCurrentState: false
  });

  await createAndPromote(container, {
    title: "Context Brain Storage",
    noteType: "architecture",
    bodyHints: [
      "Context brain retrieval uses staged canonical promotion.",
      "Writer staging policy protects canonical memory."
    ],
    scope: "writer-staging-c",
    promoteAsCurrentState: false
  });

  const result = await container.services.retrieveContextService.retrieveContext({
    actor: actor("retrieval"),
    query: "writer staging policy",
    budget: {
      maxTokens: 320,
      maxSources: 2,
      maxRawExcerpts: 1,
      maxSummarySentences: 2
    },
    corpusIds: ["context_brain"],
    requireEvidence: false
  });

  assert.equal(result.ok, true);
  assert.ok(result.data.candidateCounts.lexical > 0);
  assert.ok(result.data.packet.evidence.length <= 2);
  assert.ok((result.data.packet.rawExcerpts?.length ?? 0) <= 1);
  assert.ok(result.data.packet.budgetUsage.sourceCount <= 2);
});

test("root orchestrator exposes direct context-packet assembly for ranked candidates", async (t) => {
  const { container } = await createHarness(t);

  const result = await container.orchestrator.getContextPacket({
    actor: actor("retrieval"),
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
        score: 0.81,
        summary: "Canonical architecture notes define bounded retrieval packets.",
        rawText: "Canonical architecture notes define bounded retrieval packets and keep provenance attached.",
        scope: "architecture",
        qualifiers: ["bounded retrieval", "provenance required"],
        tags: ["project/multi-agent-brain", "domain/retrieval"],
        stalenessClass: "current",
        provenance: {
          noteId: "note-architecture-1",
          notePath: "context_brain/architecture/retrieval-packets.md",
          headingPath: ["Summary"]
        }
      },
      {
        noteType: "decision",
        score: 0.67,
        summary: "Decision packets should stay smaller than raw retrieval search outputs.",
        scope: "architecture",
        qualifiers: ["bounded packets"],
        tags: ["project/multi-agent-brain", "domain/retrieval"],
        stalenessClass: "current",
        provenance: {
          noteId: "note-decision-1",
          notePath: "context_brain/decision/packet-size.md",
          headingPath: ["Decision"]
        }
      }
    ]
  });

  assert.equal(result.packet.packetType, "implementation");
  assert.equal(result.packet.answerability, "local_answer");
  assert.ok(result.packet.evidence.length <= 2);
  assert.ok((result.packet.rawExcerpts?.length ?? 0) <= 1);
});

test("decision summary retrieval returns a decision packet and records audit history", async (t) => {
  const { container } = await createHarness(t);

  await createAndPromote(container, {
    title: "Writer Agent Policy",
    noteType: "decision",
    bodyHints: [
      "Writer agents only create staging drafts.",
      "The orchestrator alone promotes canonical notes."
    ],
    scope: "writer-policy",
    promoteAsCurrentState: true
  });

  const result = await container.services.decisionSummaryService.getDecisionSummary({
    actor: actor("retrieval"),
    topic: "writer agent policy",
    budget: {
      maxTokens: 320,
      maxSources: 2,
      maxRawExcerpts: 1,
      maxSummarySentences: 2
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.decisionPacket.packetType, "decision");
  assert.ok(result.data.decisionPacket.evidence.length >= 1);

  const history = await container.services.auditHistoryService.queryHistory({
    actor: actor("operator"),
    limit: 20
  });

  assert.equal(history.ok, true);
  assert.ok(history.data.entries.some((entry) => entry.actionType === "fetch_decision_summary"));
  assert.ok(history.data.entries.some((entry) => entry.actionType === "retrieve_context"));
});

test("schema validation blocks missing required sections", async (t) => {
  const { container } = await createHarness(t);
  const noteId = randomUUID();

  const validation = container.services.noteValidationService.validate({
    actor: actor("orchestrator"),
    targetCorpus: "context_brain",
    notePath: "context_brain/decision/invalid-note.md",
    validationMode: "promotion",
    frontmatter: {
      noteId,
      title: "Invalid Decision",
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
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.violations.some((issue) => issue.field === "body.sections"));
});

test("root orchestrator routes coding tasks through the vendored runtime bridge", async (t) => {
  const { container } = await createHarness(t);

  const result = await container.orchestrator.executeCodingTask({
    actor: actor("operator"),
    taskType: "propose_fix",
    task: "Fix the writer promotion bug.",
    context: "The bug affects writer promotion.",
    filePath: "src/example.py"
  });

  assert.equal(result.status, "escalate");
  assert.match(result.reason, /allowed_patch_root|LOCAL_EXPERT_REPO_ROOT/i);
});

test("root orchestrator passes repoRoot into the vendored runtime for bounded coding tasks", async (t) => {
  const { container, root } = await createHarness(t, {
    providerEndpoints: {
      dockerOllamaBaseUrl: "http://127.0.0.1:1"
    }
  });
  const repoRoot = path.join(root, "coding-repo");
  await fsMkdir(path.join(repoRoot, ".git"), { recursive: true });
  await fsMkdir(path.join(repoRoot, "src"), { recursive: true });
  await fsWriteFile(
    path.join(repoRoot, "src", "foo.py"),
    'def greet(name: str) -> str:\n    return f"Hello, {name}"\n',
    "utf8"
  );

  const result = await container.orchestrator.executeCodingTask({
    actor: actor("operator"),
    taskType: "propose_fix",
    task: "Fix the greet function.",
    context: "The greeting function should be corrected safely.",
    repoRoot,
    filePath: "src/foo.py"
  });

  assert.equal(result.status, "fail");
  assert.doesNotMatch(result.reason, /allowed_patch_root|LOCAL_EXPERT_REPO_ROOT/i);
});

async function createHarness(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-e2e-"));
  const env = testEnvironment(root, overrides);
  const container = buildServiceContainer(env);

  t.after(async () => {
    container.dispose?.();
    await rm(root, { recursive: true, force: true });
  });

  return { root, env, container };
}

async function createDraft(container, input) {
  const result = await container.services.stagingDraftService.createDraft({
    actor: actor(input.actorRole ?? "writer"),
    targetCorpus: input.targetCorpus ?? "context_brain",
    noteType: input.noteType,
    title: input.title,
    sourcePrompt: input.sourcePrompt,
    supportingSources: input.supportingSources ?? [],
    bodyHints: input.bodyHints ?? [],
    frontmatterOverrides: input.frontmatterOverrides
  });

  assert.equal(result.ok, true);
  return result.data;
}

async function createAndPromote(container, input) {
  const draft = await createDraft(container, {
    actorRole: "writer",
    targetCorpus: "context_brain",
    noteType: input.noteType,
    title: input.title,
    sourcePrompt: `Draft ${input.title}`,
    bodyHints: input.bodyHints,
    frontmatterOverrides: {
      scope: input.scope
    }
  });

  const promoted = await container.services.promotionOrchestratorService.promoteDraft({
    actor: actor("orchestrator"),
    draftNoteId: draft.draftNoteId,
    targetCorpus: "context_brain",
    promoteAsCurrentState: input.promoteAsCurrentState ?? false
  });

  assert.equal(promoted.ok, true);
  return promoted.data;
}

function actor(role) {
  return {
    actorId: `${role}-actor`,
    actorRole: role,
    transport: "internal",
    source: "test-suite",
    requestId: randomUUID(),
    initiatedAt: new Date().toISOString(),
    toolName: "service-test"
  };
}

function testEnvironment(root = path.join(os.tmpdir(), `mab-standalone-${randomUUID()}`), overrides = {}) {
  return {
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
    apiPort: 8080,
    logLevel: "error",
    ...overrides
  };
}

function currentDateIso() {
  return new Date().toISOString().slice(0, 10);
}
