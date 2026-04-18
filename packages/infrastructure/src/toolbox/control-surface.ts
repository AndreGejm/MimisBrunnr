import { randomUUID } from "node:crypto";
import type { AuditHistoryService } from "@mimir/application";
import type {
  CompiledToolboxClientOverlay,
  CompiledToolboxPolicy,
  CompiledToolboxProfile,
  CompiledToolboxToolDescriptor,
  ToolboxActivationResponse,
  ToolboxAuditDetail,
  ToolboxAuditDiagnostics,
  ToolboxAuditEvent,
  ToolboxDeactivationResponse,
  ToolboxSessionHandoff
} from "@mimir/contracts";
import { compileToolboxPolicyFromDirectory } from "./policy-compiler.js";
import {
  assertToolboxSessionLeaseLifecycle,
  issueToolboxSessionLease,
  verifyToolboxSessionLease
} from "./session-lease.js";
import { SqliteToolboxSessionLeaseStore } from "../sqlite/sqlite-toolbox-session-lease-store.js";

interface RequestToolboxActivationInput {
  requestedToolbox?: string;
  requiredCategories?: string[];
  taskSummary?: string;
  clientId?: string;
}

export interface MimirControlSurfaceOptions {
  manifestDirectory: string;
  activeProfileId: string;
  clientId: string;
  auditHistoryService: AuditHistoryService;
  leaseIssuer?: string;
  leaseAudience?: string;
  leaseIssuerSecret?: string;
  leaseStore?: SqliteToolboxSessionLeaseStore;
}

const TOOLBOX_AUDIT_SOURCE = "mimir-toolbox-control-surface";
const TOOLBOX_AUDIT_ACTOR = {
  actorId: "toolbox-control-surface",
  actorRole: "system" as const,
  source: TOOLBOX_AUDIT_SOURCE
};

export class MimirControlSurface {
  readonly policy: CompiledToolboxPolicy;

  constructor(private readonly options: MimirControlSurfaceOptions) {
    this.policy = compileToolboxPolicyFromDirectory(options.manifestDirectory);
    if (!this.policy.profiles[options.activeProfileId]) {
      throw new Error(`Unknown active toolbox profile '${options.activeProfileId}'.`);
    }
    if (!this.policy.clients[options.clientId]) {
      throw new Error(`Unknown toolbox client '${options.clientId}'.`);
    }
  }

  async listToolboxes() {
    const occurredAt = new Date().toISOString();
    const diagnostics = this.buildDiagnostics({
      reasonCode: "toolbox_discovery"
    });
    const auditEvent = this.buildAuditEvent("toolbox_discovery", occurredAt, {
      outcome: "accepted",
      details: this.buildAuditDetails({
        reasonCode: "toolbox_discovery",
        diagnostics
      })
    });
    const response = {
      reasonCode: "toolbox_discovery",
      diagnostics,
      auditEvents: [auditEvent],
      toolboxes: Object.values(this.policy.intents).map((intent) => ({
        id: intent.id,
        displayName: intent.displayName,
        targetProfile: intent.targetProfile,
        trustClass: intent.trustClass,
        requiresApproval: intent.requiresApproval,
        allowedCategories: intent.allowedCategories,
        deniedCategories: intent.deniedCategories,
        fallbackProfile: intent.fallbackProfile
      }))
    };

    return this.withPersistedToolboxAudit("list_toolboxes", response);
  }

