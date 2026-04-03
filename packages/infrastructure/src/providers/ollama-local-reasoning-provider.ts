import type { LocalReasoningProvider } from "@multi-agent-brain/application";
import type {
  AnswerabilityDisposition,
  QueryIntent
} from "@multi-agent-brain/domain";
import type { ContextCandidate } from "@multi-agent-brain/contracts";
import { OllamaClient } from "./ollama-client.js";

interface OllamaLocalReasoningProviderOptions {
  baseUrl: string;
  model: string;
  fallback?: LocalReasoningProvider;
  fetchImplementation?: typeof fetch;
}

type IntentPayload = { intent: QueryIntent };
type AnswerabilityPayload = { answerability: AnswerabilityDisposition };
type UncertaintyPayload = { summary: string };

export class OllamaLocalReasoningProvider implements LocalReasoningProvider {
  readonly providerId: string;
  private readonly client: OllamaClient;

  constructor(
    private readonly options: OllamaLocalReasoningProviderOptions
  ) {
    this.providerId = `ollama-reasoning:${options.model}`;
    this.client = new OllamaClient({
      baseUrl: options.baseUrl,
      fetchImplementation: options.fetchImplementation
    });
  }

  async classifyIntent(query: string): Promise<QueryIntent> {
    try {
      const result = await this.client.generateJson<IntentPayload>({
        model: this.options.model,
        system: [
          "You classify engineering memory-retrieval queries.",
          "Return JSON only: {\"intent\":\"fact_lookup|decision_lookup|implementation_guidance|status_timeline|debugging|architecture_recall\"}."
        ].join(" "),
        prompt: `Query: ${query}`,
        format: "json",
        raw: false
      });

      if (result.intent) {
        return result.intent;
      }
      throw new Error("Missing intent in Ollama response.");
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

      const result = await this.client.generateJson<AnswerabilityPayload>({
        model: this.options.model,
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
        ),
        format: "json",
        raw: false
      });

      if (result.answerability) {
        return result.answerability;
      }
      throw new Error("Missing answerability in Ollama response.");
    } catch (error) {
      if (!this.options.fallback) {
        throw error;
      }

      return this.options.fallback.assessAnswerability(input);
    }
  }

  async summarizeUncertainty(query: string, evidence: string[]): Promise<string> {
    try {
      const result = await this.client.generateJson<UncertaintyPayload>({
        model: this.options.model,
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
        ),
        format: "json",
        raw: false
      });

      if (result.summary?.trim()) {
        return result.summary.trim();
      }
      throw new Error("Missing uncertainty summary in Ollama response.");
    } catch (error) {
      if (!this.options.fallback) {
        throw error;
      }

      return this.options.fallback.summarizeUncertainty(query, evidence);
    }
  }
}
