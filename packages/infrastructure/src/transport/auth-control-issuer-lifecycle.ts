import type { AuditHistoryService } from "@mimir/application";
import type { ActorContext } from "@mimir/contracts";
import {
  ActorAuthorizationError,
  type ActorAuthorizationPolicy
} from "@mimir/orchestration";
import type { ActorRegistryEntryStatus } from "@mimir/orchestration";
import {
  type AuthIssuerControlRecord,
  type SqliteAuthIssuerControlStore
} from "../sqlite/sqlite-auth-issuer-control-store.js";
import { recordAuthIssuerControlAudit } from "./auth-control-audit.js";
import { TransportValidationError } from "./transport-validation-error.js";

type IssuerLifecycleStatus = "active" | "future" | "expired" | "disabled";

export interface AuthIssuerLifecycleRecord {
  actorId: string;
  actorRole: ActorRegistryEntryStatus["actorRole"];
  source?: string;
  registryLifecycleStatus: ActorRegistryEntryStatus["lifecycleStatus"];
  lifecycleStatus: IssuerLifecycleStatus;
  registryAllowsIssueAuthToken: boolean;
  registryAllowsRevokeAuthToken: boolean;
  allowIssueAuthToken: boolean;
  allowRevokeAuthToken: boolean;
  enabled: boolean;
  validFrom?: string;
  validUntil?: string;
  reason?: string;
  updatedAt?: string;
  updatedByActorId?: string;
  updatedByActorRole?: AuthIssuerControlRecord["updatedByActorRole"];
  updatedBySource?: string;
  updatedByTransport?: AuthIssuerControlRecord["updatedByTransport"];
}

export interface AuthIssuerLifecycleSummary {
  total: number;
  active: number;
  future: number;
  expired: number;
  disabled: number;
  issueEnabled: number;
  revokeEnabled: number;
}

export interface ListAuthIssuerControlsRequest {
  actorId?: string;
  asOf?: string;
  lifecycleStatus?: IssuerLifecycleStatus;
}

export interface SetAuthIssuerStateRequest {
  actorId: string;
  enabled: boolean;
  allowIssueAuthToken: boolean;
  allowRevokeAuthToken: boolean;
  validFrom?: string;
  validUntil?: string;
  reason?: string;
}

export class AuthIssuerLifecycleService {
  constructor(
    private readonly authPolicy: ActorAuthorizationPolicy,
    private readonly store: SqliteAuthIssuerControlStore,
    private readonly auditHistoryService: AuditHistoryService
  ) {}

  listIssuerControls(
    request: ListAuthIssuerControlsRequest = {}
  ): { asOf: string; summary: AuthIssuerLifecycleSummary; issuers: AuthIssuerLifecycleRecord[] } {
    const asOf = request.asOf ?? new Date().toISOString();
    const issuers = [...this.buildIssuerMap(asOf).values()].filter((issuer) => {
      if (request.actorId?.trim() && issuer.actorId !== request.actorId.trim()) {
        return false;
      }

      if (request.lifecycleStatus && issuer.lifecycleStatus !== request.lifecycleStatus) {
        return false;
      }

      return true;
    });

    return {
      asOf,
      summary: {
        total: issuers.length,
        active: issuers.filter((issuer) => issuer.lifecycleStatus === "active").length,
        future: issuers.filter((issuer) => issuer.lifecycleStatus === "future").length,
        expired: issuers.filter((issuer) => issuer.lifecycleStatus === "expired").length,
        disabled: issuers.filter((issuer) => issuer.lifecycleStatus === "disabled").length,
        issueEnabled: issuers.filter((issuer) => issuer.allowIssueAuthToken).length,
        revokeEnabled: issuers.filter((issuer) => issuer.allowRevokeAuthToken).length
      },
      issuers: issuers.sort((left, right) => left.actorId.localeCompare(right.actorId))
    };
  }

