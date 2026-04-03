import type { EmbeddingProvider } from "@multi-agent-brain/application";
import { OllamaClient } from "./ollama-client.js";

interface OllamaEmbeddingProviderOptions {
  baseUrl: string;
  model: string;
  fallback?: EmbeddingProvider;
  fetchImplementation?: typeof fetch;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly providerId: string;
  private readonly client: OllamaClient;

  constructor(
    private readonly options: OllamaEmbeddingProviderOptions
  ) {
    this.providerId = `ollama-embedding:${options.model}`;
    this.client = new OllamaClient({
      baseUrl: options.baseUrl,
      fetchImplementation: options.fetchImplementation
    });
  }

  async embedText(text: string): Promise<number[]> {
    const [embedding] = await this.embedTexts([text]);
    return embedding;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    try {
      return await this.client.embed(this.options.model, texts);
    } catch (error) {
      if (!this.options.fallback) {
        throw error;
      }

      return this.options.fallback.embedTexts(texts);
    }
  }
}
