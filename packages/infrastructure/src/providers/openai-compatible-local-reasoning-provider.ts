import type { LocalReasoningProvider } from "@multi-agent-brain/application";
import type {
  AnswerabilityDisposition,
  QueryIntent
} from "@multi-agent-brain/domain";
import type { ContextCandidate } from "@multi-agent-brain/contracts";

interface OpenAiCompatibleLocalReasoningProviderOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  seed?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  fallback?: LocalReasoningProvider;
  fetchImplementation?: typeof fetch;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{
        type?: string;
        text?: string;
      }>;
    };
  }>;
}

type IntentPayload = { intent: QueryIntent };
type AnswerabilityPayload = { answerability: AnswerabilityDisposition };
type UncertaintyPayload = { summary: string };

class OpenAiCompatibleHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "OpenAiCompatibleHttpError";
  }
}

export class OpenAiCompatibleLocalReasoningProvider implements LocalReasoningProvider {
  readonly providerId: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly options: OpenAiCompatibleLocalReasoningProviderOptions
  ) {
    this.providerId = `openai-compat-reasoning:${options.model}`;
    this.baseUrl = options.baseUrl.endsWith("/")
      ? options.baseUrl
      : `${options.baseUrl}/`;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async classifyIntent(query: string): Promise<QueryIntent> {
    try {
      const result = await this.generateJson<IntentPayload>({
        system: [
          "You classify engineering memory-retrieval queries.",
          "Return JSON only: {\"intent\":\"fact_lookup|decision_lookup|implementation_guidance|status_timeline|debugging|architecture_recall\"}."
        ].join(" "),
        prompt: `Query: ${query}`
      });

      if (result.intent) {
        return result.intent;
      }

      throw new Error("Missing intent in paid escalation response.");
    } catch (error) {
      if (!this.options.fallback) {
        throw error;
      }

      return this.options.fallback.classifyIntent(query);
    }
  }

  async assessAnswerability(input: {
    query: string;
    intent: QueryIntent;
    candidates: ContextCandidate[];
  }): Promise<AnswerabilityDisposition> {
    try {
      const evidence = input.candidates.slice(0, 4).map((candidate) => ({
        noteType: candidate.noteType,
        score: Number(candidate.score.toFixed(3)),
        summary: candidate.summary,
        scope: candidate.scope,
        stalenessClass: candidate.stalenessClass,
        notePath: candidate.provenance.notePath
      }));

      const result = await this.generateJson<AnswerabilityPayload>({
        system: [
          "You assess whether local context can answer a retrieval query.",
          "Return JSON only: {\"answerability\":\"local_answer|partial|needs_escalation\"}.",
          "Prefer needs_escalation if evidence is stale, weak, or contradictory."
        ].join(" "),
        prompt: JSON.stringify(
          {
            query: input.query,
            intent: input.intent,
            evidence
          },
          null,
          2
        )
      });

      if (result.answerability) {
        return result.answerability;
      }

      throw new Error("Missing answerability in paid escalation response.");
    } catch (error) {
      if (!this.options.fallback) {
        throw error;
      }

      return this.options.fallback.assessAnswerability(input);
    }
  }

  async summarizeUncertainty(query: string, evidence: string[]): Promise<string> {
    try {
      const result = await this.generateJson<UncertaintyPayload>({
        system: [
          "You produce a single sentence describing remaining uncertainty in local retrieval.",
          "Return JSON only: {\"summary\":\"...\"}."
        ].join(" "),
        prompt: JSON.stringify(
          {
            query,
            evidence: evidence.slice(0, 5)
          },
          null,
          2
        )
      });

      if (result.summary?.trim()) {
        return result.summary.trim();
      }

      throw new Error("Missing uncertainty summary in paid escalation response.");
    } catch (error) {
      if (!this.options.fallback) {
        throw error;
      }

      return this.options.fallback.summarizeUncertainty(query, evidence);
    }
  }

  private async generateJson<T>(input: {
    system: string;
    prompt: string;
  }): Promise<T> {
    const response = await this.fetchImplementation(
      new URL("chat/completions", this.baseUrl),
      {
        method: "POST",
        headers: buildHeaders(this.options.apiKey),
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.prompt }
          ],
          temperature: this.options.temperature ?? 0,
          max_tokens: this.options.maxOutputTokens ?? 256,
          seed: this.options.seed ?? 42,
          response_format: {
            type: "json_object"
          }
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      }
    );

    if (!response.ok) {
      throw new OpenAiCompatibleHttpError(
        response.status,
        `OpenAI-compatible reasoning request failed with status ${response.status}.`
      );
    }

    const payload = await response.json() as OpenAiChatCompletionResponse;
    const content = extractMessageContent(payload);
    if (!content) {
      throw new Error("OpenAI-compatible reasoning provider returned no content.");
    }

    return JSON.parse(content) as T;
  }
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (apiKey?.trim()) {
    headers.authorization = `Bearer ${apiKey.trim()}`;
  }

  return headers;
}

function extractMessageContent(response: OpenAiChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }

  return "";
}
