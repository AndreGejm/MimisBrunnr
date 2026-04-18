export const TOOLBOX_AUDIT_EVENT_TYPES = [
  "toolbox_discovery",
  "toolbox_activation_approved",
  "toolbox_activation_denied",
  "toolbox_lease_issued",
  "toolbox_lease_rejected",
  "toolbox_reconnect_generated",
  "toolbox_deactivated",
  "toolbox_expired"
] as const;

export type ToolboxAuditEventType = (typeof TOOLBOX_AUDIT_EVENT_TYPES)[number];

export interface ToolboxAuditEvent {
  eventId: string;
  type: ToolboxAuditEventType;
  occurredAt: string;
  sessionMode: "legacy-direct" | "toolbox-bootstrap" | "toolbox-activated";
  manifestRevision: string;
  profileId?: string;
  clientId?: string;
  toolboxId?: string;
  leaseId?: string;
  outcome: "accepted" | "rejected" | "partial";
  details?: Record<string, unknown>;
}

export interface ToolboxAuditDiagnostics {
  sessionMode: "legacy-direct" | "toolbox-bootstrap" | "toolbox-activated";
  manifestRevision: string;
  profileId?: string;
  clientId?: string;
  toolboxId?: string;
  leaseId?: string;
  requestedToolbox?: string;
  requiredCategories?: string[];
  approvedToolbox?: string;
  approvedProfile?: string;
  fallbackProfile?: string;
  reasonCode?: string;
}

export interface ToolboxAuditDetail {
  reasonCode?: string;
  sessionMode?: "legacy-direct" | "toolbox-bootstrap" | "toolbox-activated";
  manifestRevision?: string;
  profileId?: string;
  clientId?: string;
  toolboxId?: string;
  leaseId?: string;
  requestedToolbox?: string;
  requiredCategories?: string[];
  approvedToolbox?: string;
  approvedProfile?: string;
  fallbackProfile?: string;
  [key: string]: unknown;
}
