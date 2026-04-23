import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import * as application from "../../packages/application/dist/index.js";

test("retrieve context reuses cached packets for identical normalized constraints", async () => {
  const chunk = buildChunk();
  let lexicalSearchCalls = 0;
  const cache = buildTestCache();
  const service = new application.RetrieveContextService({
    lexicalIndex: {
      async upsertChunks() {},
      async removeByNoteId() {},
      async search() {
        lexicalSearchCalls += 1;
        return [{
          chunkId: chunk.chunkId,
          score: 0.92,
          matchedTerms: ["cache", "retrieval"]
        }];
      }
    },
    metadataControlStore: {
      async getChunksByIds(chunkIds) {
        return chunkIds.includes(chunk.chunkId) ? [chunk] : [];
      },
      async getChunkNeighborhood(chunkId) {
        return chunkId === chunk.chunkId ? [chunk] : [];
      }
    },
    vectorIndex: {
      async upsertEmbeddings() {},
      async removeByNoteId() {},
      async search() {
        return [];
      },
      getHealthSnapshot() {
        return {
          status: "healthy",
          softFail: true,
          consecutiveFailures: 0
        };
      }
    },
    retrieveContextCache: cache
  });
  const request = {
    actor: actor("retrieval"),
    query: "  Retrieval   cache policy  ",
    budget: {
      maxTokens: 320,
      maxSources: 2,
      maxRawExcerpts: 0,
      maxSummarySentences: 2
    },
    corpusIds: ["mimisbrunnr"],
    tagFilters: ["domain/retrieval"],
    requireEvidence: true
  };

  const first = await service.retrieveContext(request);
  const second = await service.retrieveContext({
    ...request,
    query: "retrieval cache policy",
    corpusIds: ["mimisbrunnr"]
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(lexicalSearchCalls, 1);
  assert.equal(second.data.packet.evidence[0].chunkId, first.data.packet.evidence[0].chunkId);
});

function buildTestCache() {
  const entries = new Map();
  return {
    get(key) {
      return entries.get(key);
    },
    set(key, value) {
      entries.set(key, value);
    },
    clear() {
      entries.clear();
    }
  };
}

function buildChunk() {
  const noteId = randomUUID();
  const chunkId = randomUUID();
  return {
    chunkId,
    noteId,
    corpusId: "mimisbrunnr",
    noteType: "reference",
    notePath: "mimisbrunnr/retrieval/cache-policy.md",
    headingPath: ["Retrieval Cache Policy", "Summary"],
    parentHeading: undefined,
    prevChunkId: undefined,
    nextChunkId: undefined,
    rawText: "Retrieval cache policy reuses bounded context packets for identical constraints.",
    summary: "Retrieval cache policy reuses bounded context packets.",
    entities: ["Retrieval cache"],
    qualifiers: ["cache repeated context packets"],
    scope: "retrieval-cache",
    tags: ["project/mimir", "domain/retrieval"],
    stalenessClass: "current",
    tokenEstimate: 18,
    updatedAt: "2026-04-23"
  };
}

function actor(role) {
  return {
    actorId: `${role}-test`,
    actorRole: role,
    source: "test",
    transport: "internal",
    initiatedAt: new Date().toISOString()
  };
}
