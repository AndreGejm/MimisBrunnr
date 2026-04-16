import type {
  ActorContext,
  ActorRole,
  ServiceError,
  TransportKind
} from "@mimir/contracts";
import type { OrchestratorCommand } from "../routing/task-family-router.js";
import type { AdministrativeAction } from "./administrative-action.js";
import type { IssuedActorTokenClaims } from "./issued-actor-token.js";
import {
  buildActorRegistry,
  isWithinValidityWindow,
  normalizeEvaluationTime,
  summarizeActorRegistryEntry,
  type NormalizedActorRegistryEntry
} from "./actor-registry-policy.js";
import {
  authorizeIssuedActorToken,
  inspectActorToken
} from "./actor-token-inspector.js";
import {
  getAdministrativeActionAuthorizationRoles as getAdministrativeActionAuthorizationRolesFromMatrix,
  getCommandAuthorizationRoles as getCommandAuthorizationRolesFromMatrix,
  isAdministrativeActionRoleAuthorized,
  isCommandRoleAuthorized
} from "./command-authorization-matrix.js";

export type ActorAuthorizationMode = "permissive" | "enforced";

export interface ActorTokenCredential {
  token: string;
  label?: string;
  validFrom?: string;
  validUntil?: string;
}

export interface ActorRegistryEntry {
  actorId: string;
  actorRole: ActorRole;
  authToken?: string;
  authTokens?: Array<string | ActorTokenCredential>;
  source?: string;
  enabled?: boolean;
  allowedTransports?: TransportKind[];
  allowedCommands?: OrchestratorCommand[];
  allowedAdminActions?: AdministrativeAction[];
  validFrom?: string;
  validUntil?: string;
}

export interface ActorAuthorizationOptions {
  mode?: ActorAuthorizationMode;
  allowAnonymousInternal?: boolean;
  registry?: ReadonlyArray<ActorRegistryEntry>;
  issuerSecret?: string;
  issuedTokenRequireRegistryMatch?: boolean;
  revokedIssuedTokenIds?: ReadonlyArray<string>;
  isTokenRevoked?: (tokenId: string) => boolean;
}

export interface ActorRegistryEntryStatus {
  actorId: string;
  actorRole: ActorRole;
  source?: string;
  enabled: boolean;
  lifecycleStatus: "active" | "future" | "expired" | "disabled";
  allowedTransports?: TransportKind[];
  allowedCommands?: OrchestratorCommand[];
  allowedAdminActions?: AdministrativeAction[];
  staticCredentialCount: number;
  activeCredentialCount: number;
  futureCredentialCount: number;
  expiredCredentialCount: number;
}

export interface ActorTokenInspection {
  asOf: string;
  tokenKind: "issued" | "static" | "unknown";
  valid: boolean;
  reason?: string;
  claims?: IssuedActorTokenClaims;
  matchedActor?: {
    actorId: string;
    actorRole: ActorRole;
    source?: string;
    lifecycleStatus: ActorRegistryEntryStatus["lifecycleStatus"];
    enabled: boolean;
  };
  authorization?: {
    transport?: TransportKind;
    transportAllowed?: boolean;
    command?: OrchestratorCommand;
    commandAllowed?: boolean;
    administrativeAction?: AdministrativeAction;
    administrativeActionAllowed?: boolean;
  };
}

export interface ActorRegistrySummary {
  mode: ActorAuthorizationMode;
  allowAnonymousInternal: boolean;
  issuedTokenSupport: {
    enabled: boolean;
    requireRegistryMatch: boolean;
    revokedTokenCount: number;
  };
  actorCounts: {
    total: number;
    enabled: number;
    disabled: number;
    active: number;
    future: number;
    expired: number;
  };
  credentialCounts: {
    static: number;
    active: number;
    future: number;
    expired: number;
  };
  actors: ActorRegistryEntryStatus[];
}

type AuthorizationErrorCode = "unauthorized" | "forbidden";

export function getCommandAuthorizationRoles(command: OrchestratorCommand): ActorRole[] {
  return getCommandAuthorizationRolesFromMatrix(command);
}

export function getAdministrativeActionAuthorizationRoles(
  administrativeAction: AdministrativeAction
): ActorRole[] {
  return getAdministrativeActionAuthorizationRolesFromMatrix(administrativeAction);
}