  async describeToolbox(toolboxId: string) {
    const toolbox = this.policy.intents[toolboxId];
    if (!toolbox) {
      throw new Error(`Unknown toolbox '${toolboxId}'.`);
    }

    const profile = this.policy.profiles[toolbox.targetProfile];
    const occurredAt = new Date().toISOString();
    const diagnostics = this.buildDiagnostics({
      toolboxId: toolbox.id,
      profileId: profile.id,
      approvedProfile: profile.id,
      fallbackProfile: toolbox.fallbackProfile,
      reasonCode: "toolbox_discovery"
    });
    const auditEvent = this.buildAuditEvent("toolbox_discovery", occurredAt, {
      outcome: "accepted",
      toolboxId: toolbox.id,
      profileId: toolbox.targetProfile,
      details: this.buildAuditDetails({
        toolboxId: toolbox.id,
        profileId: toolbox.targetProfile,
        reasonCode: "toolbox_discovery",
        diagnostics
      })
    });
    const response = {
      reasonCode: "toolbox_discovery",
      diagnostics,
      auditEvents: [auditEvent],
      toolbox: {
        id: toolbox.id,
        displayName: toolbox.displayName,
        targetProfile: toolbox.targetProfile,
        trustClass: toolbox.trustClass,
        requiresApproval: toolbox.requiresApproval,
        allowedCategories: toolbox.allowedCategories,
        deniedCategories: toolbox.deniedCategories,
        fallbackProfile: toolbox.fallbackProfile,
        tools: this.buildToolVisibilityReport(
          profile,
          this.policy.clients[this.options.clientId]
        ).activeTools,
        antiUseCases: toolbox.deniedCategories.map((category) => ({
          type: "denied_category",
          category
        }))
      }
    };

    return this.withPersistedToolboxAudit("describe_toolbox", response);
  }

