import type { RerankerProvider } from "@mimir/application";
import type { ContextCandidate } from "@mimir/contracts";
import type { QueryIntent } from "@mimir/domain";
import { OllamaClient } from "./ollama-client.js";

interface OllamaRerankerProviderOptions {
  baseUrl: string;
  model: string;
  temperature?: number;
  seed?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  fallback?: RerankerProvider;
  fetchImplementation?: typeof fetch;
}

type RerankPayload = {
  orderedIndices: number[];
};

export class OllamaRerankerProvider implements RerankerProvider {
  readonly providerId: string;
  private readonly client: OllamaClient;

  constructor(private readonly options: OllamaRerankerProviderOptions) {
    this.providerId = `ollama-reranker:${options.model}`;
    this.client = new OllamaClient({
      baseUrl: options.baseUrl,
      fetchImplementation: options.fetchImplementation,
      timeoutMs: options.timeoutMs
    });
  }

  async rerankCandidates(input: {
    query: string;
    intent: QueryIntent;
    candidates: ContextCandidate[];
    limit: number;
  }): Promise<ContextCandidate[]> {
    try {
      const trimmedCandidates = input.candidates.slice(0, Math.max(input.limit * 2, input.limit));
      const prompt = JSON.stringify(
        {
          query: input.query,
          intent: input.intent,
          limit: input.limit,
          candidates: trimmedCandidates.map((candidate, index) => ({
            index,
            noteType: candidate.noteType,
            score: Number(candidate.score.toFixed(3)),
            summary: candidate.summary,
            scope: candidate.scope,
            qualifiers: candidate.qualifiers,
            stalenessClass: candidate.stalenessClass,
            notePath: candidate.provenance.notePath,
            headingPath: candidate.provenance.headingPath
          }))
        },
        null,
        2
      );

      const result = await this.client.generateJson<RerankPayload>({
        model: this.options.model,
        system: [
          "You rerank retrieval candidates for a bounded engineering context packet.",
          "Return JSON only: {\"orderedIndices\":[0,2,1]}.",
          "Prefer current, precise, implementation-relevant evidence.",
          "Never invent indices and never exceed the requested limit."
        ].join(" "),
        prompt,
        format: "json",
        raw: false,
        options: {
          temperature: this.options.temperature ?? 0,
          seed: this.options.seed ?? 42,
          num_predict: this.options.maxOutputTokens ?? 300
        }
      });

      const ordered = dedupeValidIndices(result.orderedIndices, trimmedCandidates.length)
        .map((index) => trimmedCandidates[index])
        .slice(0, input.limit);

      if (ordered.length > 0) {
        return ordered;
      }

      throw new Error("Ollama reranker returned no valid candidate ordering.");
    } catch (error) {
      if (!this.options.fallback) {
        throw error;
      }

      return this.options.fallback.rerankCandidates(input);
    }
  }
}

function dedupeValidIndices(values: number[] | undefined, max: number): number[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const output: number[] = [];
  const seen = new Set<number>();

  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value >= max || seen.has(value)) {
      continue;
    }

    seen.add(value);
    output.push(value);
  }

  return output;
}
