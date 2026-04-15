import type {
  VectorIndex,
  VectorIndexHealthSnapshot,
  VectorSearchHit
} from "@mimir/application";
import type {
  ChunkStalenessClass,
  CorpusId,
  NoteId,
  NoteType
} from "@mimir/domain";

type FetchImplementation = typeof fetch;
type VectorDistance = "Cosine" | "Dot" | "Euclid";

interface QdrantVectorIndexOptions {
  baseUrl: string;
  collectionName: string;
  distance?: VectorDistance;
  fetchImplementation?: FetchImplementation;
  softFail?: boolean;
}

export class QdrantVectorIndex implements VectorIndex {
  private readonly baseUrl: string;
  private readonly collectionName: string;
  private readonly distance: VectorDistance;
  private readonly fetchImplementation: FetchImplementation;
  private readonly softFail: boolean;
  private collectionVectorSize?: number;
  private healthSnapshot: VectorIndexHealthSnapshot;

  constructor(options: QdrantVectorIndexOptions) {
    this.baseUrl = options.baseUrl.endsWith("/")
      ? options.baseUrl
      : `${options.baseUrl}/`;
    this.collectionName = options.collectionName;
    this.distance = options.distance ?? "Cosine";
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.softFail = options.softFail ?? true;
    this.healthSnapshot = {
      status: "healthy",
      softFail: this.softFail,
      consecutiveFailures: 0,
      details: {
        baseUrl: this.baseUrl,
        collectionName: this.collectionName
      }
    };
  }

  async upsertEmbeddings(input: {
    chunkId: string;
    noteId: NoteId;
    embedding: number[];
    corpusId: CorpusId;
    noteType: NoteType;
    stalenessClass: ChunkStalenessClass;
    updatedAt: string;
  }[]): Promise<void> {
    if (input.length === 0) {
      return;
    }

    const ensured = await this.ensureCollection(input[0].embedding.length);
    if (!ensured) {
      return;
    }

    const response = await this.requestJson("/points?wait=true", {
      operation: "upsert_points",
      method: "PUT",
      body: {
        points: input.map((entry) => ({
          id: entry.chunkId,
          vector: entry.embedding,
          payload: {
            chunk_id: entry.chunkId,
            note_id: entry.noteId,
            corpus_id: entry.corpusId,
            note_type: entry.noteType,
            staleness_class: entry.stalenessClass,
            updated_at: entry.updatedAt
          }
        }))
      }
    });

    if (!response && !this.softFail) {
      throw new Error("Qdrant embedding upsert failed.");
    }
  }

  async removeByNoteId(noteId: NoteId): Promise<void> {
    const response = await this.requestJson("/points/delete?wait=true", {
      operation: "delete_points",
      method: "POST",
      body: {
        filter: {
          must: [
            {
              key: "note_id",
              match: { value: noteId }
            }
          ]
        }
      }
    });

    if (!response && !this.softFail) {
      throw new Error(`Failed to delete Qdrant points for note '${noteId}'.`);
    }
  }

  async search(input: {
    queryEmbedding: number[];
    corpusIds: CorpusId[];
    noteTypes?: NoteType[];
    limit: number;
    includeSuperseded: boolean;
  }): Promise<VectorSearchHit[]> {
    if (input.queryEmbedding.length === 0 || input.limit <= 0 || input.corpusIds.length === 0) {
      return [];
    }

    const ensured = await this.ensureCollection(input.queryEmbedding.length);
    if (!ensured) {
      return [];
    }

    const response = await this.requestJson<QdrantSearchResponse>("/points/search", {
      operation: "search_points",
      method: "POST",
      body: {
        vector: input.queryEmbedding,
        limit: input.limit,
        with_payload: false,
        with_vector: false,
        filter: buildSearchFilter(input.corpusIds, input.noteTypes, input.includeSuperseded)
      }
    });

    return extractSearchResults(response).map((item) => ({
      chunkId: String(item.id),
      score: Number(item.score) || 0
    }));
  }

  getHealthSnapshot(): VectorIndexHealthSnapshot {
    return {
      ...this.healthSnapshot,
      details: {
        ...this.healthSnapshot.details,
        baseUrl: this.baseUrl,
        collectionName: this.collectionName
      }
    };
  }