  async requestToolboxActivation(input: RequestToolboxActivationInput) {
    const toolbox = this.resolveRequestedToolbox(input);
    const occurredAt = new Date().toISOString();
    const requestedCategories = input.requiredCategories ?? [];
    const approvedClientId = input.clientId ?? this.options.clientId;
    const baseDiagnostics = this.buildDiagnostics({
      reasonCode: "toolbox_activation",
      requestedToolbox: input.requestedToolbox,
      requiredCategories: requestedCategories,
      clientId: approvedClientId
    });

    if (!toolbox) {
      const reasonCode = "toolbox_activation_denied_no_matching_toolbox";
      const handoff = this.buildSessionHandoff({
        profile: this.policy.profiles.bootstrap,
        clientId: approvedClientId,
        fallbackProfile: "bootstrap",
        lease: {
          issued: false,
          leaseId: null,
          reasonCode
        }
      });
      const diagnostics = {
        ...baseDiagnostics,
        reasonCode,
        fallbackProfile: "bootstrap"
      };
      const auditEvent = this.buildAuditEvent("toolbox_activation_denied", occurredAt, {
        outcome: "rejected",
        details: this.buildAuditDetails({
          reasonCode,
          diagnostics,
          requestedToolbox: input.requestedToolbox,
          requiredCategories: requestedCategories
        })
      });
      const response: ToolboxActivationResponse = {
        approved: false,
        reasonCode,
        clientId: approvedClientId,
        diagnostics,
        details: {
          request: {
            requestedToolbox: input.requestedToolbox ?? null,
            requiredCategories: requestedCategories,
            taskSummary: input.taskSummary ?? null,
            clientId: approvedClientId
          },
          reconnect: {
            ...handoff,
            generated: true,
            reasonCode
          }
        },
        auditEvents: [auditEvent],
        requestedToolbox: input.requestedToolbox ?? null,
        taskSummary: input.taskSummary ?? null,
        fallbackProfile: "bootstrap",
        sessionMode: "reconnect" as const,
        handoff,
        leaseToken: null
      };

      return this.withPersistedToolboxAudit("request_toolbox_activation", response);
    }

    const approvedProfile = this.policy.profiles[toolbox.targetProfile];
    const issuedAt = occurredAt;
    const leaseResult = this.issueLease({
      approvedClientId,
      approvedProfile,
      toolbox,
      issuedAt
    });

    if (!leaseResult.issued) {
      const reasonCode = "toolbox_activation_denied_lease_not_issued";
      const fallbackProfile = toolbox.fallbackProfile ?? "bootstrap";
      const handoff = this.buildSessionHandoff({
        profile: this.policy.profiles.bootstrap,
        clientId: approvedClientId,
        fallbackProfile,
        lease: {
          issued: false,
          leaseId: leaseResult.leaseId ?? null,
          reasonCode: leaseResult.reasonCode
        }
      });
      const diagnostics = {
        ...this.buildDiagnostics({
          reasonCode,
          requestedToolbox: input.requestedToolbox,
          requiredCategories: requestedCategories,
          approvedToolbox: toolbox.id,
          profileId: approvedProfile.id,
          toolboxId: toolbox.id,
          clientId: approvedClientId,
          approvedProfile: approvedProfile.id,
          fallbackProfile
        }),
        lease: {
          issued: false,
          leaseId: leaseResult.leaseId ?? null,
          reasonCode: leaseResult.reasonCode
        }
      };
      const activationDenied = this.buildAuditEvent("toolbox_activation_denied", occurredAt, {
        outcome: "rejected",
        toolboxId: toolbox.id,
        profileId: approvedProfile.id,
        clientId: approvedClientId,
        details: this.buildAuditDetails({
          reasonCode,
          diagnostics,
          requestedToolbox: input.requestedToolbox,
          requiredCategories: requestedCategories,
          taskSummary: input.taskSummary,
          approvedToolbox: toolbox.id,
          toolboxId: toolbox.id,
          profileId: approvedProfile.id,
          clientId: approvedClientId,
          approvedProfile: approvedProfile.id,
          fallbackProfile
        })
      });
      const leaseRejected = this.buildAuditEvent("toolbox_lease_rejected", occurredAt, {
        outcome: "rejected",
        toolboxId: toolbox.id,
        profileId: approvedProfile.id,
        clientId: approvedClientId,
        details: this.buildAuditDetails({
          reasonCode: leaseResult.reasonCode ?? reasonCode,
          diagnostics: {
            ...diagnostics,
            reasonCode: leaseResult.reasonCode ?? reasonCode
          },
          toolboxId: toolbox.id,
          profileId: approvedProfile.id,
          clientId: approvedClientId
        })
      });
      const response: ToolboxActivationResponse = {
        approved: false,
        reasonCode,
        clientId: approvedClientId,
        diagnostics,
        details: {
          request: {
            requestedToolbox: input.requestedToolbox ?? null,
            requiredCategories: requestedCategories,
            taskSummary: input.taskSummary ?? null,
            clientId: approvedClientId
          },
          reconnect: {
            ...handoff,
            generated: true,
            reasonCode
          },
          lease: {
            issued: false,
            leaseId: leaseResult.leaseId ?? null,
            reasonCode: leaseResult.reasonCode
          }
        },
        auditEvents: [activationDenied, leaseRejected],
        requestedToolbox: input.requestedToolbox ?? null,
        taskSummary: input.taskSummary ?? null,
        fallbackProfile,
        sessionMode: "reconnect" as const,
        leaseToken: null,
        handoff
      };

      return this.withPersistedToolboxAudit("request_toolbox_activation", response);
    }

    const handoff = this.buildSessionHandoff({
      profile: approvedProfile,
      clientId: approvedClientId,
      fallbackProfile: toolbox.fallbackProfile ?? "bootstrap",
      lease: {
        issued: leaseResult.issued,
        leaseId: leaseResult.leaseId ?? null,
        reasonCode: leaseResult.reasonCode
      }
    });
    const diagnostics = this.buildDiagnostics({
      reasonCode: "toolbox_activation_approved",
      approvedToolbox: toolbox.id,
      profileId: approvedProfile.id,
      toolboxId: toolbox.id,
      clientId: approvedClientId,
      approvedProfile: approvedProfile.id,
      fallbackProfile: toolbox.fallbackProfile ?? "bootstrap",
      leaseId: leaseResult.leaseId
    });
    const activationDetails = this.buildAuditDetails({
      reasonCode: "toolbox_activation_approved",
      diagnostics,
      requestedToolbox: input.requestedToolbox,
      requiredCategories: requestedCategories,
      taskSummary: input.taskSummary,
      approvedToolbox: toolbox.id,
      toolboxId: toolbox.id,
      profileId: approvedProfile.id,
      clientId: approvedClientId,
      approvedProfile: approvedProfile.id,
      fallbackProfile: toolbox.fallbackProfile ?? "bootstrap"
    });
    const reconnectDetails = this.buildAuditDetails({
      reasonCode: "toolbox_reconnect_generated",
      diagnostics,
      toolboxId: toolbox.id,
      profileId: approvedProfile.id,
      clientId: approvedClientId,
      approvedProfile: approvedProfile.id,
      leaseId: leaseResult.leaseId
    });
    const leaseEvent = leaseResult.issued
      ? this.buildAuditEvent("toolbox_lease_issued", occurredAt, {
          outcome: "accepted",
          toolboxId: toolbox.id,
          profileId: approvedProfile.id,
          clientId: approvedClientId,
          leaseId: leaseResult.leaseId,
          details: this.buildAuditDetails({
            reasonCode: "toolbox_lease_issued",
            diagnostics,
            toolboxId: toolbox.id,
            profileId: approvedProfile.id,
            clientId: approvedClientId,
            leaseId: leaseResult.leaseId
          })
        })
      : this.buildAuditEvent("toolbox_lease_rejected", occurredAt, {
          outcome: "rejected",
          toolboxId: toolbox.id,
          profileId: approvedProfile.id,
          clientId: approvedClientId,
          details: this.buildAuditDetails({
            reasonCode: leaseResult.reasonCode,
            diagnostics: {
              ...diagnostics,
              reasonCode: leaseResult.reasonCode
            },
            toolboxId: toolbox.id,
            profileId: approvedProfile.id,
            clientId: approvedClientId
          })
        });

    const response: ToolboxActivationResponse = {
      approved: true,
      reasonCode: "toolbox_activation_approved",
      diagnostics: {
        ...diagnostics,
        lease: {
          issued: leaseResult.issued,
          reasonCode: leaseResult.reasonCode,
          leaseId: leaseResult.leaseId ?? null
        }
      },
      details: {
        request: {
          requestedToolbox: input.requestedToolbox ?? null,
          requiredCategories: requestedCategories,
          taskSummary: input.taskSummary ?? null,
          clientId: approvedClientId
        },
        approval: {
          toolboxId: toolbox.id,
          profileId: approvedProfile.id,
          trustClass: toolbox.trustClass,
          requiresApproval: toolbox.requiresApproval,
          fallbackProfile: toolbox.fallbackProfile ?? "bootstrap"
        },
        reconnect: {
          ...handoff,
          generated: true,
          reasonCode: "toolbox_reconnect_generated"
        },
        lease: {
          issued: leaseResult.issued,
          reasonCode: leaseResult.reasonCode,
          leaseId: leaseResult.leaseId ?? null
        }
      },
      auditEvents: [
        this.buildAuditEvent("toolbox_activation_approved", occurredAt, {
          outcome: "accepted",
          toolboxId: toolbox.id,
          profileId: approvedProfile.id,
          clientId: approvedClientId,
          details: activationDetails
        }),
        this.buildAuditEvent("toolbox_reconnect_generated", occurredAt, {
          outcome: "accepted",
          toolboxId: toolbox.id,
          profileId: approvedProfile.id,
          clientId: approvedClientId,
          details: reconnectDetails
        }),
        leaseEvent
      ],
      requestedToolbox: input.requestedToolbox ?? null,
      taskSummary: input.taskSummary ?? null,
      approvedToolbox: toolbox.id,
      approvedProfile: toolbox.targetProfile,
      fallbackProfile: toolbox.fallbackProfile ?? "bootstrap",
      sessionMode: "reconnect" as const,
      clientId: approvedClientId,
      leaseToken: leaseResult.leaseToken,
      handoff
    };

    return this.withPersistedToolboxAudit("request_toolbox_activation", response);
  }