  async setIssuerState(
    request: SetAuthIssuerStateRequest,
    administrativeActor: ActorContext
  ): Promise<AuthIssuerLifecycleRecord> {
    const actorId = request.actorId.trim();
    if (!actorId) {
      throw controlValidationError("actorId", "must be a non-empty string");
    }

    assertValidityWindowOrder(request.validFrom, request.validUntil);
    const registryActor = this.getRegistryIssuer(actorId);
    if (!registryActor) {
      throw controlValidationError(
        "actorId",
        `actor '${actorId}' is not a registered auth issuer in the registry`
      );
    }

    const registryAllowsIssue = actorAllowsIssue(registryActor);
    const registryAllowsRevoke = actorAllowsRevoke(registryActor);
    if (request.allowIssueAuthToken && !registryAllowsIssue) {
      throw controlValidationError(
        "allowIssueAuthToken",
        `actor '${actorId}' cannot be granted issue_auth_token because the registry does not allow it`
      );
    }
    if (request.allowRevokeAuthToken && !registryAllowsRevoke) {
      throw controlValidationError(
        "allowRevokeAuthToken",
        `actor '${actorId}' cannot be granted revoke_auth_token because the registry does not allow it`
      );
    }

    const updatedAt = new Date().toISOString();
    this.store.upsertIssuerControl({
      actorId,
      enabled: request.enabled,
      allowIssueAuthToken: request.allowIssueAuthToken,
      allowRevokeAuthToken: request.allowRevokeAuthToken,
      validFrom: request.validFrom,
      validUntil: request.validUntil,
      reason: request.reason,
      updatedAt,
      updatedByActorId: administrativeActor.actorId,
      updatedByActorRole: administrativeActor.actorRole,
      updatedBySource: administrativeActor.source,
      updatedByTransport: administrativeActor.transport
    });

    const issuer = this.listIssuerControls({ actorId }).issuers[0];
    await recordAuthIssuerControlAudit({
      auditHistoryService: this.auditHistoryService,
      administrativeActor,
      targetActorId: actorId,
      targetActorRole: registryActor.actorRole,
      enabled: request.enabled,
      allowIssueAuthToken: request.allowIssueAuthToken,
      allowRevokeAuthToken: request.allowRevokeAuthToken,
      validFrom: request.validFrom,
      validUntil: request.validUntil,
      reason: request.reason
    });

    return issuer;
  }

  assertAdministrativeActionAllowed(
    actor: ActorContext,
    administrativeAction:
      | "issue_auth_token"
      | "revoke_auth_token"
      | "revoke_auth_tokens"
  ): void {
    if (this.authPolicy.getRegistrySummary(actor.initiatedAt).mode !== "enforced") {
      return;
    }

    const issuer = this.listIssuerControls({
      actorId: actor.actorId,
      asOf: actor.initiatedAt
    }).issuers[0];

    if (!issuer) {
      throw new ActorAuthorizationError(
        "forbidden",
        `Actor '${actor.actorId}' is not governed by the central issuer lifecycle plane.`,
        {
          actorId: actor.actorId,
          administrativeAction
        }
      );
    }

    if (issuer.lifecycleStatus !== "active" || !issuer.enabled) {
      throw new ActorAuthorizationError(
        "forbidden",
        `Actor '${actor.actorId}' is not currently active in the central issuer lifecycle plane.`,
        {
          actorId: actor.actorId,
          administrativeAction,
          lifecycleStatus: issuer.lifecycleStatus
        }
      );
    }

    if (administrativeAction === "issue_auth_token" && !issuer.allowIssueAuthToken) {
      throw new ActorAuthorizationError(
        "forbidden",
        `Actor '${actor.actorId}' is not enabled to issue actor access tokens.`,
        {
          actorId: actor.actorId,
          administrativeAction
        }
      );
    }

    if (
      (administrativeAction === "revoke_auth_token" ||
        administrativeAction === "revoke_auth_tokens") &&
      !issuer.allowRevokeAuthToken
    ) {
      throw new ActorAuthorizationError(
        "forbidden",
        `Actor '${actor.actorId}' is not enabled to revoke actor access tokens.`,
        {
          actorId: actor.actorId,
          administrativeAction
        }
      );
    }
  }

  private buildIssuerMap(asOf: string): Map<string, AuthIssuerLifecycleRecord> {
    const overrides = new Map(
      this.store.listIssuerControls().map((record) => [record.actorId, record])
    );

    return new Map(
      this.authPolicy
        .getRegistrySummary(asOf)
        .actors.filter(
          (actor) =>
            (actor.actorRole === "operator" || actor.actorRole === "system") &&
            (actorAllowsIssue(actor) || actorAllowsRevoke(actor))
        )
        .map((actor) => [
          actor.actorId,
          toIssuerLifecycleRecord(actor, overrides.get(actor.actorId), asOf)
        ])
    );
  }

