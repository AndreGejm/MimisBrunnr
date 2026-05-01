#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildServiceContainer } from "../../packages/infrastructure/dist/index.js";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "tests",
  "eval",
  "retrieval-quality.fixtures.jsonl"
);
const OUTPUT_PATH = path.join(
  process.cwd(),
  "state",
  "eval",
  "retrieval-quality-last.json"
);
const DEFAULT_BUDGET = {
  maxTokens: 1800,
  maxSources: 5,
  maxRawExcerpts: 1,
  maxSummarySentences: 4
};

const options = parseOptions(process.argv.slice(2));
const fixtures = await loadFixtures(FIXTURE_PATH);
const root = await mkdtemp(path.join(os.tmpdir(), "mimir-retrieval-eval-"));
const container = buildServiceContainer({
  nodeEnv: "test",
  vaultRoot: path.join(root, "vault", "canonical"),
  stagingRoot: path.join(root, "vault", "staging"),
  sqlitePath: path.join(root, "state", "mimisbrunnr.sqlite"),
  qdrantUrl: "http://127.0.0.1:6333",
  qdrantCollection: `retrieval_eval_${randomUUID().slice(0, 8)}`,
  qdrantSoftFail: true,
  embeddingProvider: "hash",
  reasoningProvider: "heuristic",
  draftingProvider: "disabled",
  rerankerProvider: "local",
  logLevel: "error"
});

const records = [];
let failed = false;

try {
  for (const fixture of fixtures) {
    const record = await runFixture(fixture);
    records.push(record);
    if (!record.passed) {
      failed = true;
    }
  }
} finally {
  container.dispose?.();
  await rm(root, { recursive: true, force: true });
}

const report = {
  generatedAt: new Date().toISOString(),
  fixtureCount: fixtures.length,
  shadowMode: {
    hierarchical: options.shadowHierarchical
  },
  passedCount: records.filter((record) => record.passed).length,
  failedCount: records.filter((record) => !record.passed).length,
  records
};

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failed) {
  process.exitCode = 1;
}

async function runFixture(fixture) {
  await seedCanonicalNotes(fixture);
  const sessionId = fixture.includeSessionArchives
    ? `eval-session-${randomUUID()}`
    : undefined;
  if (sessionId) {
    await container.orchestrator.createSessionArchive({
      actor: actor("operator", "create_session_archive"),
      sessionId,
      messages: (fixture.sessionMessages ?? []).map((content) => ({
        role: "assistant",
        content
      }))
    });
  }

  const result = await container.orchestrator.assembleAgentContext({
    actor: actor("retrieval", "assemble_agent_context"),
    query: fixture.query,
    corpusIds: fixture.targetCorpora,
    budget: fixture.budget ?? DEFAULT_BUDGET,
    includeSessionArchives: Boolean(sessionId),
    sessionId,
    includeTrace: true
  });

  if (!result.ok) {
    return {
      name: fixture.name,
      passed: false,
      errors: [result.error.message],
      retrievalHealth: "unavailable"
    };
  }

  const text = result.data.contextBlock.toLowerCase();
  const errors = [];
  for (const term of fixture.expected) {
    if (!text.includes(term.toLowerCase())) {
      errors.push(`Missing expected term '${term}'.`);
    }
  }
  for (const term of fixture.forbidden ?? []) {
    if (text.includes(term.toLowerCase())) {
      errors.push(`Forbidden term '${term}' appeared in assembled context.`);
    }
  }

  const health = result.data.retrievalHealth?.status ?? "unknown";
  if (health === "unhealthy") {
    errors.push("Retrieval health is unhealthy.");
  }
  if (health === "degraded" && !fixture.allowDegraded) {
    errors.push("Retrieval health is degraded and fixture does not allow fallback.");
  }
  const comparison = options.shadowHierarchical
    ? await compareFlatAndHierarchical(fixture, fixture.budget ?? DEFAULT_BUDGET)
    : undefined;
  if (comparison?.errors.length) {
    errors.push(...comparison.errors);
  }

  return {
    name: fixture.name,
    passed: errors.length === 0,
    errors,
    retrievalHealth: health,
    tokenEstimate: result.data.tokenEstimate,
    truncated: result.data.truncated,
    sourceSummary: result.data.sourceSummary,
    ...(comparison ? { shadowComparison: comparison.report } : {})
  };
}