  async listActiveToolbox() {
    const profile = this.policy.profiles[this.options.activeProfileId];
    return {
      profile: {
        id: profile.id,
        displayName: profile.displayName,
        sessionMode: profile.sessionMode,
        composite: profile.composite
      },
      client: {
        id: this.options.clientId,
        displayName: this.policy.clients[this.options.clientId].displayName
      }
    };
  }

  async listActiveTools() {
    const profile = this.policy.profiles[this.options.activeProfileId];
    const client = this.policy.clients[this.options.clientId];
    const visibility = this.buildToolVisibilityReport(profile, client);
    return {
      profileId: profile.id,
      clientId: client.id,
      tools: visibility.activeTools,
      declaredTools: visibility.declaredTools,
      activeTools: visibility.activeTools,
      suppressedTools: visibility.suppressedTools
    };
  }

  async deactivateToolbox(leaseToken?: string) {
    const occurredAt = new Date().toISOString();
    const profile = this.policy.profiles[this.options.activeProfileId];
    const leaseInspection = this.inspectLeaseToken(leaseToken);
    const leaseRevoked = Boolean(
      leaseInspection.verified &&
        leaseInspection.leaseId &&
        this.options.leaseStore
    );

    if (leaseRevoked && this.options.leaseStore) {
      this.options.leaseStore.revokeLeaseId(leaseInspection.leaseId ?? "");
    }

    const handoff = this.buildSessionHandoff({
      profile: this.policy.profiles.bootstrap,
      clientId: this.options.clientId,
      fallbackProfile: "bootstrap",
      lease: {
        issued: false,
        leaseId: null,
        reasonCode: "toolbox_deactivated"
      }
    });
    const diagnostics = this.buildDiagnostics({
      reasonCode: "toolbox_deactivated",
      profileId: profile.id,
      clientId: this.options.clientId,
      leaseId: leaseInspection.leaseId,
      approvedProfile: profile.id
    });
    const response: ToolboxDeactivationResponse = {
      reasonCode: "toolbox_deactivated",
      diagnostics: {
        ...diagnostics,
        lease: {
          provided: Boolean(leaseToken),
          verified: leaseInspection.verified,
          revoked: leaseRevoked,
          leaseId: leaseInspection.leaseId ?? null,
          reasonCode: leaseInspection.reasonCode
        }
      },
      details: {
        lease: {
          provided: Boolean(leaseToken),
          verified: leaseInspection.verified,
          revoked: leaseRevoked,
          leaseId: leaseInspection.leaseId ?? null,
          reasonCode: leaseInspection.reasonCode
        }
      },
      auditEvents: [
        ...(leaseInspection.reasonCode === "toolbox_expired"
          ? [
              this.buildAuditEvent("toolbox_expired", occurredAt, {
                outcome: "accepted",
                profileId: profile.id,
                clientId: this.options.clientId,
                leaseId: leaseInspection.leaseId,
                details: this.buildAuditDetails({
                  reasonCode: "toolbox_expired",
                  diagnostics: {
                    ...diagnostics,
                    reasonCode: "toolbox_expired"
                  },
                  profileId: profile.id,
                  clientId: this.options.clientId,
                  leaseId: leaseInspection.leaseId
                })
              })
            ]
          : []),
        this.buildAuditEvent("toolbox_deactivated", occurredAt, {
          outcome: "accepted",
          profileId: profile.id,
          clientId: this.options.clientId,
          leaseId: leaseInspection.leaseId,
          details: this.buildAuditDetails({
            reasonCode: "toolbox_deactivated",
            diagnostics: {
              ...diagnostics,
              lease: {
                provided: Boolean(leaseToken),
                verified: leaseInspection.verified,
                revoked: leaseRevoked,
                leaseId: leaseInspection.leaseId ?? null,
                reasonCode: leaseInspection.reasonCode
              }
            },
            profileId: profile.id,
            clientId: this.options.clientId,
            leaseId: leaseInspection.leaseId
          })
        })
      ],
      activeProfile: this.options.activeProfileId,
      downgradeTarget: this.options.activeProfileId === "bootstrap" ? "bootstrap" : "bootstrap",
      sessionMode: "reconnect" as const,
      clientId: this.options.clientId,
      handoff
    };

    return this.withPersistedToolboxAudit("deactivate_toolbox", response);
  }

