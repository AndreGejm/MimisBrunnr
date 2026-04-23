import type {
  CodingAdvisoryProvider,
  DraftingProvider,
  EmbeddingProvider,
  LocalReasoningProvider,
  RerankerProvider
} from "@mimir/application";
import type { ModelRole } from "./model-role-registry.js";

interface RoleProviderRegistryOptions {
  embeddingProviders?: Partial<Record<ModelRole, EmbeddingProvider>>;
  reasoningProviders?: Partial<Record<ModelRole, LocalReasoningProvider>>;
  draftingProviders?: Partial<Record<ModelRole, DraftingProvider>>;
  codingAdvisoryProviders?: Partial<Record<ModelRole, CodingAdvisoryProvider>>;
  rerankerProviders?: Partial<Record<ModelRole, RerankerProvider>>;
}

export class RoleProviderRegistry {
  private readonly embeddingProviders: Partial<Record<ModelRole, EmbeddingProvider>>;
  private readonly reasoningProviders: Partial<Record<ModelRole, LocalReasoningProvider>>;
  private readonly draftingProviders: Partial<Record<ModelRole, DraftingProvider>>;
  private readonly codingAdvisoryProviders: Partial<Record<ModelRole, CodingAdvisoryProvider>>;
  private readonly rerankerProviders: Partial<Record<ModelRole, RerankerProvider>>;

  constructor(options: RoleProviderRegistryOptions = {}) {
    this.embeddingProviders = options.embeddingProviders ?? {};
    this.reasoningProviders = options.reasoningProviders ?? {};
    this.draftingProviders = options.draftingProviders ?? {};
    this.codingAdvisoryProviders = options.codingAdvisoryProviders ?? {};
    this.rerankerProviders = options.rerankerProviders ?? {};
  }

  getEmbeddingProvider(role: ModelRole): EmbeddingProvider | undefined {
    return this.embeddingProviders[role];
  }

  getReasoningProvider(role: ModelRole): LocalReasoningProvider | undefined {
    return this.reasoningProviders[role];
  }

  getDraftingProvider(role: ModelRole): DraftingProvider | undefined {
    return this.draftingProviders[role];
  }

  getCodingAdvisoryProvider(role: ModelRole): CodingAdvisoryProvider | undefined {
    return this.codingAdvisoryProviders[role];
  }

  getRerankerProvider(role: ModelRole): RerankerProvider | undefined {
    return this.rerankerProviders[role];
  }
}