async function compareFlatAndHierarchical(fixture, budget) {
  const baseRequest = {
    actor: actor("retrieval", "retrieve_context"),
    query: fixture.query,
    corpusIds: fixture.targetCorpora,
    budget,
    tagFilters: fixture.tagFilters,
    includeSuperseded: fixture.includeSuperseded,
    requireEvidence: true,
    includeTrace: true
  };
  const flat = await container.services.retrieveContextService.retrieveContext({
    ...baseRequest,
    strategy: "flat"
  });
  const hierarchical = await container.services.retrieveContextService.retrieveContext({
    ...baseRequest,
    strategy: "hierarchical"
  });
  const hierarchicalRepeat = await container.services.retrieveContextService.retrieveContext({
    ...baseRequest,
    actor: actor("retrieval", "retrieve_context_repeat"),
    strategy: "hierarchical"
  });

  const errors = [];
  if (!flat.ok) {
    errors.push(`Flat shadow retrieval failed: ${flat.error.message}`);
  }
  if (!hierarchical.ok) {
    errors.push(`Hierarchical shadow retrieval failed: ${hierarchical.error.message}`);
  }
  if (!hierarchicalRepeat.ok) {
    errors.push(`Hierarchical repeat retrieval failed: ${hierarchicalRepeat.error.message}`);
  }

  if (!flat.ok || !hierarchical.ok || !hierarchicalRepeat.ok) {
    return {
      errors,
      report: {
        enabled: true,
        flatAvailable: flat.ok,
        hierarchicalAvailable: hierarchical.ok
      }
    };
  }

  const flatMetrics = await buildRetrievalMetrics(flat.data, budget);
  const hierarchicalMetrics = await buildRetrievalMetrics(hierarchical.data, budget);
  const overlap = selectedEvidenceOverlap(
    flat.data.packet.evidence,
    hierarchical.data.packet.evidence
  );
  const traceDeterminism = {
    hierarchical:
      traceSignature(hierarchical.data.trace) ===
      traceSignature(hierarchicalRepeat.data.trace)
  };

  const packetBudgetViolations = [
    ...flatMetrics.packetBudgetViolations.map((violation) => `flat:${violation}`),
    ...hierarchicalMetrics.packetBudgetViolations.map((violation) => `hierarchical:${violation}`)
  ];
  if (packetBudgetViolations.length > 0) {
    errors.push(
      `Packet budget violations detected: ${packetBudgetViolations.join(", ")}.`
    );
  }
  if (!traceDeterminism.hierarchical) {
    errors.push("Hierarchical retrieval trace is not deterministic for a repeated request.");
  }

  return {
    errors,
    report: {
      enabled: true,
      returnedPacketStrategy: "flat",
      comparedStrategy: "hierarchical",
      flat: flatMetrics,
      hierarchical: hierarchicalMetrics,
      selectedEvidenceOverlap: overlap,
      traceDeterminism
    }
  };
}

async function buildRetrievalMetrics(data, budget) {
  const evidenceRisk = await summarizeEvidenceRisk(data.packet.evidence);

  return {
    answerability: data.packet.answerability,
    tokenEstimate: data.packet.budgetUsage.tokenEstimate,
    selectedEvidenceCount: data.packet.evidence.length,
    packetBudgetViolations: packetBudgetViolations(data.packet.budgetUsage, budget),
    staleOrSupersededEvidenceRate: evidenceRisk.staleOrSupersededEvidenceRate,
    staleOrSupersededEvidenceCount: evidenceRisk.staleOrSupersededEvidenceCount,
    expiredEvidenceCount: evidenceRisk.expiredEvidenceCount,
    futureDatedEvidenceCount: evidenceRisk.futureDatedEvidenceCount,
    retrievalHealth: data.retrievalHealth?.status ?? "unknown",
    traceSignature: traceSignature(data.trace)
  };
}

async function summarizeEvidenceRisk(evidence) {
  const chunkIds = evidence.map((item) => item.chunkId).filter(Boolean);
  if (chunkIds.length === 0) {
    return {
      staleOrSupersededEvidenceCount: 0,
      staleOrSupersededEvidenceRate: 0,
      expiredEvidenceCount: 0,
      futureDatedEvidenceCount: 0
    };
  }

  const chunks = await container.ports.metadataControlStore.getChunksByIds(chunkIds);
  const today = currentDateIso();
  const staleOrSuperseded = chunks.filter((chunk) =>
    ["stale", "superseded"].includes(chunk.stalenessClass)
  );
  const expired = chunks.filter((chunk) =>
    Boolean(chunk.validUntil && chunk.validUntil < today)
  );
  const futureDated = chunks.filter((chunk) =>
    Boolean(chunk.validFrom && chunk.validFrom > today)
  );

  return {
    staleOrSupersededEvidenceCount: staleOrSuperseded.length,
    staleOrSupersededEvidenceRate:
      chunks.length === 0 ? 0 : Number((staleOrSuperseded.length / chunks.length).toFixed(4)),
    expiredEvidenceCount: expired.length,
    futureDatedEvidenceCount: futureDated.length
  };
}