  private resolveRequestedToolbox(input: RequestToolboxActivationInput) {
    if (input.requestedToolbox) {
      return (
        this.policy.intents[input.requestedToolbox]
        ?? Object.values(this.policy.intents).find(
          (intent) => intent.targetProfile === input.requestedToolbox
        )
      );
    }

    if (input.requiredCategories?.length) {
      const requestedCategories = new Set(input.requiredCategories);
      return Object.values(this.policy.intents).find((intent) =>
        [...requestedCategories].every((category) => intent.allowedCategories.includes(category))
      );
    }

    return undefined;
  }

  private buildToolVisibilityReport(
    profile: CompiledToolboxProfile,
    client: CompiledToolboxClientOverlay
  ): {
    declaredTools: CompiledToolboxToolDescriptor[];
    activeTools: CompiledToolboxToolDescriptor[];
    suppressedTools: CompiledToolboxToolDescriptor[];
  } {
    const declaredTools = profile.tools.map((tool) => ({
      ...tool,
      availabilityState: "declared" as const,
      suppressionReasons: undefined
    }));
    const activeTools: CompiledToolboxToolDescriptor[] = [];
    const suppressedTools: CompiledToolboxToolDescriptor[] = [];

    for (const tool of declaredTools) {
      const suppressionReasons = this.collectSuppressionReasons(tool, client);
      if (suppressionReasons.length === 0) {
        activeTools.push({
          ...tool,
          availabilityState: "active"
        });
        continue;
      }

      suppressedTools.push({
        ...tool,
        availabilityState: "suppressed",
        suppressionReasons
      });
    }

    return {
      declaredTools,
      activeTools,
      suppressedTools
    };
  }

