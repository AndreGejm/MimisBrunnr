import {
  DEFAULT_CONTEXT_BUDGET,
  type ContextBudget,
  type RetrieveContextRequest,
  type RetrieveContextResponse,
  type RetrieveContextStrategy
} from "@mimir/contracts";

export interface RetrieveContextCacheEntry {
  data: RetrieveContextResponse;
  warnings?: string[];
}

export interface RetrieveContextCache {
  get(key: string): RetrieveContextCacheEntry | undefined;
  set(key: string, entry: RetrieveContextCacheEntry): void;
  clear(): void;
}

export class InMemoryRetrieveContextCache implements RetrieveContextCache {
  private readonly entries = new Map<string, RetrieveContextCacheEntry>();

  constructor(private readonly maxEntries = 128) {}

  get(key: string): RetrieveContextCacheEntry | undefined {
    const entry = this.entries.get(key);
    return entry ? cloneCacheEntry(entry) : undefined;
  }

  set(key: string, entry: RetrieveContextCacheEntry): void {
    if (this.maxEntries <= 0) {
      return;
    }

    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, cloneCacheEntry(entry));

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) {
        return;
      }
      this.entries.delete(oldestKey);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export function buildRetrieveContextCacheKey(
  request: RetrieveContextRequest,
  strategy: RetrieveContextStrategy
): string {
  const budget = normalizeBudget(request.budget);
  return stableStringify({
    actorRole: request.actor.actorRole,
    actorSource: request.actor.source,
    actorToolName: request.actor.toolName ?? null,
    actorTransport: request.actor.transport,
    allowedCorpora: normalizeList(request.actor.allowedCorpora ?? []),
    budget,
    corpusIds: normalizeList(request.corpusIds),
    includeSuperseded: request.includeSuperseded ?? false,
    includeTrace: request.includeTrace ?? false,
    intentHint: request.intentHint ?? null,
    noteTypePriority: request.noteTypePriority ?? null,
    query: normalizeQuery(request.query),
    requireEvidence: request.requireEvidence ?? false,
    strategy,
    tagFilters: normalizeList(request.tagFilters ?? []),
    toolboxProfileId: request.actor.toolboxProfileId ?? null,
    toolboxSessionMode: request.actor.toolboxSessionMode ?? null
  });
}

function normalizeBudget(budget: ContextBudget | undefined): ContextBudget {
  return budget ?? DEFAULT_CONTEXT_BUDGET;
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortKeys(nested)])
    );
  }

  return value;
}

function cloneCacheEntry(entry: RetrieveContextCacheEntry): RetrieveContextCacheEntry {
  return {
    data: structuredClone(entry.data),
    warnings: entry.warnings ? [...entry.warnings] : undefined
  };
}
