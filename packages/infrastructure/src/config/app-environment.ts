import type {
  ActorAuthorizationMode,
  ActorRegistryEntry,
  ModelRole,
  ModelRoleBinding
} from "@mimir/orchestration";
import type { ReleaseMetadata } from "./release-metadata.js";

export interface AppEnvironment {
  nodeEnv: "development" | "test" | "production";
  release: ReleaseMetadata;
  vaultRoot: string;
  stagingRoot: string;
  importAllowedRoots?: string[];
  sqlitePath: string;
  qdrantUrl: string;
  qdrantCollection: string;
  qdrantSoftFail: boolean;
  ollamaBaseUrl: string;
  ollamaEmbeddingModel: string;
  ollamaReasoningModel: string;
  ollamaDraftingModel: string;
  embeddingProvider: "disabled" | "hash" | "ollama";
  reasoningProvider: "disabled" | "heuristic" | "ollama";
  draftingProvider: "disabled" | "ollama";
  rerankerProvider: "disabled" | "local" | "ollama";
  disableProviderFallbacks: boolean;
  providerEndpoints: {
    dockerOllamaBaseUrl: string;
    paidEscalationBaseUrl?: string;
    paidEscalationApiKey?: string;
  };
  roleBindings: Record<ModelRole, ModelRoleBinding>;
  toolRegistryDir: string;
  toolboxManifestDir: string;
  toolboxActiveProfile?: string;
  toolboxClientId?: string;
  toolboxSessionMode: "legacy-direct" | "toolbox-bootstrap" | "toolbox-activated";
  toolboxSessionEnforcement: "off" | "audit" | "enforced";
  toolboxLeaseIssuer: string;
  toolboxLeaseAudience: string;
  toolboxLeaseIssuerSecret?: string;
  codingRuntimePythonExecutable: string;
  codingRuntimePythonPath: string;
  codingRuntimeModule: string;
  codingRuntimeTimeoutMs: number;
  apiHost: string;
  apiPort: number;
  logLevel: "debug" | "info" | "warn" | "error";
  auth: {
    mode: ActorAuthorizationMode;
    allowAnonymousInternal: boolean;
    actorRegistryPath?: string;
    actorRegistry: ActorRegistryEntry[];
    issuerSecret?: string;
    issuedTokenRequireRegistryMatch: boolean;
    issuedTokenRevocationPath?: string;
    revokedIssuedTokenIds: string[];
  };
}
