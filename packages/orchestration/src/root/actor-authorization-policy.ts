import type {
  ActorContext,
  ActorRole,
  ServiceError,
  TransportKind
} from "@multi-agent-brain/contracts";
import type { OrchestratorCommand } from "../routing/task-family-router.js";
import type { AdministrativeAction } from "./administrative-action.js";
import {
  verifyActorAccessToken,
  type IssuedActorTokenClaims
} from "./issued-actor-token.js";

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

interface NormalizedActorRegistryEntry {
  actorId: string;
  actorRole: ActorRole;
  authTokens?: ReadonlyArray<NormalizedActorTokenCredential>;
  source?: string;
  enabled: boolean;
  allowedTransports?: ReadonlySet<TransportKind>;
  allowedCommands?: ReadonlySet<OrchestratorCommand>;
  allowedAdminActions?: ReadonlySet<AdministrativeAction>;
  validFromMs?: number;
  validUntilMs?: number;
}

interface NormalizedActorTokenCredential {
  token: string;
  label?: string;
  validFromMs?: number;
  validUntilMs?: number;
}

const COMMAND_ROLE_POLICY: Record<OrchestratorCommand, ReadonlySet<ActorRole>> = {
  execute_coding_task: new Set(["operator", "system"]),
  list_agent_traces: new Set(["operator", "orchestrator", "system"]),
  show_tool_output: new Set(["operator", "system"]),
  search_context: new Set(["retrieval", "operator", "orchestrator", "system"]),
  search_session_archives: new Set(["retrieval", "operator", "orchestrator", "system"]),
  assemble_agent_context: new Set(["retrieval", "operator", "orchestrator", "system"]),
  get_context_packet: new Set(["retrieval", "operator", "orchestrator", "system"]),
  fetch_decision_summary: new Set(["retrieval", "operator", "orchestrator", "system"]),
  draft_note: new Set(["writer", "operator", "orchestrator", "system"]),
  create_session_archive: new Set(["operator", "system"]),
  create_refresh_draft: new Set(["operator", "orchestrator", "system"]),
  create_refresh_drafts: new Set(["operator", "orchestrator", "system"]),
  import_resource: new Set(["operator", "orchestrator", "system"]),
  validate_note: new Set(["operator", "orchestrator", "system"]),
  promote_note: new Set(["operator", "orchestrator", "system"]),
  query_history: new Set(["operator", "orchestrator", "system"])
};

