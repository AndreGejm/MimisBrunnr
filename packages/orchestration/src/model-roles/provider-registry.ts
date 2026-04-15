import type {
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
  rerankerProviders?: Partial<Record<ModelRole, RerankerProvider>>;
}

export class RoleProviderRegistry {
  private readonly embeddingProviders: Partial<Record<ModelRole, EmbeddingProvider>>;
  private readonly reasoningProviders: Partial<Record<ModelRole, LocalReasoningProvider>>;
  private readonly draftingProviders: Partial<Record<ModelRole, DraftingProvider>>;
  private readonly rerankerProviders: Partial<Record<ModelRole, RerankerProvider>>;

  constructor(options: RoleProviderRegistryOptions = {}) {
    this.embeddingProviders = options.embeddingProviders ?? {};
    this.reasoningProviders = options.reasoningProviders ?? {};
    this.draftingProviders = options.draftingProviders ?? {};
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

  getRerankerProvider(role: ModelRole): RerankerProvider | undefined {
    return this.rerankerProviders[role];
  }
}
