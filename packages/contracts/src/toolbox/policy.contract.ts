import type { ActorRole } from "../common/actor-context.js";

export type ToolboxMutationLevel = "read" | "write" | "admin";
export type ToolboxServerUsageClass = "general" | "docs-only";
export type ToolboxSessionMode = "toolbox-bootstrap" | "toolbox-activated";
export type ToolboxSessionEntryMode =
  | "legacy-direct"
  | "toolbox-bootstrap"
  | "toolbox-activated";

export interface ToolboxCategoryManifest {
  description: string;
  trustClass: string;
  mutationLevel: ToolboxMutationLevel;
}

export interface ToolboxTrustClassManifest {
  level: number;
  description: string;
}

export interface ToolboxServerToolManifest {
  toolId: string;
  displayName: string;
  category: string;
  trustClass: string;
  mutationLevel: ToolboxMutationLevel;
  semanticCapabilityId: string;
}

export type ToolboxRuntimeBindingManifest =
  | {
      kind: "docker-catalog";
      catalogServerId: string;
      blockedReason?: never;
      unsafeCatalogServerIds?: never;
      command?: never;
      args?: never;
      env?: never;
      workingDirectory?: never;
      configTarget?: never;
    }
  | {
      kind: "descriptor-only";
      blockedReason: string;
      catalogServerId?: never;
      unsafeCatalogServerIds?: string[];
      command?: never;
      args?: never;
      env?: never;
      workingDirectory?: never;
      configTarget?: never;
    }
  | {
      kind: "local-stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      workingDirectory?: string;
      configTarget?: "codex-mcp-json";
      catalogServerId?: never;
      blockedReason?: never;
      unsafeCatalogServerIds?: never;
    };

export type ToolboxDockerRuntimeManifest =
  | {
      applyMode: "catalog";
      catalogServerId: string;
      blockedReason?: never;
      unsafeCatalogServerIds?: never;
    }
  | {
      applyMode: "descriptor-only";
      blockedReason: string;
      catalogServerId?: never;
      unsafeCatalogServerIds?: string[];
    };

export interface ToolboxServerManifest {
  id: string;
  displayName: string;
  source: "owned" | "peer";
  kind: "control" | "semantic" | "peer";
  usageClass?: ToolboxServerUsageClass;
  trustClass: string;
  mutationLevel: ToolboxMutationLevel;
  tools: ToolboxServerToolManifest[];
  runtimeBinding?: ToolboxRuntimeBindingManifest;
  dockerRuntime?: ToolboxDockerRuntimeManifest;
}

export interface ToolboxBandContractionManifest {
  taskAware: boolean;
  idleTimeoutSeconds?: number;
  onLeaseExpiry: boolean;
}

export interface ToolboxBandCompatibilityProfileManifest {
  id: string;
  displayName: string;
  additionalBands?: string[];
  sessionMode?: ToolboxSessionMode;
  compositeReason?: string;
  fallbackProfile?: string;
}

export interface ToolboxBandManifest {
  id: string;
  displayName: string;
  trustClass: string;
  mutationLevel: ToolboxMutationLevel;
  autoExpand: boolean;
  requiresApproval: boolean;
  preferredActorRoles?: ActorRole[];
  includeServers: string[];
  allowedCategories: string[];
  deniedCategories: string[];
  contraction: ToolboxBandContractionManifest;
  compatibilityProfiles?: ToolboxBandCompatibilityProfileManifest[];
}

export interface ToolboxWorkflowManifest {
  id: string;
  displayName: string;
  includeBands: string[];
  compositeReason: string;
  fallbackProfile?: string;
  sessionMode?: ToolboxSessionMode;
  preferredActorRoles?: ActorRole[];
  autoExpand?: boolean;
  requiresApproval?: boolean;
  summary?: string;
  exampleTasks?: string[];
}

export interface ToolboxProfileManifest {
  id: string;
  displayName: string;
  sessionMode: ToolboxSessionMode;
  baseProfiles?: string[];
  compositeReason?: string;
  includeBands?: string[];
  includeServers?: string[];
  allowedCategories?: string[];
  deniedCategories?: string[];
  fallbackProfile?: string;
}