  private collectSuppressionReasons(
    tool: CompiledToolboxToolDescriptor,
    client: CompiledToolboxClientOverlay
  ): string[] {
    const reasons: string[] = [];

    if (client.suppressServerIds.includes(tool.serverId)) {
      reasons.push(`suppressed-server:${tool.serverId}`);
    }
    if (client.suppressToolIds.includes(tool.toolId)) {
      reasons.push(`suppressed-tool:${tool.toolId}`);
    }
    if (client.suppressCategories.includes(tool.category)) {
      reasons.push(`suppressed-category:${tool.category}`);
    }
    if (client.suppressedSemanticCapabilities.includes(tool.semanticCapabilityId)) {
      reasons.push(`suppressed-semantic-capability:${tool.semanticCapabilityId}`);
    }

    return reasons;
  }

  private buildSessionHandoff(input: {
    profile: CompiledToolboxProfile;
    clientId: string;
    fallbackProfile: string;
    lease: {
      issued: boolean;
      leaseId: string | null;
      reasonCode?: string;
    };
  }): ToolboxSessionHandoff {
    const client = this.policy.clients[input.clientId];
    return {
      mode: "reconnect",
      targetProfileId: input.profile.id,
      targetSessionMode: input.profile.sessionMode,
      fallbackProfileId: input.fallbackProfile,
      clientId: input.clientId,
      client: {
        id: client.id,
        displayName: client.displayName,
        handoffStrategy: client.handoffStrategy,
        handoffPresetRef: client.handoffPresetRef
      },
      manifestRevision: this.policy.manifestRevision,
      profileRevision: input.profile.profileRevision,
      environment: compactObject({
        MAB_TOOLBOX_ACTIVE_PROFILE: input.profile.id,
        MAB_TOOLBOX_CLIENT_ID: input.clientId,
        MAB_TOOLBOX_SESSION_MODE: input.profile.sessionMode,
        MAB_TOOLBOX_SESSION_POLICY_TOKEN: input.lease.issued ? "{{leaseToken}}" : undefined
      }),
      clearEnvironment: input.lease.issued ? [] : ["MAB_TOOLBOX_SESSION_POLICY_TOKEN"],
      actorDefaults: compactObject({
        toolboxSessionMode: input.profile.sessionMode,
        toolboxClientId: input.clientId,
        toolboxProfileId: input.profile.id,
        sessionPolicyTokenFromEnv: input.lease.issued
          ? "MAB_TOOLBOX_SESSION_POLICY_TOKEN"
          : undefined
      }),
      lease: input.lease.issued
        ? {
            issued: true,
            leaseId: input.lease.leaseId,
            reasonCode: input.lease.reasonCode,
            sessionPolicyTokenField: "leaseToken",
            sessionPolicyTokenEnvVar: "MAB_TOOLBOX_SESSION_POLICY_TOKEN"
          }
        : {
            issued: false,
            leaseId: input.lease.leaseId,
            reasonCode: input.lease.reasonCode
          }
    };
  }

