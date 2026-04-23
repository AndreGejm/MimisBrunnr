export type ToolboxMutationLevel = "read" | "write" | "admin";
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
  trustClass: string;
  mutationLevel: ToolboxMutationLevel;
  tools: ToolboxServerToolManifest[];
  dockerRuntime?: ToolboxDockerRuntimeManifest;
}

export interface ToolboxProfileManifest {
  id: string;
  displayName: string;
  sessionMode: ToolboxSessionMode;
  baseProfiles?: string[];
  compositeReason?: string;
  includeServers: string[];
  allowedCategories: string[];
  deniedCategories: string[];
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

export interface CompiledToolboxProfile {
  id: string;
  displayName: string;
  sessionMode: ToolboxSessionMode;
  composite: boolean;
  compositeReason?: string;
  baseProfiles: string[];
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
