import { withBoundedProviderRetry } from "@multi-agent-brain/application";

type FetchImplementation = typeof fetch;

interface OllamaClientOptions {
  baseUrl: string;
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
}

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  format?: "json" | Record<string, unknown>;
  keepAlive?: string | number;
  raw?: boolean;
  options?: Record<string, unknown>;
}

interface OllamaGenerateResponse {
  model?: string;
  response?: string;
  done?: boolean;
}

interface OpenAiEmbeddingsResponse {
  data?: Array<{
    embedding?: number[];
  }>;
}

interface OllamaEmbedResponse {
  model?: string;
  embeddings?: number[][];
}

class OllamaHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "OllamaHttpError";
  }
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;

  constructor(options: OllamaClientOptions) {
    this.baseUrl = options.baseUrl.endsWith("/")
      ? options.baseUrl
      : `${options.baseUrl}/`;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async generateJson<T>(request: OllamaGenerateRequest): Promise<T> {
    const response = await this.requestJson<OllamaGenerateResponse>("/api/generate", {
      ...request,
      stream: false
    });
    const payload = response.response?.trim();

    if (!payload) {
      throw new Error("Ollama returned an empty JSON response payload.");
    }

    return JSON.parse(payload) as T;
  }

  async embed(model: string, input: string | string[]): Promise<number[][]> {
    const openAiRequestBody = {
      model,
      input
    };
    const ollamaRequestBody = {
      model,
      input,
      truncate: true
    };

    try {
      const response = await this.requestJson<OpenAiEmbeddingsResponse>(
          "/engines/v1/embeddings",
          openAiRequestBody
      );
      const embeddings = extractEmbeddings(response);
      if (embeddings.length > 0) {
        return embeddings;
      }
    } catch (error) {
      if (!(error instanceof OllamaHttpError) || error.status !== 404) {
        throw error;
      }
    }

    try {
      const response = await this.requestJson<OpenAiEmbeddingsResponse>(
          "/engines/llama.cpp/v1/embeddings",
          openAiRequestBody
      );
      const embeddings = extractEmbeddings(response);
      if (embeddings.length > 0) {
        return embeddings;
      }
    } catch (error) {
      if (!(error instanceof OllamaHttpError) || error.status !== 404) {
        throw error;
      }
    }

    try {
      const response = await this.requestJson<OllamaEmbedResponse>(
          "/api/embeddings",
          ollamaRequestBody
      );
      const embeddings = extractEmbeddings(response);
      if (embeddings.length > 0) {
        return embeddings;
      }
    } catch (error) {
      if (!(error instanceof OllamaHttpError) || error.status !== 404) {
        throw error;
      }
    }

    try {
      const response = await this.requestJson<OllamaEmbedResponse>(
          "/api/embed",
          ollamaRequestBody
      );
      const embeddings = extractEmbeddings(response);
      if (embeddings.length > 0) {
        return embeddings;
      }
    } catch (error) {
      if (!(error instanceof OllamaHttpError) || error.status !== 404) {
        throw error;
      }
    }

    throw new Error("Local model API returned no embeddings.");
  }

  private async requestJson<T>(relativePath: string, body: Record<string, unknown>): Promise<T> {
    return withBoundedProviderRetry(async () => {
      const response = await this.fetchImplementation(new URL(relativePath, this.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (!response.ok) {
        throw new OllamaHttpError(
          response.status,
          `Ollama request failed with status ${response.status}.`
        );
      }

      return await response.json() as T;
    });
  }
}

function extractEmbeddings(
  response: OpenAiEmbeddingsResponse | OllamaEmbedResponse
): number[][] {
  if ("embeddings" in response && Array.isArray(response.embeddings)) {
    return response.embeddings;
  }

  if ("data" in response && Array.isArray(response.data)) {
    return response.data
      .map((item) => item.embedding)
      .filter((embedding): embedding is number[] => Array.isArray(embedding));
  }

  return [];
}