  private buildAuditEvent(
    type: ToolboxAuditEvent["type"],
    occurredAt: string,
    overrides: Partial<ToolboxAuditEvent>
  ): ToolboxAuditEvent {
    return {
      eventId: randomUUID(),
      type,
      occurredAt,
      sessionMode: this.policy.profiles[this.options.activeProfileId].sessionMode,
      manifestRevision: this.policy.manifestRevision,
      profileId: this.options.activeProfileId,
      clientId: this.options.clientId,
      outcome: "accepted",
      ...overrides
    };
  }

  private async withPersistedToolboxAudit<T extends { auditEvents: ToolboxAuditEvent[] }>(
    toolName: string,
    response: T
  ): Promise<T & { warnings?: string[] }> {
    const warnings = await this.persistToolboxAuditEvents(toolName, response.auditEvents);
    return warnings.length > 0 ? { ...response, warnings } : response;
  }

  private async persistToolboxAuditEvents(
    toolName: string,
    events: ToolboxAuditEvent[]
  ): Promise<string[]> {
    const warnings: string[] = [];
    for (const event of events) {
      const recorded = await this.options.auditHistoryService.recordAction({
        actionType: event.type,
        actorId: TOOLBOX_AUDIT_ACTOR.actorId,
        actorRole: TOOLBOX_AUDIT_ACTOR.actorRole,
        source: TOOLBOX_AUDIT_ACTOR.source,
        toolName,
        occurredAt: event.occurredAt,
        outcome: event.outcome,
        affectedNoteIds: [],
        affectedChunkIds: [],
        detail: this.buildAuditDetailForStorage(event)
      });

      if (!recorded.ok) {
        warnings.push(recorded.error.message);
      }
    }

    return warnings;
  }

  private buildAuditDetailForStorage(event: ToolboxAuditEvent): ToolboxAuditDetail {
    return this.buildAuditDetails({
      reasonCode: event.type,
      sessionMode: event.sessionMode,
      manifestRevision: event.manifestRevision,
      profileId: event.profileId,
      clientId: event.clientId,
      toolboxId: event.toolboxId,
      leaseId: event.leaseId,
      diagnostics: event.details?.diagnostics,
      ...event.details
    });
  }

  private buildAuditDetails(detail: ToolboxAuditDetail & {
    diagnostics?: unknown;
  }): ToolboxAuditDetail {
    return compactObject({
      reasonCode: detail.reasonCode,
      sessionMode: detail.sessionMode,
      manifestRevision: detail.manifestRevision ?? this.policy.manifestRevision,
      profileId: detail.profileId,
      clientId: detail.clientId ?? this.options.clientId,
      toolboxId: detail.toolboxId,
      leaseId: detail.leaseId,
      requestedToolbox: detail.requestedToolbox,
      requiredCategories: detail.requiredCategories,
      approvedToolbox: detail.approvedToolbox,
      approvedProfile: detail.approvedProfile,
      fallbackProfile: detail.fallbackProfile,
      diagnostics: detail.diagnostics
    });
  }

