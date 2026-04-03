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
}

interface OllamaGenerateResponse {
  model?: string;
  response?: string;
  done?: boolean;
}

interface OllamaEmbedResponse {
  model?: string;
  embeddings?: number[][];
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
    const response = await this.requestJson<OllamaEmbedResponse>("/api/embed", {
      model,
      input,
      truncate: true
    });

    if (!response.embeddings || response.embeddings.length === 0) {
      throw new Error("Ollama returned no embeddings.");
    }

    return response.embeddings;
  }

  private async requestJson<T>(relativePath: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImplementation(new URL(relativePath, this.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed with status ${response.status}.`);
    }

    return await response.json() as T;
  }
}