const ADMIN_ACTION_ROLE_POLICY: Record<AdministrativeAction, ReadonlySet<ActorRole>> = {
  view_auth_status: new Set(["operator", "system"]),
  view_issued_tokens: new Set(["operator", "system"]),
  issue_auth_token: new Set(["operator", "system"]),
  inspect_auth_token: new Set(["operator", "system"]),
  revoke_auth_token: new Set(["operator", "system"]),
  view_freshness_status: new Set(["operator", "orchestrator", "system"])
};

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
    this.registry = new Map(
      (options.registry ?? []).map((entry) => [entry.actorId, normalizeEntry(entry)])
    );
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
    const allowedRoles = COMMAND_ROLE_POLICY[command];
    if (allowedRoles.has(actor.actorRole)) {
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
    const allowedRoles = ADMIN_ACTION_ROLE_POLICY[administrativeAction];
    if (allowedRoles.has(actor.actorRole)) {
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

  getRegistrySummary(asOf: string = new Date().toISOString()): ActorRegistrySummary {
    const evaluationTimeMs = normalizeEvaluationTime(asOf);
    const actors = [...this.registry.values()].map((entry) =>
      summarizeEntry(entry, evaluationTimeMs)
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
    const asOf = options.asOf ?? new Date().toISOString();
    const evaluationTimeMs = normalizeEvaluationTime(asOf);
    const trimmedToken = token.trim();

    if (!trimmedToken) {
      return {
        asOf,
        tokenKind: "unknown",
        valid: false,
        reason: "missing_token"
      };
    }

    const staticMatch = findStaticCredentialMatch(this.registry, trimmedToken);
    if (staticMatch) {
      const lifecycleStatus = deriveActorLifecycleStatus(
        staticMatch.entry,
        evaluationTimeMs
      );
      const credentialActive = isWithinValidityWindow(
        evaluationTimeMs,
        staticMatch.credential.validFromMs,
        staticMatch.credential.validUntilMs
      );
      const transportAllowed =
        options.expectedTransport === undefined ||
        !staticMatch.entry.allowedTransports ||
        staticMatch.entry.allowedTransports.has(options.expectedTransport);
      const commandAllowed =
        options.expectedCommand === undefined ||
        !staticMatch.entry.allowedCommands ||
        staticMatch.entry.allowedCommands.has(options.expectedCommand);
      const administrativeActionAllowed =
        options.expectedAdministrativeAction === undefined ||
        !staticMatch.entry.allowedAdminActions ||
        staticMatch.entry.allowedAdminActions.has(options.expectedAdministrativeAction);

      return {
        asOf,
        tokenKind: "static",
        valid:
          staticMatch.entry.enabled &&
          lifecycleStatus === "active" &&
          credentialActive &&
          transportAllowed &&
          commandAllowed &&
          administrativeActionAllowed,
        reason: !staticMatch.entry.enabled
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
          actorId: staticMatch.entry.actorId,
          actorRole: staticMatch.entry.actorRole,
          source: staticMatch.entry.source,
          lifecycleStatus,
          enabled: staticMatch.entry.enabled
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

    if (this.issuerSecret) {
      try {
        const claims = verifyActorAccessToken(trimmedToken, this.issuerSecret);
        const registryEntry = this.registry.get(claims.actorId);
        const validWindow = isWithinValidityWindow(
          evaluationTimeMs,
          parseValidityInstant(claims.validFrom, "issued token validFrom"),
          parseValidityInstant(claims.validUntil, "issued token validUntil")
        );
        const lifecycleStatus = registryEntry
          ? deriveActorLifecycleStatus(registryEntry, evaluationTimeMs)
          : "active";
        const registryMatch =
          !this.issuedTokenRequireRegistryMatch ||
          (registryEntry !== undefined &&
            registryEntry.actorRole === claims.actorRole &&
            (!claims.source || !registryEntry.source || registryEntry.source === claims.source));
        const revoked =
          Boolean(claims.tokenId) && this.isTokenRevoked(claims.tokenId as string);
        const transportAllowed =
          options.expectedTransport === undefined ||
          !claims.allowedTransports?.length ||
          claims.allowedTransports.includes(options.expectedTransport);
        const commandAllowed =
          options.expectedCommand === undefined ||
          !claims.allowedCommands?.length ||
          claims.allowedCommands.includes(options.expectedCommand);
        const administrativeActionAllowed =
          options.expectedAdministrativeAction === undefined ||
          !claims.allowedAdminActions?.length ||
          claims.allowedAdminActions.includes(options.expectedAdministrativeAction);

        return {
          asOf,
          tokenKind: "issued",
          valid:
            validWindow &&
            !revoked &&
            registryMatch &&
            transportAllowed &&
            commandAllowed &&
            administrativeActionAllowed &&
            (!registryEntry ||
              (registryEntry.enabled && lifecycleStatus === "active")),
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
          claims,
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

  private tryAuthorizeIssuedToken(
    actor: ActorContext,
    evaluationTimeMs: number,
    scope: {
      command?: OrchestratorCommand;
      administrativeAction?: AdministrativeAction;
    },
    registeredActor?: NormalizedActorRegistryEntry
  ): boolean {
    const suppliedToken = actor.authToken?.trim();
    if (!this.issuerSecret || !suppliedToken) {
      return false;
    }

    if (this.issuedTokenRequireRegistryMatch && !registeredActor) {
      return false;
    }

    let claims: IssuedActorTokenClaims;
    try {
      claims = verifyActorAccessToken(suppliedToken, this.issuerSecret);
      if (
        !isWithinValidityWindow(
          evaluationTimeMs,
          parseValidityInstant(claims.validFrom, "issued token validFrom"),
          parseValidityInstant(claims.validUntil, "issued token validUntil")
        )
      ) {
        return false;
      }
      if (claims.tokenId && this.isTokenRevoked(claims.tokenId)) {
        return false;
      }
    } catch {
      return false;
    }

    if (claims.actorId !== actor.actorId || claims.actorRole !== actor.actorRole) {
      return false;
    }

    if (claims.source && claims.source !== actor.source) {
      return false;
    }

    if (
      claims.allowedTransports?.length &&
      !claims.allowedTransports.includes(actor.transport)
    ) {
      return false;
    }

    if (
      claims.allowedCommands?.length &&
      scope.command !== undefined &&
      !claims.allowedCommands.includes(scope.command)
    ) {
      return false;
    }

    if (
      claims.allowedAdminActions?.length &&
      scope.administrativeAction !== undefined &&
      !claims.allowedAdminActions.includes(scope.administrativeAction)
    ) {
      return false;
    }

    return true;
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

function normalizeEntry(entry: ActorRegistryEntry): NormalizedActorRegistryEntry {
  return {
    actorId: entry.actorId.trim(),
    actorRole: entry.actorRole,
    authTokens: normalizeTokenCredentials(entry),
    source: entry.source?.trim() || undefined,
    enabled: entry.enabled ?? true,
    allowedTransports:
      entry.allowedTransports && entry.allowedTransports.length > 0
        ? new Set(entry.allowedTransports)
        : undefined,
    allowedCommands:
      entry.allowedCommands && entry.allowedCommands.length > 0
        ? new Set(entry.allowedCommands)
        : undefined,
    allowedAdminActions:
      entry.allowedAdminActions && entry.allowedAdminActions.length > 0
        ? new Set(entry.allowedAdminActions)
        : undefined,
    validFromMs: parseValidityInstant(
      entry.validFrom,
      `actor '${entry.actorId}' validFrom`
    ),
    validUntilMs: parseValidityInstant(
      entry.validUntil,
      `actor '${entry.actorId}' validUntil`
    )
  };
}

function normalizeTokenCredentials(
  entry: ActorRegistryEntry
): ReadonlyArray<NormalizedActorTokenCredential> | undefined {
  const credentials: NormalizedActorTokenCredential[] = [];

  if (entry.authToken?.trim()) {
    credentials.push({ token: entry.authToken.trim() });
  }

  for (const credential of entry.authTokens ?? []) {
    if (typeof credential === "string") {
      const token = credential.trim();
      if (token) {
        credentials.push({ token });
      }
      continue;
    }

    const token = credential.token?.trim();
    if (!token) {
      continue;
    }

    credentials.push({
      token,
      label: credential.label?.trim() || undefined,
      validFromMs: parseValidityInstant(
        credential.validFrom,
        `actor '${entry.actorId}' token '${credential.label ?? token}' validFrom`
      ),
      validUntilMs: parseValidityInstant(
        credential.validUntil,
        `actor '${entry.actorId}' token '${credential.label ?? token}' validUntil`
      )
    });
  }

  return credentials.length > 0 ? credentials : undefined;
}

function parseValidityInstant(
  value: string | undefined,
  label: string
): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid ISO-8601 timestamp.`);
  }

  return parsed;
}

function summarizeEntry(
  entry: NormalizedActorRegistryEntry,
  evaluationTimeMs: number
): ActorRegistryEntryStatus {
  const credentials = entry.authTokens ?? [];
  const activeCredentialCount = credentials.filter((credential) =>
    isWithinValidityWindow(
      evaluationTimeMs,
      credential.validFromMs,
      credential.validUntilMs
    )
  ).length;
  const futureCredentialCount = credentials.filter(
    (credential) =>
      credential.validFromMs !== undefined && evaluationTimeMs < credential.validFromMs
  ).length;
  const expiredCredentialCount = credentials.filter(
    (credential) =>
      credential.validUntilMs !== undefined && evaluationTimeMs > credential.validUntilMs
  ).length;

  return {
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    source: entry.source,
    enabled: entry.enabled,
    lifecycleStatus: deriveActorLifecycleStatus(entry, evaluationTimeMs),
    allowedTransports: entry.allowedTransports
      ? [...entry.allowedTransports]
      : undefined,
    allowedCommands: entry.allowedCommands ? [...entry.allowedCommands] : undefined,
    allowedAdminActions: entry.allowedAdminActions
      ? [...entry.allowedAdminActions]
      : undefined,
    staticCredentialCount: credentials.length,
    activeCredentialCount,
    futureCredentialCount,
    expiredCredentialCount
  };
}

function deriveActorLifecycleStatus(
  entry: NormalizedActorRegistryEntry,
  evaluationTimeMs: number
): ActorRegistryEntryStatus["lifecycleStatus"] {
  if (!entry.enabled) {
    return "disabled";
  }

  if (entry.validFromMs !== undefined && evaluationTimeMs < entry.validFromMs) {
    return "future";
  }

  if (entry.validUntilMs !== undefined && evaluationTimeMs > entry.validUntilMs) {
    return "expired";
  }

  return "active";
}

function normalizeEvaluationTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isWithinValidityWindow(
  evaluationTimeMs: number,
  validFromMs?: number,
  validUntilMs?: number
): boolean {
  if (validFromMs !== undefined && evaluationTimeMs < validFromMs) {
    return false;
  }

  if (validUntilMs !== undefined && evaluationTimeMs > validUntilMs) {
    return false;
  }

  return true;
}

function findStaticCredentialMatch(
  registry: ReadonlyMap<string, NormalizedActorRegistryEntry>,
  token: string
): {
  entry: NormalizedActorRegistryEntry;
  credential: NormalizedActorTokenCredential;
} | null {
  for (const entry of registry.values()) {
    for (const credential of entry.authTokens ?? []) {
      if (credential.token === token) {
        return { entry, credential };
      }
    }
  }

  return null;
}