  private buildDiagnostics(
    details: Partial<ToolboxAuditDiagnostics> & { reasonCode: string }
  ): ToolboxAuditDiagnostics {
    return compactObject({
      sessionMode: this.policy.profiles[this.options.activeProfileId].sessionMode,
      manifestRevision: this.policy.manifestRevision,
      profileId: details.profileId ?? this.options.activeProfileId,
      clientId: details.clientId ?? this.options.clientId,
      toolboxId: details.toolboxId,
      leaseId: details.leaseId,
      requestedToolbox: details.requestedToolbox,
      requiredCategories: details.requiredCategories,
      approvedToolbox: details.approvedToolbox,
      approvedProfile: details.approvedProfile,
      fallbackProfile: details.fallbackProfile,
      reasonCode: details.reasonCode
    });
  }

  private issueLease(input: {
    approvedClientId: string;
    approvedProfile: CompiledToolboxPolicy["profiles"][string];
    toolbox: CompiledToolboxPolicy["intents"][string];
    issuedAt: string;
  }): {
    leaseToken: string | null;
    leaseId?: string;
    issued: boolean;
    reasonCode?: string;
  } {
    if (!this.options.leaseIssuerSecret) {
      return {
        leaseToken: null,
        issued: false,
        reasonCode: "toolbox_lease_rejected_missing_issuer_secret"
      };
    }

    const leaseToken = issueToolboxSessionLease(
      {
        version: 1,
        sessionId: `toolbox-session-${randomUUID()}`,
        issuer: this.options.leaseIssuer ?? "mimir-control",
        audience: this.options.leaseAudience ?? "mimir-core",
        clientId: input.approvedClientId,
        approvedProfile: input.approvedProfile.id,
        approvedCategories: input.approvedProfile.allowedCategories,
        deniedCategories: input.approvedProfile.deniedCategories,
        trustClass: input.toolbox.trustClass,
        manifestRevision: this.policy.manifestRevision,
        profileRevision: input.approvedProfile.profileRevision,
        issuedAt: input.issuedAt,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        nonce: randomUUID()
      },
      this.options.leaseIssuerSecret
    );

    return {
      leaseToken,
      leaseId: safeReadLeaseId(leaseToken, this.options.leaseIssuerSecret),
      issued: true,
      reasonCode: "toolbox_lease_issued"
    };
  }

  private inspectLeaseToken(leaseToken?: string): {
    verified: boolean;
    leaseId?: string;
    reasonCode?: string;
  } {
    if (!leaseToken) {
      return { verified: false, reasonCode: "toolbox_deactivated_without_lease_token" };
    }

    if (!this.options.leaseIssuerSecret) {
      return { verified: false, reasonCode: "toolbox_deactivated_without_issuer_secret" };
    }

    try {
      const claims = verifyToolboxSessionLease(leaseToken, this.options.leaseIssuerSecret);
      try {
        assertToolboxSessionLeaseLifecycle(claims, 30_000);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Toolbox session lease has expired."
        ) {
          return {
            verified: false,
            leaseId: claims.leaseId,
            reasonCode: "toolbox_expired"
          };
        }

        return {
          verified: false,
          leaseId: claims.leaseId,
          reasonCode: "toolbox_deactivated_invalid_lease_token"
        };
      }

      return {
        verified: true,
        leaseId: claims.leaseId,
        reasonCode: "toolbox_deactivated"
      };
    } catch (error) {
      return {
        verified: false,
        reasonCode:
          error instanceof Error
            ? "toolbox_deactivated_invalid_lease_token"
            : "toolbox_deactivated_invalid_lease_token"
      };
    }
  }
}

export function buildMimirControlSurface(
  options: MimirControlSurfaceOptions
): MimirControlSurface {
  return new MimirControlSurface(options);
}

function safeReadLeaseId(leaseToken: string, issuerSecret?: string): string | undefined {
  if (!issuerSecret) {
    return undefined;
  }

  try {
    return verifyToolboxSessionLease(leaseToken, issuerSecret).leaseId;
  } catch {
    return undefined;
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}
