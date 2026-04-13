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

const fixtures = await loadFixtures(FIXTURE_PATH);
const root = await mkdtemp(path.join(os.tmpdir(), "mab-retrieval-eval-"));
const container = buildServiceContainer({
  nodeEnv: "test",
  vaultRoot: path.join(root, "vault", "canonical"),
  stagingRoot: path.join(root, "vault", "staging"),
  sqlitePath: path.join(root, "state", "multi-agent-brain.sqlite"),
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
  await seedCanonicalNote(fixture);
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
    budget: {
      maxTokens: 1800,
      maxSources: 5,
      maxRawExcerpts: 1,
      maxSummarySentences: 4
    },
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

  return {
    name: fixture.name,
    passed: errors.length === 0,
    errors,
    retrievalHealth: health,
    tokenEstimate: result.data.tokenEstimate,
    truncated: result.data.truncated,
    sourceSummary: result.data.sourceSummary
  };
}

async function seedCanonicalNote(fixture) {
  const noteId = randomUUID();
  const note = {
    noteId,
    corpusId: fixture.targetCorpora[0],
    notePath: `${fixture.targetCorpora[0]}/reference/${noteId}.md`,
    revision: "",
    frontmatter: {
      noteId,
      title: fixture.seed.title,
      project: "multi-agent-brain",
      type: "reference",
      status: "promoted",
      updated: new Date().toISOString().slice(0, 10),
      summary: fixture.seed.summary,
      tags: ["project/multi-agent-brain", "domain/retrieval", "status/promoted"],
      scope: "retrieval-eval",
      corpusId: fixture.targetCorpora[0],
      currentState: false
    },
    body: [
      "## Summary",
      "",
      fixture.seed.summary,
      "",
      "## Details",
      "",
      fixture.seed.body,
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
