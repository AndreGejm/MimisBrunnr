import type {
  DraftingProvider,
  EmbeddingProvider,
  LocalReasoningProvider,
  RerankerProvider
} from "@mimir/application";
import type { ModelRoleBinding } from "@mimir/orchestration";
import type { AppEnvironment } from "../config/env.js";
import { HashEmbeddingProvider } from "./hash-embedding-provider.js";
import { HeuristicLocalReasoningProvider } from "./heuristic-local-reasoning-provider.js";
import { HeuristicRerankerProvider } from "./heuristic-reranker-provider.js";
import { OpenAiCompatibleLocalReasoningProvider } from "./openai-compatible-local-reasoning-provider.js";
import { OllamaDraftingProvider } from "./ollama-drafting-provider.js";
import { OllamaEmbeddingProvider } from "./ollama-embedding-provider.js";
import { OllamaLocalReasoningProvider } from "./ollama-local-reasoning-provider.js";
import { OllamaRerankerProvider } from "./ollama-reranker-provider.js";

export interface ProviderFactoryContext {
  env: AppEnvironment;
  binding: ModelRoleBinding;
}

export type EmbeddingProviderFactory = (
  context: ProviderFactoryContext
) => EmbeddingProvider | undefined;
export type ReasoningProviderFactory = (
  context: ProviderFactoryContext
) => LocalReasoningProvider | undefined;
export type DraftingProviderFactory = (
  context: ProviderFactoryContext
) => DraftingProvider | undefined;
export type RerankerProviderFactory = (
  context: ProviderFactoryContext
) => RerankerProvider | undefined;

type ProviderFamily = "embedding" | "reasoning" | "drafting" | "reranker";

type ProviderFactory<TProvider> = (
  context: ProviderFactoryContext
) => TProvider | undefined;

export class ProviderFactoryRegistry {
  private readonly embeddingFactories = new Map<string, EmbeddingProviderFactory>();
  private readonly reasoningFactories = new Map<string, ReasoningProviderFactory>();
  private readonly draftingFactories = new Map<string, DraftingProviderFactory>();
  private readonly rerankerFactories = new Map<string, RerankerProviderFactory>();

  registerEmbedding(
    providerId: string,
    factory: EmbeddingProviderFactory
  ): this {
    this.embeddingFactories.set(providerId, factory);
    return this;
  }

  registerReasoning(
    providerId: string,
    factory: ReasoningProviderFactory
  ): this {
    this.reasoningFactories.set(providerId, factory);
    return this;
  }

  registerDrafting(
    providerId: string,
    factory: DraftingProviderFactory
  ): this {
    this.draftingFactories.set(providerId, factory);
    return this;
  }

  registerReranker(
    providerId: string,
    factory: RerankerProviderFactory
  ): this {
    this.rerankerFactories.set(providerId, factory);
    return this;
  }

  createEmbedding(context: ProviderFactoryContext): EmbeddingProvider | undefined {
    return this.resolveFactory(
      this.embeddingFactories,
      context.binding.providerId,
      "embedding"
    )(context);
  }

  createReasoning(
    context: ProviderFactoryContext
  ): LocalReasoningProvider | undefined {
    return this.resolveFactory(
      this.reasoningFactories,
      context.binding.providerId,
      "reasoning"
    )(context);
  }

  createDrafting(context: ProviderFactoryContext): DraftingProvider | undefined {
    return this.draftingFactories.get(context.binding.providerId)?.(context);
  }

  createReranker(context: ProviderFactoryContext): RerankerProvider | undefined {
    return this.resolveFactory(
      this.rerankerFactories,
      context.binding.providerId,
      "reranker"
    )(context);
  }

  private resolveFactory<TProvider>(
    factories: Map<string, ProviderFactory<TProvider>>,
    providerId: string,
    family: ProviderFamily
  ): ProviderFactory<TProvider> {
    const factory = factories.get(providerId);
    if (!factory) {
      throw new Error(`Unsupported ${family} provider '${providerId}'.`);
    }

    return factory;
  }
}

export function buildDefaultProviderFactoryRegistry(): ProviderFactoryRegistry {
  return new ProviderFactoryRegistry()
    .registerEmbedding("disabled", () => undefined)
    .registerEmbedding("internal_hash", () => new HashEmbeddingProvider())
    .registerEmbedding("docker_ollama", ({ binding, env }) =>
      new OllamaEmbeddingProvider({
        baseUrl: env.providerEndpoints.dockerOllamaBaseUrl,
        model: binding.modelId ?? env.ollamaEmbeddingModel,
        fallback: env.disableProviderFallbacks
          ? undefined
          : new HashEmbeddingProvider()
      })
    )
    .registerReasoning("disabled", () => undefined)
    .registerReasoning(
      "internal_heuristic",
      () => new HeuristicLocalReasoningProvider()
    )
    .registerReasoning("docker_ollama", ({ binding, env }) =>
      new OllamaLocalReasoningProvider({
        baseUrl: env.providerEndpoints.dockerOllamaBaseUrl,
        model: binding.modelId ?? env.ollamaReasoningModel,
        temperature: binding.temperature,
        seed: binding.seed,
        maxOutputTokens: binding.maxOutputTokens,
        timeoutMs: binding.timeoutMs,
        fallback: env.disableProviderFallbacks
          ? undefined
          : new HeuristicLocalReasoningProvider()
      })
    )
    .registerReasoning("paid_openai_compat", ({ binding, env }) => {
      if (!env.providerEndpoints.paidEscalationBaseUrl || !binding.modelId) {
        return undefined;
      }

      return new OpenAiCompatibleLocalReasoningProvider({
        baseUrl: env.providerEndpoints.paidEscalationBaseUrl,
        apiKey: env.providerEndpoints.paidEscalationApiKey,
        model: binding.modelId,
        temperature: binding.temperature,
        seed: binding.seed,
        maxOutputTokens: binding.maxOutputTokens,
        timeoutMs: binding.timeoutMs,
        fallback: env.disableProviderFallbacks
          ? undefined
          : new HeuristicLocalReasoningProvider()
      });
    })
    .registerDrafting("disabled", () => undefined)
    .registerDrafting("docker_ollama", ({ binding, env }) =>
      new OllamaDraftingProvider({
        baseUrl: env.providerEndpoints.dockerOllamaBaseUrl,
        model: binding.modelId ?? env.ollamaDraftingModel,
        temperature: binding.temperature,
        seed: binding.seed,
        maxOutputTokens: binding.maxOutputTokens,
        timeoutMs: binding.timeoutMs
      })
    )
    .registerReranker("disabled", () => undefined)
    .registerReranker(
      "internal_heuristic",
      () => new HeuristicRerankerProvider()
    )
    .registerReranker("docker_ollama", ({ binding, env }) =>
      new OllamaRerankerProvider({
        baseUrl: env.providerEndpoints.dockerOllamaBaseUrl,
        model: binding.modelId ?? "qwen3-reranker",
        temperature: binding.temperature,
        seed: binding.seed,
        maxOutputTokens: binding.maxOutputTokens,
        timeoutMs: binding.timeoutMs,
        fallback: env.disableProviderFallbacks
          ? undefined
          : new HeuristicRerankerProvider()
      })
    );
}