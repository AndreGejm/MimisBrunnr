import type {
  ToolboxAuditDiagnostics,
  ToolboxAuditEvent
} from "./audit.contract.js";
import type {
  ToolboxSessionEntryMode,
  ToolboxSessionMode,
  CompiledToolboxToolDescriptor,
  ToolboxServerUsageClass
} from "./policy.contract.js";

export interface ToolboxApprovalGrant {
  grantedBy: string;
  grantedAt?: string;
  reason?: string;
  toolboxId?: string;
}

export interface ToolboxHandoffLeaseDescriptor {
  issued: boolean;
  leaseId: string | null;
  reasonCode?: string;
  issuedAt?: string;
  expiresAt?: string;
  sessionPolicyTokenField?: "leaseToken";
  sessionPolicyTokenEnvVar?: "MAB_TOOLBOX_SESSION_POLICY_TOKEN";
}

export interface ToolboxClientMaterializationDescriptor {
  format: "codex-mcp-json";
  path: string;
  serverUsageClasses?: Record<string, ToolboxServerUsageClass>;
}

export interface ToolboxSessionHandoff {
  mode: "reconnect";
  targetProfileId: string;
  targetSessionMode: ToolboxSessionMode;
  fallbackProfileId: string;
  downgradeTarget: string;
  clientId: string;
  handoffStrategy: "env-reconnect" | "manual-env-reconnect";
  handoffPresetRef?: string;
  clientPresetRef?: string;
  clientMaterialization?: ToolboxClientMaterializationDescriptor;
  client: {
    id: string;
    displayName: string;
    handoffStrategy: "env-reconnect" | "manual-env-reconnect";
    handoffPresetRef?: string;
    clientPresetRef?: string;
    clientMaterialization?: ToolboxClientMaterializationDescriptor;
  };
  manifestRevision: string;
  profileRevision?: string;
  environment: {
    MAB_TOOLBOX_ACTIVE_PROFILE: string;
    MAB_TOOLBOX_CLIENT_ID: string;
    MAB_TOOLBOX_SESSION_MODE: ToolboxSessionEntryMode;
    MAB_TOOLBOX_SESSION_POLICY_TOKEN?: "{{leaseToken}}";
  };
  clearEnvironment: Array<"MAB_TOOLBOX_SESSION_POLICY_TOKEN">;
  actorDefaults: {
    toolboxSessionMode: ToolboxSessionEntryMode;
    toolboxClientId: string;
    toolboxProfileId: string;
    sessionPolicyTokenFromEnv?: "MAB_TOOLBOX_SESSION_POLICY_TOKEN";
  };
  lease: ToolboxHandoffLeaseDescriptor;
}

export interface ToolboxActivationResponse {
  approved: boolean;
  reasonCode: string;
  clientId: string;
  diagnostics: ToolboxAuditDiagnostics & {
    lease?: ToolboxHandoffLeaseDescriptor;
  };
  details: {
    request: {
      requestedToolbox: string | null;
      requiredCategories: string[];
      taskSummary: string | null;
      clientId: string;
    };
    approval?: {
      toolboxId: string;
      profileId: string;
      trustClass: string;
      requiresApproval: boolean;
      fallbackProfile: string;
      granted?: boolean;
      grantedBy?: string;
      grantedAt?: string;
      reason?: string;
    };
    reconnect: ToolboxSessionHandoff & {
      generated: true;
      reasonCode: string;
    };
    lease?: ToolboxHandoffLeaseDescriptor;
  };
  auditEvents: ToolboxAuditEvent[];
  requestedToolbox: string | null;
  taskSummary: string | null;
  approvedToolbox?: string;
  approvedProfile?: string;
  fallbackProfile: string;
  downgradeTarget: string;
  sessionMode: "reconnect";
  leaseToken?: string | null;
  leaseExpiresAt?: string | null;
  handoff: ToolboxSessionHandoff;
}

export interface ToolboxDeactivationResponse {
  reasonCode: string;
  diagnostics: ToolboxAuditDiagnostics & {
    lease: {
      provided: boolean;
      verified: boolean;
      revoked: boolean;
      leaseId: string | null;
      reasonCode?: string;
    };
  };
  details: {
    lease: {
      provided: boolean;
      verified: boolean;
      revoked: boolean;
      leaseId: string | null;
      reasonCode?: string;
    };
  };
  auditEvents: ToolboxAuditEvent[];
  activeProfile: string;
  downgradeTarget: string;
  sessionMode: "reconnect";
  clientId: string;
  handoff: ToolboxSessionHandoff;
}

export interface ToolboxAntiUseCaseSummary {
  type: "denied_category";
  category: string;
}

export interface ToolboxDiscoveryProfileSummary {
  id: string;
  displayName: string;
  sessionMode: ToolboxSessionMode;
  composite: boolean;
  baseProfiles: string[];
  compositeReason?: string;
  fallbackProfile: string | null;
  profileRevision: string;
}

export interface ToolboxDiscoveryWorkflowSummary {
  activationMode: "session-switch";
  sessionMode: ToolboxSessionMode;
  requiresApproval: boolean;
  fallbackProfile: string | null;
}

export interface ToolboxDescribeEntry {
  id: string;
  displayName: string;
  summary: string;
  exampleTasks: string[];
  targetProfile: string;
  trustClass: string;
  requiresApproval: boolean;
  allowedCategories: string[];
  deniedCategories: string[];
  fallbackProfile: string | null;
  workflow: ToolboxDiscoveryWorkflowSummary;
  profile: ToolboxDiscoveryProfileSummary;
  tools: CompiledToolboxToolDescriptor[];
  suppressedTools: ToolboxSuppressedToolSummary[];
  antiUseCases: ToolboxAntiUseCaseSummary[];
}

export interface ToolboxDescribeResponse {
  reasonCode: "toolbox_discovery";
  diagnostics: ToolboxAuditDiagnostics;
  auditEvents: ToolboxAuditEvent[];
  toolbox: ToolboxDescribeEntry;
}

export interface ToolboxActiveWorkflowSummary {
  toolboxId: string | null;
  activationMode: "session-switch" | null;
  sessionMode: ToolboxSessionMode;
  requiresApproval: boolean;
  fallbackProfile: string | null;
}

export interface ToolboxActiveProfileSummary {
  id: string;
  displayName: string;
  sessionMode: ToolboxSessionMode;
  composite: boolean;
  baseProfiles: string[];
  compositeReason?: string;
  fallbackProfile: string | null;
  allowedCategories: string[];
  deniedCategories: string[];
  semanticCapabilities: string[];
  profileRevision: string;
}

export interface ToolboxActiveClientSummary {
  id: string;
  displayName: string;
  handoffStrategy: "env-reconnect" | "manual-env-reconnect";
  handoffPresetRef?: string;
  clientPresetRef?: string;
  clientMaterialization?: ToolboxClientMaterializationDescriptor;
  suppressServerIds: string[];
  suppressToolIds: string[];
  suppressCategories: string[];
  suppressedSemanticCapabilities: string[];
  suppressedTools: ToolboxSuppressedToolSummary[];
}

export interface ToolboxActiveToolboxResponse {
  workflow: ToolboxActiveWorkflowSummary;
  profile: ToolboxActiveProfileSummary;
  client: ToolboxActiveClientSummary;
}

export interface ToolboxSuppressedToolSummary {
  toolId: string;
  displayName: string;
  serverId: string;
  category: string;
  semanticCapabilityId: string;
  reasons: string[];
  boundary: "client-overlay-reduction";
}
