import type {
  ActorContext,
  TransportKind
} from "@mimir/contracts";
import type { OrchestratorCommand } from "../routing/task-family-router.js";
import type { AdministrativeAction } from "./administrative-action.js";
import type { ActorTokenInspection } from "./actor-authorization-policy.js";
import type { NormalizedActorRegistryEntry } from "./actor-registry-policy.js";
import {
  deriveActorLifecycleStatus,
  findStaticCredentialMatch,
  isWithinValidityWindow,
  normalizeEvaluationTime,
  parseValidityInstant
} from "./actor-registry-policy.js";
import {
  verifyActorAccessToken,
  type IssuedActorTokenClaims
} from "./issued-actor-token.js";

export interface ActorAuthorizationScope {
  command?: OrchestratorCommand;
  administrativeAction?: AdministrativeAction;
}

export interface InspectActorTokenOptions {
  token: string;
  asOf?: string;
  registry: ReadonlyMap<string, NormalizedActorRegistryEntry>;
  issuerSecret?: string;
  issuedTokenRequireRegistryMatch?: boolean;
  revokedIssuedTokenIds?: ReadonlySet<string>;
  isTokenRevoked?: (tokenId: string) => boolean;
  expectedTransport?: TransportKind;
  expectedCommand?: OrchestratorCommand;
  expectedAdministrativeAction?: AdministrativeAction;
}

export interface AuthorizeIssuedActorTokenOptions {
  actor: ActorContext;
  evaluationTimeMs: number;
  scope: ActorAuthorizationScope;
  issuerSecret?: string;
  issuedTokenRequireRegistryMatch: boolean;
  registeredActor?: NormalizedActorRegistryEntry;
  isTokenRevoked: (tokenId: string) => boolean;
}

export function inspectActorToken(
  options: InspectActorTokenOptions
): ActorTokenInspection {
  const asOf = options.asOf ?? new Date().toISOString();
  const evaluationTimeMs = normalizeEvaluationTime(asOf);
  const trimmedToken = options.token.trim();

  if (!trimmedToken) {
    return {
      asOf,
      tokenKind: "unknown",
      valid: false,
      reason: "missing_token"
    };
  }

  const staticMatch = findStaticCredentialMatch(options.registry, trimmedToken);
  if (staticMatch) {
    return inspectStaticToken({
      asOf,
      evaluationTimeMs,
      match: staticMatch,
      expectedTransport: options.expectedTransport,
      expectedCommand: options.expectedCommand,
      expectedAdministrativeAction: options.expectedAdministrativeAction
    });
  }

  if (options.issuerSecret) {
    try {
      const claims = verifyActorAccessToken(trimmedToken, options.issuerSecret);
      return inspectIssuedToken({
        asOf,
        claims,
        evaluationTimeMs,
        registry: options.registry,
        issuedTokenRequireRegistryMatch:
          options.issuedTokenRequireRegistryMatch ?? true,
        isTokenRevoked: buildRevocationChecker(options),
        expectedTransport: options.expectedTransport,
        expectedCommand: options.expectedCommand,
        expectedAdministrativeAction: options.expectedAdministrativeAction
      });
    } catch {
      // Fall through to unknown token shape.
    }
  }

  return {
    asOf,
    tokenKind: "unknown",
    valid: false,
    reason: "unrecognized_token"
  };
}

export function authorizeIssuedActorToken(
  options: AuthorizeIssuedActorTokenOptions
): boolean {
  const suppliedToken = options.actor.authToken?.trim();
  if (!options.issuerSecret || !suppliedToken) {
    return false;
  }

  if (options.issuedTokenRequireRegistryMatch && !options.registeredActor) {
    return false;
  }

  let claims: IssuedActorTokenClaims;
  try {
    claims = verifyActorAccessToken(suppliedToken, options.issuerSecret);
    if (
      !isWithinValidityWindow(
        options.evaluationTimeMs,
        parseValidityInstant(claims.validFrom, "issued token validFrom"),
        parseValidityInstant(claims.validUntil, "issued token validUntil")
      )
    ) {
      return false;
    }
    if (claims.tokenId && options.isTokenRevoked(claims.tokenId)) {
      return false;
    }
  } catch {
    return false;
  }

  if (
    claims.actorId !== options.actor.actorId ||
    claims.actorRole !== options.actor.actorRole
  ) {
    return false;
  }

  if (claims.source && claims.source !== options.actor.source) {
    return false;
  }

  if (
    claims.allowedTransports?.length &&
    !claims.allowedTransports.includes(options.actor.transport)
  ) {
    return false;
  }

  if (
    claims.allowedCommands?.length &&
    options.scope.command !== undefined &&
    !claims.allowedCommands.includes(options.scope.command)
  ) {
    return false;
  }

  if (
    claims.allowedAdminActions?.length &&
    options.scope.administrativeAction !== undefined &&
    !claims.allowedAdminActions.includes(options.scope.administrativeAction)
  ) {
    return false;
  }

  return true;
}

