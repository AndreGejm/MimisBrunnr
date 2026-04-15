import type { LexicalIndex } from "../ports/lexical-index.js";
import type { MetadataControlStore } from "../ports/metadata-control-store.js";
import type { NoteType } from "@mimir/domain";
import type { RetrieveContextRequest } from "@mimir/contracts";
import type { ScoredChunkCandidate } from "./retrieval-candidate.js";

export class LexicalRetrievalService {
  constructor(
    private readonly lexicalIndex: LexicalIndex,
    private readonly metadataControlStore: MetadataControlStore
  ) {}

  async search(
    request: RetrieveContextRequest,
    noteTypePriority: NoteType[],
    limit: number
  ): Promise<ScoredChunkCandidate[]> {
    const hits = await this.lexicalIndex.search({
      query: request.query,
      corpusIds: request.corpusIds,
      noteTypes: noteTypePriority,
      limit,
      includeSuperseded: request.includeSuperseded ?? false
    });

    if (hits.length === 0) {
      return [];
    }

    const chunks = await this.metadataControlStore.getChunksByIds(
      hits.map((hit) => hit.chunkId)
    );
    const chunkById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));

    return hits.flatMap((hit) => {
      const chunk = chunkById.get(hit.chunkId);
      if (!chunk) {
        return [];
      }

      if (!matchesTagFilters(chunk.tags, request.tagFilters)) {
        return [];
      }

      return [{
        chunk,
        noteType: chunk.noteType,
        score: hit.score,
        fusedScore: hit.score,
        lexicalScore: hit.score,
        summary: chunk.summary,
        rawText: chunk.rawText,
        scope: chunk.scope,
        qualifiers: chunk.qualifiers,
        tags: chunk.tags,
        stalenessClass: chunk.stalenessClass,
        validFrom: chunk.validFrom,
        validUntil: chunk.validUntil,
        provenance: {
          noteId: chunk.noteId,
          chunkId: chunk.chunkId,
          notePath: chunk.notePath,
          headingPath: chunk.headingPath
        }
      }];
    });
  }
}

function matchesTagFilters(
  tags: readonly string[],
  tagFilters: readonly string[] | undefined
): boolean {
  if (!tagFilters || tagFilters.length === 0) {
    return true;
  }

  return tagFilters.every((tagFilter) => tags.includes(tagFilter));
}