export class ActorAuthorizationError extends Error {
  constructor(
    readonly code: AuthorizationErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ActorAuthorizationError";
  }

  toServiceError(): ServiceError<AuthorizationErrorCode> {
    return {
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

export class ActorAuthorizationPolicy {
  private readonly mode: ActorAuthorizationMode;
  private readonly allowAnonymousInternal: boolean;
  private readonly registry: ReadonlyMap<string, NormalizedActorRegistryEntry>;
  private readonly issuerSecret?: string;
  private readonly issuedTokenRequireRegistryMatch: boolean;
  private readonly revokedIssuedTokenIds: Set<string>;
  private readonly isTokenRevokedCallback?: (tokenId: string) => boolean;

  constructor(options: ActorAuthorizationOptions = {}) {
    this.mode = options.mode ?? "permissive";
    this.allowAnonymousInternal = options.allowAnonymousInternal ?? true;
    this.issuerSecret = options.issuerSecret?.trim() || undefined;
    this.issuedTokenRequireRegistryMatch =
      options.issuedTokenRequireRegistryMatch ?? true;
    this.revokedIssuedTokenIds = new Set(
      (options.revokedIssuedTokenIds ?? [])
        .map((tokenId) => tokenId.trim())
        .filter(Boolean)
    );
    this.isTokenRevokedCallback = options.isTokenRevoked;
    this.registry = buildActorRegistry(options.registry ?? []);
  }

  revokeIssuedTokenId(tokenId: string): boolean {
    const normalized = tokenId.trim();
    if (!normalized) {
      throw new Error("Issued token ID is required.");
    }

    const alreadyRevoked = this.revokedIssuedTokenIds.has(normalized);
    this.revokedIssuedTokenIds.add(normalized);
    return !alreadyRevoked;
  }

  isTokenRevoked(tokenId: string): boolean {
    const normalized = tokenId.trim();
    if (this.revokedIssuedTokenIds.has(normalized)) return true;
    if (this.isTokenRevokedCallback && this.isTokenRevokedCallback(normalized)) return true;
    return false;
  }

  getRevokedIssuedTokenIds(): string[] {
    return [...this.revokedIssuedTokenIds].sort();
  }

  authorize(command: OrchestratorCommand, actor: ActorContext): void {
    this.authorizeOperation(actor, { command });
  }

  authorizeAdministrativeAction(
    administrativeAction: AdministrativeAction,
    actor: ActorContext
  ): void {
    this.authorizeOperation(actor, { administrativeAction });
  }

  getRegistrySummary(asOf: string = new Date().toISOString()): ActorRegistrySummary {
    const evaluationTimeMs = normalizeEvaluationTime(asOf);
    const actors = [...this.registry.values()].map((entry) =>
      summarizeActorRegistryEntry(entry, evaluationTimeMs)
    );

    return {
      mode: this.mode,
      allowAnonymousInternal: this.allowAnonymousInternal,
      issuedTokenSupport: {
        enabled: Boolean(this.issuerSecret),
        requireRegistryMatch: this.issuedTokenRequireRegistryMatch,
        revokedTokenCount: this.revokedIssuedTokenIds.size
      },
      actorCounts: {
        total: actors.length,
        enabled: actors.filter((actor) => actor.enabled).length,
        disabled: actors.filter((actor) => !actor.enabled).length,
        active: actors.filter((actor) => actor.lifecycleStatus === "active").length,
        future: actors.filter((actor) => actor.lifecycleStatus === "future").length,
        expired: actors.filter((actor) => actor.lifecycleStatus === "expired").length
      },
      credentialCounts: {
        static: actors.reduce((total, actor) => total + actor.staticCredentialCount, 0),
        active: actors.reduce((total, actor) => total + actor.activeCredentialCount, 0),
        future: actors.reduce((total, actor) => total + actor.futureCredentialCount, 0),
        expired: actors.reduce((total, actor) => total + actor.expiredCredentialCount, 0)
      },
      actors
    };
  }

  inspectToken(
    token: string,
    options: {
      asOf?: string;
      expectedTransport?: TransportKind;
      expectedCommand?: OrchestratorCommand;
      expectedAdministrativeAction?: AdministrativeAction;
    } = {}
  ): ActorTokenInspection {
    return inspectActorToken({
      token,
      asOf: options.asOf,
      registry: this.registry,
      issuerSecret: this.issuerSecret,
      issuedTokenRequireRegistryMatch: this.issuedTokenRequireRegistryMatch,
      revokedIssuedTokenIds: this.revokedIssuedTokenIds,
      isTokenRevoked: (tokenId) => this.isTokenRevoked(tokenId),
      expectedTransport: options.expectedTransport,
      expectedCommand: options.expectedCommand,
      expectedAdministrativeAction: options.expectedAdministrativeAction
    });
  }

  private assertActorShape(actor: ActorContext): void {
    if (!actor.actorId.trim()) {
      throw new ActorAuthorizationError("unauthorized", "Actor ID is required.");
    }

    if (!actor.source.trim()) {
      throw new ActorAuthorizationError("unauthorized", "Actor source is required.");
    }
  }

  private assertCommandRole(
    command: OrchestratorCommand,
    actor: ActorContext
  ): void {
    if (isCommandRoleAuthorized(command, actor.actorRole)) {
      return;
    }

    throw new ActorAuthorizationError(
      "forbidden",
      `Actor role '${actor.actorRole}' cannot execute '${command}'.`,
      {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        command
      }
    );
  }

  private assertAdministrativeActionRole(
    administrativeAction: AdministrativeAction,
    actor: ActorContext
  ): void {
    if (isAdministrativeActionRoleAuthorized(administrativeAction, actor.actorRole)) {
      return;
    }

    throw new ActorAuthorizationError(
      "forbidden",
      `Actor role '${actor.actorRole}' cannot execute administrative action '${administrativeAction}'.`,
      {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        administrativeAction
      }
    );
  }

  private isAnonymousInternalAllowed(actor: ActorContext): boolean {
    return this.allowAnonymousInternal && actor.transport === "internal";
  }

  private tryAuthorizeIssuedToken(
    actor: ActorContext,
    evaluationTimeMs: number,
    scope: {
      command?: OrchestratorCommand;
      administrativeAction?: AdministrativeAction;
    },
    registeredActor?: NormalizedActorRegistryEntry
  ): boolean {
    return authorizeIssuedActorToken({
      actor,
      evaluationTimeMs,
      scope,
      issuerSecret: this.issuerSecret,
      issuedTokenRequireRegistryMatch: this.issuedTokenRequireRegistryMatch,
      registeredActor,
      isTokenRevoked: (tokenId) => this.isTokenRevoked(tokenId)
    });
  }

  private authorizeOperation(
    actor: ActorContext,
    scope: {
      command?: OrchestratorCommand;
      administrativeAction?: AdministrativeAction;
    }
  ): void {
    this.assertActorShape(actor);

    if (scope.command) {
      this.assertCommandRole(scope.command, actor);
    }

    if (scope.administrativeAction) {
      this.assertAdministrativeActionRole(scope.administrativeAction, actor);
    }

    const evaluationTimeMs = normalizeEvaluationTime(actor.initiatedAt);
    const registeredActor = this.registry.get(actor.actorId);
    if (!registeredActor) {
      if (this.tryAuthorizeIssuedToken(actor, evaluationTimeMs, scope)) {
        return;
      }

      if (this.mode === "enforced" && !this.isAnonymousInternalAllowed(actor)) {
        throw new ActorAuthorizationError(
          "unauthorized",
          `Actor '${actor.actorId}' is not registered for ${actor.transport} access.`,
          {
            actorId: actor.actorId,
            actorRole: actor.actorRole,
            transport: actor.transport,
            command: scope.command,
            administrativeAction: scope.administrativeAction
          }
        );
      }
      return;
    }

    if (!registeredActor.enabled) {
      throw new ActorAuthorizationError(
        "forbidden",
        `Actor '${actor.actorId}' is disabled.`,
        {
          actorId: actor.actorId,
          command: scope.command,
          administrativeAction: scope.administrativeAction
        }
      );
    }

    if (
      !isWithinValidityWindow(
        evaluationTimeMs,
        registeredActor.validFromMs,
        registeredActor.validUntilMs
      )
    ) {
      throw new ActorAuthorizationError(
        "forbidden",
        `Actor '${actor.actorId}' is outside its configured validity window.`,
        {
          actorId: actor.actorId,
          command: scope.command,
          administrativeAction: scope.administrativeAction,
          validFrom: registeredActor.validFromMs
            ? new Date(registeredActor.validFromMs).toISOString()
            : undefined,
          validUntil: registeredActor.validUntilMs
            ? new Date(registeredActor.validUntilMs).toISOString()
            : undefined
        }
      );
    }

    if (registeredActor.actorRole !== actor.actorRole) {
      throw new ActorAuthorizationError(
        "forbidden",
        `Actor '${actor.actorId}' cannot assume role '${actor.actorRole}'.`,
        {
          actorId: actor.actorId,
          expectedRole: registeredActor.actorRole,
          actualRole: actor.actorRole,
          command: scope.command,
          administrativeAction: scope.administrativeAction
        }
      );
    }

    if (
      registeredActor.allowedTransports &&
      !registeredActor.allowedTransports.has(actor.transport)
    ) {
      throw new ActorAuthorizationError(
        "forbidden",
        `Actor '${actor.actorId}' is not allowed on transport '${actor.transport}'.`,
        {
          actorId: actor.actorId,
          transport: actor.transport,
          command: scope.command,
          administrativeAction: scope.administrativeAction
        }
      );
    }

    if (
      scope.command &&
      registeredActor.allowedCommands &&
      !registeredActor.allowedCommands.has(scope.command)
    ) {
      throw new ActorAuthorizationError(
        "forbidden",
        `Actor '${actor.actorId}' is not allowed to execute '${scope.command}'.`,
        {
          actorId: actor.actorId,
          command: scope.command
        }
      );
    }

    if (
      scope.administrativeAction &&
      registeredActor.allowedAdminActions &&
      !registeredActor.allowedAdminActions.has(scope.administrativeAction)
    ) {
      throw new ActorAuthorizationError(
        "forbidden",
        `Actor '${actor.actorId}' is not allowed to execute administrative action '${scope.administrativeAction}'.`,
        {
          actorId: actor.actorId,
          administrativeAction: scope.administrativeAction
        }
      );
    }

    if (registeredActor.source && registeredActor.source !== actor.source) {
      throw new ActorAuthorizationError(
        "forbidden",
        `Actor '${actor.actorId}' is bound to source '${registeredActor.source}', not '${actor.source}'.`,
        {
          actorId: actor.actorId,
          expectedSource: registeredActor.source,
          actualSource: actor.source,
          command: scope.command,
          administrativeAction: scope.administrativeAction
        }
      );
    }

    if (this.tryAuthorizeIssuedToken(actor, evaluationTimeMs, scope, registeredActor)) {
      return;
    }

    if ((registeredActor.authTokens?.length ?? 0) > 0) {
      const suppliedToken = actor.authToken?.trim();
      if (!suppliedToken) {
        throw new ActorAuthorizationError(
          "unauthorized",
          `Actor '${actor.actorId}' must provide a valid authentication token.`,
          {
            actorId: actor.actorId,
            transport: actor.transport,
            command: scope.command,
            administrativeAction: scope.administrativeAction
          }
        );
      }

      const matchedCredential = registeredActor.authTokens?.find(
        (credential) =>
          credential.token === suppliedToken &&
          isWithinValidityWindow(
            evaluationTimeMs,
            credential.validFromMs,
            credential.validUntilMs
          )
      );

      if (!matchedCredential) {
        const inactiveCredential = registeredActor.authTokens?.find(
          (credential) => credential.token === suppliedToken
        );
        throw new ActorAuthorizationError(
          "unauthorized",
          inactiveCredential
            ? `Actor '${actor.actorId}' supplied an expired or inactive authentication token.`
            : `Actor '${actor.actorId}' failed authentication.`,
          {
            actorId: actor.actorId,
            transport: actor.transport,
            command: scope.command,
            administrativeAction: scope.administrativeAction,
            credentialLabel: inactiveCredential?.label
          }
        );
      }

      return;
    }

    if (this.mode === "enforced" && actor.transport !== "internal") {
      throw new ActorAuthorizationError(
        "unauthorized",
        `Actor '${actor.actorId}' is registered without a token and cannot access '${actor.transport}' while auth is enforced.`,
        {
          actorId: actor.actorId,
          transport: actor.transport,
          command: scope.command,
          administrativeAction: scope.administrativeAction
        }
      );
    }
  }
}