function selectedEvidenceOverlap(flatEvidence, hierarchicalEvidence) {
  const flatNoteIds = [...new Set(flatEvidence.map((item) => item.noteId))];
  const hierarchicalNoteIds = [...new Set(hierarchicalEvidence.map((item) => item.noteId))];
  const hierarchicalSet = new Set(hierarchicalNoteIds);
  const sharedNoteIds = flatNoteIds.filter((noteId) => hierarchicalSet.has(noteId));
  const union = new Set([...flatNoteIds, ...hierarchicalNoteIds]);

  return {
    sharedNoteIds,
    flatOnlyNoteIds: flatNoteIds.filter((noteId) => !hierarchicalSet.has(noteId)),
    hierarchicalOnlyNoteIds: hierarchicalNoteIds.filter((noteId) => !flatNoteIds.includes(noteId)),
    overlapRate: union.size === 0 ? 1 : Number((sharedNoteIds.length / union.size).toFixed(4))
  };
}

function packetBudgetViolations(usage, budget) {
  const violations = [];
  if (usage.tokenEstimate > budget.maxTokens) {
    violations.push("tokenEstimate");
  }
  if (usage.sourceCount > budget.maxSources) {
    violations.push("sourceCount");
  }
  if (usage.rawExcerptCount > budget.maxRawExcerpts) {
    violations.push("rawExcerptCount");
  }
  return violations;
}

function traceSignature(trace) {
  if (!trace) {
    return "trace:none";
  }

  return JSON.stringify({
    strategy: trace.strategy,
    events: (trace.events ?? []).map((event) => ({
      stage: event.stage,
      count: event.count
    })),
    packetDiff: {
      deliveredEvidenceCount: trace.packetDiff?.deliveredEvidenceCount,
      selectedEvidenceNoteIds: trace.packetDiff?.selectedEvidenceNoteIds ?? []
    }
  });
}

async function seedCanonicalNotes(fixture) {
  const seeds = fixture.seeds ?? [fixture.seed, ...(fixture.additionalSeeds ?? [])];
  for (const seed of seeds) {
    await seedCanonicalNote(fixture, seed);
  }
}

async function seedCanonicalNote(fixture, seed) {
  const noteId = randomUUID();
  const tags = seed.tags ?? ["project/mimir", "domain/retrieval", "status/promoted"];
  const note = {
    noteId,
    corpusId: seed.corpusId ?? fixture.targetCorpora[0],
    notePath: seed.notePath ?? `${seed.corpusId ?? fixture.targetCorpora[0]}/reference/${noteId}.md`,
    revision: "",
    frontmatter: {
      noteId,
      title: seed.title,
      project: "mimir",
      type: seed.noteType ?? "reference",
      status: seed.status ?? "promoted",
      updated: seed.updated ?? currentDateIso(),
      summary: seed.summary,
      tags,
      scope: seed.scope ?? "retrieval-eval",
      corpusId: seed.corpusId ?? fixture.targetCorpora[0],
      currentState: seed.currentState ?? true,
      validFrom: seed.validFrom,
      validUntil: seed.validUntil,
      supersededBy: seed.supersededBy
    },
    body: [
      "## Summary",
      "",
      seed.summary,
      "",
      "## Details",
      "",
      seed.body,
      "",
      "## Sources",
      "",
      "- retrieval eval fixture"
    ].join("\n")
  };

  const result = await container.services.canonicalNoteService.writeCanonicalNote(note);

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  const chunks = container.services.chunkingService.chunkCanonicalNote(result.data);
  await container.ports.metadataControlStore.upsertChunks(chunks);
  await container.ports.lexicalIndex?.upsertChunks(chunks);
}

async function loadFixtures(fixturePath) {
  const content = await readFile(fixturePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const fixture = JSON.parse(line);
      validateFixture(fixture, index + 1);
      return fixture;
    });
}

function validateFixture(fixture, lineNumber) {
  const prefix = `Fixture line ${lineNumber}`;
  if (!fixture.name || !fixture.query) {
    throw new Error(`${prefix} must include name and query.`);
  }
  if (!Array.isArray(fixture.expected) || fixture.expected.length === 0) {
    throw new Error(`${prefix} must include expected terms.`);
  }
  if (!Array.isArray(fixture.targetCorpora) || fixture.targetCorpora.length === 0) {
    throw new Error(`${prefix} must include targetCorpora.`);
  }
  if (!fixture.seed?.title || !fixture.seed?.summary || !fixture.seed?.body) {
    throw new Error(`${prefix} must include seed title, summary, and body.`);
  }
  for (const seed of fixture.seeds ?? fixture.additionalSeeds ?? []) {
    if (!seed.title || !seed.summary || !seed.body) {
      throw new Error(`${prefix} contains an additional seed without title, summary, or body.`);
    }
  }
}

function actor(role, toolName) {
  return {
    actorId: `${role}-eval`,
    actorRole: role,
    transport: "internal",
    source: "retrieval-eval",
    requestId: randomUUID(),
    initiatedAt: new Date().toISOString(),
    toolName
  };
}

function parseOptions(args) {
  return {
    shadowHierarchical: !args.includes("--no-shadow-hierarchical")
  };
}

function currentDateIso() {
  return new Date().toISOString().slice(0, 10);
}