function inspectStaticToken(options: {
  asOf: string;
  evaluationTimeMs: number;
  match: NonNullable<ReturnType<typeof findStaticCredentialMatch>>;
  expectedTransport?: TransportKind;
  expectedCommand?: OrchestratorCommand;
  expectedAdministrativeAction?: AdministrativeAction;
}): ActorTokenInspection {
  const lifecycleStatus = deriveActorLifecycleStatus(
    options.match.entry,
    options.evaluationTimeMs
  );
  const credentialActive = isWithinValidityWindow(
    options.evaluationTimeMs,
    options.match.credential.validFromMs,
    options.match.credential.validUntilMs
  );
  const transportAllowed =
    options.expectedTransport === undefined ||
    !options.match.entry.allowedTransports ||
    options.match.entry.allowedTransports.has(options.expectedTransport);
  const commandAllowed =
    options.expectedCommand === undefined ||
    !options.match.entry.allowedCommands ||
    options.match.entry.allowedCommands.has(options.expectedCommand);
  const administrativeActionAllowed =
    options.expectedAdministrativeAction === undefined ||
    !options.match.entry.allowedAdminActions ||
    options.match.entry.allowedAdminActions.has(options.expectedAdministrativeAction);

  return {
    asOf: options.asOf,
    tokenKind: "static",
    valid:
      options.match.entry.enabled &&
      lifecycleStatus === "active" &&
      credentialActive &&
      transportAllowed &&
      commandAllowed &&
      administrativeActionAllowed,
    reason: !options.match.entry.enabled
      ? "actor_disabled"
      : lifecycleStatus !== "active"
        ? `actor_${lifecycleStatus}`
        : !credentialActive
          ? "inactive_static_token"
          : !transportAllowed
            ? "transport_not_allowed"
            : !commandAllowed
              ? "command_not_allowed"
              : !administrativeActionAllowed
                ? "administrative_action_not_allowed"
                : undefined,
    matchedActor: {
      actorId: options.match.entry.actorId,
      actorRole: options.match.entry.actorRole,
      source: options.match.entry.source,
      lifecycleStatus,
      enabled: options.match.entry.enabled
    },
    authorization: {
      transport: options.expectedTransport,
      transportAllowed,
      command: options.expectedCommand,
      commandAllowed,
      administrativeAction: options.expectedAdministrativeAction,
      administrativeActionAllowed
    }
  };
}

function inspectIssuedToken(options: {
  asOf: string;
  claims: IssuedActorTokenClaims;
  evaluationTimeMs: number;
  registry: ReadonlyMap<string, NormalizedActorRegistryEntry>;
  issuedTokenRequireRegistryMatch: boolean;
  isTokenRevoked: (tokenId: string) => boolean;
  expectedTransport?: TransportKind;
  expectedCommand?: OrchestratorCommand;
  expectedAdministrativeAction?: AdministrativeAction;
}): ActorTokenInspection {
  const registryEntry = options.registry.get(options.claims.actorId);
  const validWindow = isWithinValidityWindow(
    options.evaluationTimeMs,
    parseValidityInstant(options.claims.validFrom, "issued token validFrom"),
    parseValidityInstant(options.claims.validUntil, "issued token validUntil")
  );
  const lifecycleStatus = registryEntry
    ? deriveActorLifecycleStatus(registryEntry, options.evaluationTimeMs)
    : "active";
  const registryMatch =
    !options.issuedTokenRequireRegistryMatch ||
    (registryEntry !== undefined &&
      registryEntry.actorRole === options.claims.actorRole &&
      (!options.claims.source ||
        !registryEntry.source ||
        registryEntry.source === options.claims.source));
  const revoked =
    Boolean(options.claims.tokenId) &&
    options.isTokenRevoked(options.claims.tokenId as string);
  const transportAllowed =
    options.expectedTransport === undefined ||
    !options.claims.allowedTransports?.length ||
    options.claims.allowedTransports.includes(options.expectedTransport);
  const commandAllowed =
    options.expectedCommand === undefined ||
    !options.claims.allowedCommands?.length ||
    options.claims.allowedCommands.includes(options.expectedCommand);
  const administrativeActionAllowed =
    options.expectedAdministrativeAction === undefined ||
    !options.claims.allowedAdminActions?.length ||
    options.claims.allowedAdminActions.includes(options.expectedAdministrativeAction);

  return {
    asOf: options.asOf,
    tokenKind: "issued",
    valid:
      validWindow &&
      !revoked &&
      registryMatch &&
      transportAllowed &&
      commandAllowed &&
      administrativeActionAllowed &&
      (!registryEntry || (registryEntry.enabled && lifecycleStatus === "active")),
    reason: !validWindow
      ? "inactive_issued_token"
      : revoked
        ? "revoked_issued_token"
        : !registryMatch
          ? "registry_mismatch"
          : !transportAllowed
            ? "transport_not_allowed"
            : !commandAllowed
              ? "command_not_allowed"
              : !administrativeActionAllowed
                ? "administrative_action_not_allowed"
                : registryEntry && !registryEntry.enabled
                  ? "actor_disabled"
                  : registryEntry && lifecycleStatus !== "active"
                    ? `actor_${lifecycleStatus}`
                    : undefined,
    claims: options.claims,
    matchedActor: registryEntry
      ? {
          actorId: registryEntry.actorId,
          actorRole: registryEntry.actorRole,
          source: registryEntry.source,
          lifecycleStatus,
          enabled: registryEntry.enabled
        }
      : undefined,
    authorization: {
      transport: options.expectedTransport,
      transportAllowed,
      command: options.expectedCommand,
      commandAllowed,
      administrativeAction: options.expectedAdministrativeAction,
      administrativeActionAllowed
    }
  };
}

function buildRevocationChecker(
  options: InspectActorTokenOptions
): (tokenId: string) => boolean {
  return (tokenId: string) =>
    options.revokedIssuedTokenIds?.has(tokenId) === true ||
    options.isTokenRevoked?.(tokenId) === true;
}