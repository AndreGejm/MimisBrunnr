import type { EmbeddingProvider } from "../ports/embedding-provider.js";
import type { MetadataControlStore } from "../ports/metadata-control-store.js";
import type { VectorIndex } from "../ports/vector-index.js";
import type { NoteType } from "@mimir/domain";
import type { RetrieveContextRequest } from "@mimir/contracts";
import type { ScoredChunkCandidate } from "./retrieval-candidate.js";

export class VectorRetrievalService {
  constructor(
    private readonly vectorIndex: VectorIndex,
    private readonly metadataControlStore: MetadataControlStore,
    private readonly embeddingProvider?: EmbeddingProvider
  ) {}

  async search(
    request: RetrieveContextRequest,
    noteTypePriority: NoteType[],
    limit: number
  ): Promise<ScoredChunkCandidate[]> {
    if (!this.embeddingProvider) {
      return [];
    }

    const queryEmbedding = await this.embeddingProvider.embedText(request.query);
    const hits = await this.vectorIndex.search({
      queryEmbedding,
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
        vectorScore: hit.score,
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
