import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir as fsMkdir, mkdtemp, rm, writeFile as fsWriteFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as application from "../../packages/application/dist/index.js";
import {
  SqliteAuditLog,
  SqliteFtsIndex,
  SqliteMetadataControlStore,
  buildServiceContainer,
  runRuntimeHealthChecks
} from "../../packages/infrastructure/dist/index.js";

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

test("promotion outbox replays failed cross-store sync work after a transient index failure", async (t) => {
  const { container } = await createHarness(t);
  assert.ok(container.ports.lexicalIndex, "expected lexical index to be available");

  const draft = await createDraft(container, {
    actorRole: "writer",
    targetCorpus: "context_brain",
    noteType: "decision",
    title: "Replayable Promotion",
    sourcePrompt: "Draft a promotion that should survive a transient indexing fault.",
    bodyHints: [
      "The promotion outbox should make canonical writes replayable.",
      "Chunk and index sync can be retried safely."
    ],
    frontmatterOverrides: {
      scope: "promotion-outbox"
    }
  });

  let failLexicalUpsertOnce = true;
  const failOnceLexicalIndex = {
    async removeByNoteId(noteId) {
      return container.ports.lexicalIndex.removeByNoteId(noteId);
    },
    async upsertChunks(chunks) {
      if (failLexicalUpsertOnce) {
        failLexicalUpsertOnce = false;
        throw new Error("Injected lexical sync failure");
      }

      return container.ports.lexicalIndex.upsertChunks(chunks);
    }
  };
  const promotionService = new application.PromotionOrchestratorService(
    container.ports.stagingNoteRepository,
    container.services.canonicalNoteService,
    container.services.noteValidationService,
    container.ports.metadataControlStore,
    container.services.chunkingService,
    container.services.auditHistoryService,
    failOnceLexicalIndex,
    container.ports.vectorIndex,
    container.ports.embeddingProvider
  );

  const initialPromotion = await promotionService.promoteDraft({
    actor: actor("orchestrator"),
    draftNoteId: draft.draftNoteId,
    targetCorpus: "context_brain",
    promoteAsCurrentState: false
  });

  assert.equal(initialPromotion.ok, false);
  assert.equal(initialPromotion.error.code, "write_failed");
  assert.equal(typeof initialPromotion.error.details?.outboxId, "string");

  const outboxId = initialPromotion.error.details.outboxId;
  const failedOutbox = await container.ports.metadataControlStore.getPromotionOutboxEntry(outboxId);
  assert.ok(failedOutbox);
  assert.equal(failedOutbox.state, "failed");

  const replay = await promotionService.replayPendingPromotions();
  assert.ok(replay.processedOutboxIds.includes(outboxId));
  assert.ok(!replay.failedOutboxIds.includes(outboxId));

  const completedOutbox = await container.ports.metadataControlStore.getPromotionOutboxEntry(outboxId);
  assert.ok(completedOutbox);
  assert.equal(completedOutbox.state, "completed");

  const notes = await container.services.canonicalNoteService.listCanonicalNotes("context_brain");
  assert.equal(notes.ok, true);
  assert.ok(
    notes.data.some((note) => note.frontmatter.title === "Replayable Promotion")
  );

  const promotedDraft = await container.ports.stagingNoteRepository.getById(draft.draftNoteId);
  assert.ok(promotedDraft);
  assert.equal(promotedDraft.lifecycleState, "promoted");
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

test("chunking marks expired current-state notes as stale when a validity window has elapsed", async (t) => {
  const { container } = await createHarness(t);
  const noteId = randomUUID();
  const chunks = container.services.chunkingService.chunkCanonicalNote({
    noteId,
    corpusId: "context_brain",
    notePath: "context_brain/reference/expired-validity-window.md",
    revision: "",
    frontmatter: {
      noteId,
      title: "Expired Validity Window",
      project: "multi-agent-brain",
      type: "reference",
      status: "promoted",
      updated: "2026-04-01",
      summary: "Expired guidance should not remain current forever.",
      tags: ["project/multi-agent-brain", "status/promoted", "risk/stale-context"],
      scope: "temporal-validity",
      corpusId: "context_brain",
      currentState: true,
      validFrom: "2026-03-01",
      validUntil: "2026-03-31"
    },
    body: "## Summary\n\nExpired.\n\n## Details\n\nExpired.\n\n## Sources\n\n- none"
  });

  assert.ok(chunks.length >= 1);
  assert.equal(chunks[0].stalenessClass, "stale");
});

test("metadata control store summarizes expired and expiring current-state notes", async (t) => {
  const { container } = await createHarness(t);
  const today = currentDateIso();
  const expiredDate = addDaysIso(today, -1);
  const upcomingDate = addDaysIso(today, 5);

  await createAndPromote(container, {
    title: "Expired Current Guidance",
    noteType: "reference",
    bodyHints: [
      "Expired current guidance should surface in temporal validity reporting."
    ],
    scope: "temporal-validity-expired",
    promoteAsCurrentState: true,
    frontmatterOverrides: {
      validFrom: addDaysIso(today, -30),
      validUntil: expiredDate
    }
  });

  await createAndPromote(container, {
    title: "Expiring Soon Guidance",
    noteType: "reference",
    bodyHints: [
      "Soon-to-expire guidance should surface before it becomes stale."
    ],
    scope: "temporal-validity-expiring",
    promoteAsCurrentState: true,
    frontmatterOverrides: {
      validFrom: addDaysIso(today, -5),
      validUntil: upcomingDate
    }
  });

  const summary = await container.ports.metadataControlStore.getTemporalValiditySummary({
    asOf: today,
    expiringWithinDays: 7,
    corpusId: "context_brain"
  });

  assert.equal(summary.asOf, today);
  assert.equal(summary.expiredCurrentStateNotes, 1);
  assert.equal(summary.expiringSoonCurrentStateNotes, 1);
  assert.equal(summary.futureDatedCurrentStateNotes, 0);
});

test("metadata control store reports actionable temporal refresh candidates", async (t) => {
  const { container } = await createHarness(t);
  const today = currentDateIso();

  const expired = await createAndPromote(container, {
    title: "Expired Refresh Candidate",
    noteType: "reference",
    bodyHints: [
      "Expired refresh candidates should show up with note paths and days past due."
    ],
    scope: "temporal-validity-report-expired",
    promoteAsCurrentState: true,
    frontmatterOverrides: {
      validFrom: addDaysIso(today, -30),
      validUntil: addDaysIso(today, -2)
    }
  });

  const expiringSoon = await createAndPromote(container, {
    title: "Expiring Soon Candidate",
    noteType: "reference",
    bodyHints: [
      "Soon-to-expire candidates should surface before they actually expire."
    ],
    scope: "temporal-validity-report-expiring",
    promoteAsCurrentState: true,
    frontmatterOverrides: {
      validFrom: addDaysIso(today, -5),
      validUntil: addDaysIso(today, 3)
    }
  });

  const report = await container.ports.metadataControlStore.getTemporalValidityReport({
    asOf: today,
    expiringWithinDays: 7,
    corpusId: "context_brain",
    limitPerCategory: 5
  });

  assert.equal(report.expiredCurrentStateNotes, 1);
  assert.equal(report.expiringSoonCurrentStateNotes, 1);
  assert.equal(report.limitPerCategory, 5);
  assert.equal(report.expiredCurrentState[0].noteId, expired.promotedNoteId);
  assert.equal(report.expiredCurrentState[0].state, "expired");
  assert.ok(report.expiredCurrentState[0].daysPastDue >= 1);
  assert.equal(report.expiringSoonCurrentState[0].noteId, expiringSoon.promotedNoteId);
  assert.equal(report.expiringSoonCurrentState[0].state, "expiring_soon");
  assert.ok(report.expiringSoonCurrentState[0].daysUntilExpiry >= 0);
});

test("temporal refresh service creates a governed staging draft for expired current-state notes", async (t) => {
  const { container } = await createHarness(t);
  const today = currentDateIso();

  const promoted = await createAndPromote(container, {
    title: "Expired Refresh Workflow Guidance",
    noteType: "reference",
    bodyHints: [
      "Expired current-state notes should generate governed refresh drafts.",
      "Refresh drafts should supersede the stale source note and re-enter staging."
    ],
    scope: "temporal-refresh-workflow",
    promoteAsCurrentState: true,
    frontmatterOverrides: {
      validFrom: addDaysIso(today, -21),
      validUntil: addDaysIso(today, -1)
    }
  });

  const refreshed = await container.orchestrator.createRefreshDraft({
    actor: actor("operator"),
    noteId: promoted.promotedNoteId,
    bodyHints: ["Confirm the validity window and update outdated claims."]
  });

  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.data.sourceNoteId, promoted.promotedNoteId);
  assert.equal(refreshed.data.sourceState, "expired");
  assert.equal(refreshed.data.frontmatter.currentState, false);
  assert.deepEqual(refreshed.data.frontmatter.supersedes, [promoted.promotedNoteId]);
  assert.ok(refreshed.data.frontmatter.tags.includes("risk/stale-context"));
  assert.ok(refreshed.data.body.length > 0);

  const staged = await container.ports.stagingNoteRepository.getById(
    refreshed.data.draftNoteId
  );
  assert.ok(staged);
  assert.equal(staged.lifecycleState, "draft");
  assert.deepEqual(staged.frontmatter.supersedes, [promoted.promotedNoteId]);

  const history = await container.services.auditHistoryService.queryHistory({
    actor: actor("operator"),
    limit: 20
  });

  assert.equal(history.ok, true);
  assert.ok(
    history.data.entries.some(
      (entry) =>
        entry.actionType === "create_refresh_draft" &&
        entry.affectedNoteIds.includes(promoted.promotedNoteId) &&
        entry.affectedNoteIds.includes(refreshed.data.draftNoteId)
    )
  );
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

test("context packet assembly hard-enforces token and summary-sentence budgets", async (t) => {
  const { container } = await createHarness(t);

  const packetResponse = await container.services.contextPacketService.assemblePacket(
    {
      actor: actor("retrieval"),
      intent: "architecture_recall",
      budget: {
        maxTokens: 80,
        maxSources: 3,
        maxRawExcerpts: 2,
        maxSummarySentences: 1
      },
      includeRawExcerpts: true,
      candidates: [
        {
          noteType: "architecture",
          score: 0.92,
          summary: "Primary architecture guidance explains the packet contract. It also describes the retry loop in detail.",
          rawText: "Primary architecture guidance explains the packet contract in a very long paragraph. ".repeat(12),
          scope: "packet-budget",
          qualifiers: ["bounded context", "packet budget", "retry loop"],
          tags: ["project/multi-agent-brain", "domain/retrieval"],
          stalenessClass: "current",
          provenance: {
            noteId: "packet-budget-1",
            notePath: "context_brain/architecture/packet-budget-1.md",
            headingPath: ["Summary"]
          }
        },
        {
          noteType: "decision",
          score: 0.81,
          summary: "Secondary decision context keeps packets compact. It should be reduced when budgets tighten.",
          rawText: "Secondary decision context keeps packets compact while preserving provenance. ".repeat(10),
          scope: "packet-budget",
          qualifiers: ["compact packets", "provenance"],
          tags: ["project/multi-agent-brain", "domain/retrieval"],
          stalenessClass: "current",
          provenance: {
            noteId: "packet-budget-2",
            notePath: "context_brain/decision/packet-budget-2.md",
            headingPath: ["Decision"]
          }
        },
        {
          noteType: "reference",
          score: 0.74,
          summary: "Reference material should only survive if room remains in the explicit budget.",
          rawText: "Reference material should only survive if room remains in the explicit budget. ".repeat(8),
          scope: "packet-budget",
          qualifiers: ["budget", "reference"],
          tags: ["project/multi-agent-brain", "domain/retrieval"],
          stalenessClass: "current",
          provenance: {
            noteId: "packet-budget-3",
            notePath: "context_brain/reference/packet-budget-3.md",
            headingPath: ["Reference"]
          }
        }
      ]
    },
    "needs_escalation"
  );

  assert.ok(packetResponse.packet.budgetUsage.tokenEstimate <= 80);
  assert.ok(countSummarySentences(packetResponse.packet.summary) <= 1);
  assert.ok(packetResponse.packet.budgetUsage.sourceCount <= 3);
  assert.ok(packetResponse.packet.budgetUsage.rawExcerptCount <= 2);
});

test("retrieve context honors tagFilters across the retrieval pipeline", async (t) => {
  const { container } = await createHarness(t);

  const alpha = await createAndPromote(container, {
    title: "Tag Filter Alpha",
    noteType: "architecture",
    bodyHints: [
      "Shared retrieval query context should match this alpha note.",
      "Tag filters must allow only alpha-tagged context through."
    ],
    scope: "tag-filter-alpha",
    frontmatterOverrides: {
      tags: ["topic/mcp"]
    }
  });
  await createAndPromote(container, {
    title: "Tag Filter Beta",
    noteType: "architecture",
    bodyHints: [
      "Shared retrieval query context should also match this beta note.",
      "Tag filters must exclude beta-tagged context when alpha is requested."
    ],
    scope: "tag-filter-beta",
    frontmatterOverrides: {
      tags: ["topic/docker"]
    }
  });

  const result = await container.services.retrieveContextService.retrieveContext({
    actor: actor("retrieval"),
    query: "shared retrieval query context",
    budget: {
      maxTokens: 320,
      maxSources: 3,
      maxRawExcerpts: 1,
      maxSummarySentences: 2
    },
    corpusIds: ["context_brain"],
    tagFilters: ["topic/mcp"],
    requireEvidence: false
  });

  assert.equal(result.ok, true);
  assert.ok(result.data.candidateCounts.lexical > 0);
  assert.ok(result.data.packet.evidence.length >= 1);
  assert.ok(
    result.data.packet.evidence.every((source) => source.noteId === alpha.promotedNoteId)
  );
});

test("retrieve context warns when bounded evidence includes expired notes", async (t) => {
  const { container } = await createHarness(t);
  const today = currentDateIso();

  await createAndPromote(container, {
    title: "Expired Retrieval Guidance",
    noteType: "architecture",
    bodyHints: [
      "Expired retrieval guidance should still be visible as expired when selected.",
      "Freshness warnings should call this out explicitly."
    ],
    scope: "expired-retrieval-guidance",
    promoteAsCurrentState: true,
    frontmatterOverrides: {
      validFrom: addDaysIso(today, -14),
      validUntil: addDaysIso(today, -1)
    }
  });

  const result = await container.services.retrieveContextService.retrieveContext({
    actor: actor("retrieval"),
    query: "freshness warnings should call this out explicitly",
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
  assert.ok(result.data.packet.evidence.length >= 1);
  assert.ok(
    result.warnings?.some((warning) => /expired note/i.test(warning))
  );
});

test("retrieve context warns when bounded evidence is approaching expiry", async (t) => {
  const { container } = await createHarness(t);
  const today = currentDateIso();

  await createAndPromote(container, {
    title: "Expiring Retrieval Guidance",
    noteType: "architecture",
    bodyHints: [
      "Expiring retrieval guidance should warn before the note becomes stale.",
      "Freshness warnings should mention expiring-soon evidence explicitly."
    ],
    scope: "expiring-retrieval-guidance",
    promoteAsCurrentState: true,
    frontmatterOverrides: {
      validFrom: addDaysIso(today, -7),
      validUntil: addDaysIso(today, 2)
    }
  });

  const result = await container.services.retrieveContextService.retrieveContext({
    actor: actor("retrieval"),
    query: "freshness warnings should mention expiring-soon evidence explicitly",
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
  assert.ok(result.data.packet.evidence.length >= 1);
  assert.ok(
    result.warnings?.some((warning) => /expiring within 14 days/i.test(warning))
  );
});

test("retrieve context uses the paid escalation provider to enrich uncertainty when local evidence is insufficient", async (t) => {
  const { container } = await createHarness(t);

  const retrieveContextService = new application.RetrieveContextService({
    lexicalIndex: container.ports.lexicalIndex,
    metadataControlStore: container.ports.metadataControlStore,
    vectorIndex: container.ports.vectorIndex,
    embeddingProvider: container.ports.embeddingProvider,
    localReasoningProvider: container.ports.localReasoningProvider,
    paidEscalationProvider: {
      providerId: "paid-escalation-test",
      async classifyIntent() {
        return "fact_lookup";
      },
      async assessAnswerability() {
        return "needs_escalation";
      },
      async summarizeUncertainty(query, evidence) {
        assert.equal(query, "unmapped query with no local evidence");
        assert.deepEqual(evidence, []);
        return "Escalate to the paid provider for authoritative synthesis.";
      }
    },
    rerankerProvider: container.ports.rerankerProvider
  });

  const result = await retrieveContextService.retrieveContext({
    actor: actor("retrieval"),
    query: "unmapped query with no local evidence",
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
  assert.equal(result.data.packet.answerability, "needs_escalation");
  assert.ok(
    result.data.packet.uncertainties.includes(
      "Escalate to the paid provider for authoritative synthesis."
    )
  );
  assert.ok(
    result.warnings?.includes(
      "Paid escalation provider enriched the uncertainty summary."
    )
  );
});

test("retrieve context surfaces degraded vector mode explicitly while continuing lexical retrieval", async (t) => {
  const { container } = await createHarness(t);

  await createAndPromote(container, {
    title: "Vector Degraded Fallback",
    noteType: "architecture",
    bodyHints: [
      "Lexical retrieval should still answer when vector mode is degraded.",
      "Degraded vector telemetry should surface as a warning."
    ],
    scope: "vector-degraded-warning"
  });

  const retrieveContextService = new application.RetrieveContextService({
    lexicalIndex: container.ports.lexicalIndex,
    metadataControlStore: container.ports.metadataControlStore,
    vectorIndex: {
      async upsertEmbeddings() {},
      async removeByNoteId() {},
      async search() {
        return [];
      },
      getHealthSnapshot() {
        return {
          status: "degraded",
          softFail: true,
          consecutiveFailures: 3,
          lastError: "Qdrant search_points failed with status 503.",
          lastFailureAt: new Date().toISOString(),
          degradedSince: new Date().toISOString(),
          details: {
            baseUrl: "http://127.0.0.1:6333/",
            collectionName: "context_brain_chunks_test"
          }
        };
      }
    },
    embeddingProvider: container.ports.embeddingProvider,
    localReasoningProvider: container.ports.localReasoningProvider,
    rerankerProvider: container.ports.rerankerProvider
  });

  const result = await retrieveContextService.retrieveContext({
    actor: actor("retrieval"),
    query: "degraded vector telemetry should surface as a warning",
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
  assert.ok(result.data.packet.evidence.length >= 1);
  assert.ok(
    result.warnings?.includes(
      "Vector retrieval is degraded; lexical retrieval remains active."
    )
  );
});

test("runtime health reports degraded vector state explicitly", async (t) => {
  const { env } = await createHarness(t);

  const report = await runRuntimeHealthChecks(env, "live", {
    vectorHealth: {
      status: "degraded",
      softFail: true,
      consecutiveFailures: 2,
      lastError: "Qdrant search_points failed with status 503.",
      lastFailureAt: new Date().toISOString(),
      degradedSince: new Date().toISOString(),
      details: {
        baseUrl: env.qdrantUrl,
        collectionName: env.qdrantCollection
      }
    }
  });

  assert.equal(report.status, "degraded");
  const qdrantCheck = report.checks.find((check) => check.name === "qdrant_vector_store");
  assert.ok(qdrantCheck);
  assert.equal(qdrantCheck.status, "warn");
  assert.equal(qdrantCheck.details?.vectorHealth?.status, "degraded");
});

test("runtime health reports expired temporal validity state explicitly", async (t) => {
  const { env } = await createHarness(t);

  const report = await runRuntimeHealthChecks(env, "live", {
    temporalValidity: {
      asOf: currentDateIso(),
      expiringWithinDays: 14,
      expiredCurrentStateNotes: 2,
      futureDatedCurrentStateNotes: 0,
      expiringSoonCurrentStateNotes: 1
    }
  });

  assert.equal(report.status, "degraded");
  const temporalCheck = report.checks.find((check) => check.name === "temporal_validity");
  assert.ok(temporalCheck);
  assert.equal(temporalCheck.status, "warn");
  assert.equal(temporalCheck.details?.expiredCurrentStateNotes, 2);
});

test("sqlite-backed adapters share a reference-counted connection lifecycle", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mab-sqlite-shared-"));
  const sqlitePath = path.join(root, "state", "multi-agent-brain.sqlite");
  const metadataStore = new SqliteMetadataControlStore(sqlitePath);
  const auditLog = new SqliteAuditLog(sqlitePath);
  const lexicalIndex = new SqliteFtsIndex(sqlitePath);

  t.after(async () => {
    lexicalIndex.close();
    auditLog.close();
    metadataStore.close();
    await rm(root, { recursive: true, force: true });
  });

  const noteId = randomUUID();
  await metadataStore.upsertNote({
    noteId,
    corpusId: "context_brain",
    notePath: "context_brain/architecture/sqlite-shared-lifecycle.md",
    noteType: "architecture",
    lifecycleState: "promoted",
    revision: currentDateIso(),
    updatedAt: currentDateIso(),
    currentState: false,
    summary: "Shared SQLite lifecycle test.",
    scope: "sqlite-shared-lifecycle",
    tags: ["project/multi-agent-brain"],
    contentHash: "sha256:test",
    semanticSignature: "sqlite-shared-lifecycle"
  });

  auditLog.close();

  const duplicates = await metadataStore.findPotentialDuplicates({
    corpusId: "context_brain",
    contentHash: "sha256:test"
  });
  assert.equal(duplicates.length, 1);

  await lexicalIndex.upsertChunks([
    {
      chunkId: "sqlite-shared-lifecycle-chunk",
      noteId,
      corpusId: "context_brain",
      noteType: "architecture",
      notePath: "context_brain/architecture/sqlite-shared-lifecycle.md",
      headingPath: ["Summary"],
      rawText: "Shared SQLite lifecycle should keep the remaining adapters alive.",
      summary: "Shared SQLite lifecycle remains available.",
      entities: [],
      qualifiers: [],
      scope: "sqlite-shared-lifecycle",
      tags: ["project/multi-agent-brain"],
      stalenessClass: "current",
      tokenEstimate: 12,
      updatedAt: currentDateIso()
    }
  ]);

  const lexicalHits = await lexicalIndex.search({
    query: "remaining adapters alive",
    corpusIds: ["context_brain"],
    limit: 5,
    includeSuperseded: true
  });
  assert.ok(lexicalHits.length >= 1);
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

test("schema validation blocks inverted temporal validity windows", async (t) => {
  const { container } = await createHarness(t);
  const noteId = randomUUID();

  const validation = container.services.noteValidationService.validate({
    actor: actor("orchestrator"),
    targetCorpus: "context_brain",
    notePath: "context_brain/reference/invalid-validity-window.md",
    validationMode: "promotion",
    frontmatter: {
      noteId,
      title: "Invalid Validity Window",
      project: "multi-agent-brain",
      type: "reference",
      status: "promoted",
      updated: currentDateIso(),
      summary: "Temporal windows must be ordered.",
      tags: ["project/multi-agent-brain", "domain/metadata", "status/promoted"],
      scope: "validation",
      corpusId: "context_brain",
      currentState: false,
      validFrom: "2026-04-10",
      validUntil: "2026-04-01"
    },
    body: "## Summary\n\nWindow.\n\n## Details\n\nWindow.\n\n## Sources\n\n- none"
  });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.violations.some(
      (issue) => issue.field === "frontmatter.validUntil"
    )
  );
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
      scope: input.scope,
      ...input.frontmatterOverrides
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

function addDaysIso(dateIso, days) {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function countSummarySentences(value) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .length;
}