export interface ToolboxIntentManifest {
  displayName: string;
  summary: string;
  exampleTasks: string[];
  targetProfile: string;
  trustClass: string;
  requiresApproval: boolean;
  activationMode: "session-switch";
  allowedCategories: string[];
  deniedCategories: string[];
  fallbackProfile?: string;
}

export interface ToolboxClientOverlayManifest {
  id: string;
  displayName: string;
  handoffStrategy?: "env-reconnect" | "manual-env-reconnect";
  handoffPresetRef?: string;
  suppressServerIds?: string[];
  suppressToolIds?: string[];
  suppressCategories?: string[];
  suppressSemanticCapabilities?: string[];
  additionalServerIds?: string[];
}

export interface CompiledToolboxToolDescriptor {
  toolId: string;
  displayName: string;
  category: string;
  trustClass: string;
  mutationLevel: ToolboxMutationLevel;
  semanticCapabilityId: string;
  serverId: string;
  source: ToolboxServerManifest["source"];
  availabilityState: "declared" | "active" | "suppressed";
  suppressionReasons?: string[];
}

export interface CompiledToolboxServer extends ToolboxServerManifest {
  tools: CompiledToolboxToolDescriptor[];
}

export interface CompiledToolboxBand {
  id: string;
  displayName: string;
  trustClass: string;
  mutationLevel: ToolboxMutationLevel;
  autoExpand: boolean;
  requiresApproval: boolean;
  preferredActorRoles: ActorRole[];
  includeServers: string[];
  allowedCategories: string[];
  deniedCategories: string[];
  contraction: ToolboxBandContractionManifest;
  tools: CompiledToolboxToolDescriptor[];
  semanticCapabilities: string[];
  bandRevision: string;
}

export interface CompiledToolboxWorkflow {
  id: string;
  displayName: string;
  includeBands: string[];
  compositeReason: string;
  fallbackProfile?: string;
  sessionMode: ToolboxSessionMode;
  preferredActorRoles: ActorRole[];
  autoExpand: boolean;
  requiresApproval: boolean;
  summary?: string;
  exampleTasks: string[];
  workflowRevision: string;
}

export interface CompiledToolboxProfile {
  id: string;
  displayName: string;
  sessionMode: ToolboxSessionMode;
  composite: boolean;
  compositeReason?: string;
  baseProfiles: string[];
  includeBands: string[];
  includeServers: string[];
  allowedCategories: string[];
  deniedCategories: string[];
  fallbackProfile?: string;
  tools: CompiledToolboxToolDescriptor[];
  semanticCapabilities: string[];
  profileRevision: string;
}

export interface CompiledToolboxIntent extends ToolboxIntentManifest {
  id: string;
}

export interface CompiledToolboxClientOverlay {
  id: string;
  displayName: string;
  handoffStrategy: "env-reconnect" | "manual-env-reconnect";
  handoffPresetRef?: string;
  suppressServerIds: string[];
  suppressToolIds: string[];
  suppressCategories: string[];
  suppressedSemanticCapabilities: string[];
}

export interface CompiledToolboxPolicy {
  manifestRevision: string;
  sourceDirectory: string;
  categories: Record<string, ToolboxCategoryManifest>;
  trustClasses: Record<string, ToolboxTrustClassManifest>;
  servers: Record<string, CompiledToolboxServer>;
  bands: Record<string, CompiledToolboxBand>;
  workflows: Record<string, CompiledToolboxWorkflow>;
  profiles: Record<string, CompiledToolboxProfile>;
  intents: Record<string, CompiledToolboxIntent>;
  clients: Record<string, CompiledToolboxClientOverlay>;
}

export interface RuntimeCommandToolboxPolicy {
  allOfCategories: string[];
  anyOfCategories?: string[];
  minimumTrustClass: string;
  mutationLevel: ToolboxMutationLevel;
}

export interface ToolboxSessionLeaseClaims {
  version: 1;
  leaseId?: string;
  sessionId: string;
  issuer: string;
  audience: string;
  clientId: string;
  approvedProfile: string;
  approvedCategories: string[];
  deniedCategories: string[];
  trustClass: string;
  manifestRevision: string;
  profileRevision: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}