  private getRegistryIssuer(actorId: string): ActorRegistryEntryStatus | undefined {
    return this.authPolicy
      .getRegistrySummary()
      .actors.find(
        (actor) =>
          actor.actorId === actorId &&
          (actor.actorRole === "operator" || actor.actorRole === "system") &&
          (actorAllowsIssue(actor) || actorAllowsRevoke(actor))
      );
  }
}

function toIssuerLifecycleRecord(
  registryActor: ActorRegistryEntryStatus,
  override: AuthIssuerControlRecord | undefined,
  asOf: string
): AuthIssuerLifecycleRecord {
  const registryAllowsIssue = actorAllowsIssue(registryActor);
  const registryAllowsRevoke = actorAllowsRevoke(registryActor);
  const overrideLifecycleStatus = deriveOverrideLifecycleStatus(override, asOf);
  const lifecycleStatus =
    registryActor.lifecycleStatus !== "active"
      ? registryActor.lifecycleStatus
      : overrideLifecycleStatus;
  const enabled =
    registryActor.enabled && (override?.enabled ?? true) && lifecycleStatus === "active";

  return {
    actorId: registryActor.actorId,
    actorRole: registryActor.actorRole,
    source: registryActor.source,
    registryLifecycleStatus: registryActor.lifecycleStatus,
    lifecycleStatus,
    registryAllowsIssueAuthToken: registryAllowsIssue,
    registryAllowsRevokeAuthToken: registryAllowsRevoke,
    allowIssueAuthToken:
      enabled && registryAllowsIssue && (override?.allowIssueAuthToken ?? true),
    allowRevokeAuthToken:
      enabled && registryAllowsRevoke && (override?.allowRevokeAuthToken ?? true),
    enabled,
    validFrom: override?.validFrom,
    validUntil: override?.validUntil,
    reason: override?.reason,
    updatedAt: override?.updatedAt,
    updatedByActorId: override?.updatedByActorId,
    updatedByActorRole: override?.updatedByActorRole,
    updatedBySource: override?.updatedBySource,
    updatedByTransport: override?.updatedByTransport
  };
}

function actorAllowsIssue(actor: ActorRegistryEntryStatus): boolean {
  return actor.allowedAdminActions?.includes("issue_auth_token") ?? false;
}

function actorAllowsRevoke(actor: ActorRegistryEntryStatus): boolean {
  return (
    actor.allowedAdminActions?.includes("revoke_auth_token") ||
    actor.allowedAdminActions?.includes("revoke_auth_tokens") ||
    false
  );
}

function deriveOverrideLifecycleStatus(
  override: AuthIssuerControlRecord | undefined,
  asOf: string
): IssuerLifecycleStatus {
  if (!override) {
    return "active";
  }

  if (!override.enabled) {
    return "disabled";
  }

  const evaluationTime = parseRequiredTime(asOf, "issuer evaluation time");
  const validFrom = override.validFrom
    ? parseRequiredTime(override.validFrom, "issuer validFrom")
    : undefined;
  const validUntil = override.validUntil
    ? parseRequiredTime(override.validUntil, "issuer validUntil")
    : undefined;

  if (validFrom !== undefined && evaluationTime < validFrom) {
    return "future";
  }

  if (validUntil !== undefined && evaluationTime > validUntil) {
    return "expired";
  }

  return "active";
}

function assertValidityWindowOrder(
  validFrom: string | undefined,
  validUntil: string | undefined
): void {
  if (!validFrom || !validUntil) {
    return;
  }

  const validFromMs = parseRequiredTime(validFrom, "issuer validFrom");
  const validUntilMs = parseRequiredTime(validUntil, "issuer validUntil");
  if (validFromMs > validUntilMs) {
    throw controlValidationError(
      "validUntil",
      "validFrom must be earlier than or equal to validUntil"
    );
  }
}

function parseRequiredTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw controlValidationError(label, `invalid timestamp '${value}'`);
  }

  return parsed;
}

function controlValidationError(
  field: string,
  problem: string
): TransportValidationError {
  return new TransportValidationError(
    `Invalid auth issuer control field '${field}': ${problem}.`,
    { field, problem }
  );
}