  private async ensureCollection(vectorSize: number): Promise<boolean> {
    if (this.collectionVectorSize === vectorSize) {
      return true;
    }

    const existing = await this.requestJson<QdrantCollectionResponse>("", {
      operation: "get_collection",
      method: "GET"
    });

    if (existing?.result) {
      const existingSize = extractVectorSize(existing);
      if (existingSize && existingSize !== vectorSize) {
        if (this.softFail) {
          this.recordFailure(
            `Qdrant collection '${this.collectionName}' uses vector size ${existingSize}, expected ${vectorSize}.`
          );
          return false;
        }

        throw new Error(
          `Qdrant collection '${this.collectionName}' uses vector size ${existingSize}, expected ${vectorSize}.`
        );
      }

      this.collectionVectorSize = existingSize ?? vectorSize;
      return true;
    }

    const created = await this.requestJson("", {
      operation: "create_collection",
      method: "PUT",
      body: {
        vectors: {
          size: vectorSize,
          distance: this.distance
        }
      }
    });

    if (!created) {
      return false;
    }

    this.collectionVectorSize = vectorSize;
    return true;
  }

  private async requestJson<T = unknown>(
    relativePath: string,
    init: {
      operation: string;
      method: "GET" | "POST" | "PUT";
      body?: unknown;
    }
  ): Promise<T | null> {
    try {
      const url = new URL(
        `collections/${this.collectionName}${relativePath}`,
        this.baseUrl
      );
      const response = await this.fetchImplementation(url, {
        method: init.method,
        headers: {
          "content-type": "application/json"
        },
        body: init.body ? JSON.stringify(init.body) : undefined
      });

      if (!response.ok) {
        this.recordFailure(
          `Qdrant ${init.operation} failed with status ${response.status}.`
        );
        if (this.softFail) {
          return null;
        }

        throw new Error(`Qdrant request failed with status ${response.status}.`);
      }

      const payload = await response.json() as T;
      this.recordSuccess();
      return payload;
    } catch (error) {
      this.recordFailure(
        error instanceof Error
          ? `Qdrant ${init.operation} failed: ${error.message}`
          : `Qdrant ${init.operation} failed: ${String(error)}`
      );
      if (this.softFail) {
        return null;
      }

      throw error;
    }
  }

  private recordSuccess(): void {
    this.healthSnapshot = {
      status: "healthy",
      softFail: this.softFail,
      consecutiveFailures: 0,
      lastSuccessAt: new Date().toISOString(),
      details: {
        baseUrl: this.baseUrl,
        collectionName: this.collectionName
      }
    };
  }

  private recordFailure(message: string): void {
    const now = new Date().toISOString();
    const wasDegraded = this.healthSnapshot.status === "degraded";
    this.healthSnapshot = {
      status: "degraded",
      softFail: this.softFail,
      consecutiveFailures: this.healthSnapshot.consecutiveFailures + 1,
      lastError: message,
      lastFailureAt: now,
      lastSuccessAt: this.healthSnapshot.lastSuccessAt,
      degradedSince: wasDegraded ? this.healthSnapshot.degradedSince ?? now : now,
      details: {
        baseUrl: this.baseUrl,
        collectionName: this.collectionName
      }
    };
  }
}

function buildSearchFilter(
  corpusIds: CorpusId[],
  noteTypes: NoteType[] | undefined,
  includeSuperseded: boolean
): Record<string, unknown> {
  const must: Record<string, unknown>[] = [
    {
      key: "corpus_id",
      match: { any: corpusIds }
    }
  ];

  if (noteTypes && noteTypes.length > 0) {
    must.push({
      key: "note_type",
      match: { any: noteTypes }
    });
  }

  const filter: Record<string, unknown> = { must };
  if (!includeSuperseded) {
    filter.must_not = [
      {
        key: "staleness_class",
        match: { value: "superseded" }
      }
    ];
  }

  return filter;
}

function extractVectorSize(
  response: QdrantCollectionResponse
): number | undefined {
  const vectors = response.result?.config?.params?.vectors;
  if (!vectors) {
    return undefined;
  }

  if (typeof vectors === "object" && "size" in vectors && typeof vectors.size === "number") {
    return vectors.size;
  }

  const firstVector = Object.values(vectors)[0];
  if (
    firstVector &&
    typeof firstVector === "object" &&
    "size" in firstVector &&
    typeof firstVector.size === "number"
  ) {
    return firstVector.size;
  }

  return undefined;
}

function extractSearchResults(
  response: QdrantSearchResponse | null
): QdrantSearchPoint[] {
  if (!response?.result) {
    return [];
  }

  if (Array.isArray(response.result)) {
    return response.result;
  }

  return Array.isArray(response.result.points) ? response.result.points : [];
}

interface QdrantSearchPoint {
  id: string | number;
  score: number;
}

interface QdrantSearchResponse {
  result?: QdrantSearchPoint[] | { points?: QdrantSearchPoint[] };
}

interface QdrantCollectionResponse {
  result?: {
    config?: {
      params?: {
        vectors?: {
          size?: number;
          [key: string]: unknown;
        } | Record<string, { size?: number }>;
      };
    };
  };
}
