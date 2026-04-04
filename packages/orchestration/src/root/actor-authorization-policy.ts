import type {
  ActorContext,
  ActorRole,
  ServiceError,
  TransportKind
} from "@multi-agent-brain/contracts";
import type { OrchestratorCommand } from "../routing/task-family-router.js";

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
  validFrom?: string;
  validUntil?: string;
}

export interface ActorAuthorizationOptions {
  mode?: ActorAuthorizationMode;
  allowAnonymousInternal?: boolean;
  registry?: ReadonlyArray<ActorRegistryEntry>;
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
  search_context: new Set(["retrieval", "operator", "orchestrator", "system"]),
  get_context_packet: new Set(["retrieval", "operator", "orchestrator", "system"]),
  fetch_decision_summary: new Set(["retrieval", "operator", "orchestrator", "system"]),
  draft_note: new Set(["writer", "operator", "orchestrator", "system"]),
  validate_note: new Set(["operator", "orchestrator", "system"]),
  promote_note: new Set(["operator", "orchestrator", "system"]),
  query_history: new Set(["operator", "orchestrator", "system"])
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

  constructor(options: ActorAuthorizationOptions = {}) {
    this.mode = options.mode ?? "permissive";
    this.allowAnonymousInternal = options.allowAnonymousInternal ?? true;
    this.registry = new Map(
      (options.registry ?? []).map((entry) => [entry.actorId, normalizeEntry(entry)])
    );
  }

  authorize(command: OrchestratorCommand, actor: ActorContext): void {
    this.assertActorShape(actor);
    this.assertCommandRole(command, actor);
    const evaluationTimeMs = normalizeEvaluationTime(actor.initiatedAt);

    const registeredActor = this.registry.get(actor.actorId);
    if (!registeredActor) {
      if (this.mode === "enforced" && !this.isAnonymousInternalAllowed(actor)) {
        throw new ActorAuthorizationError(
          "unauthorized",
          `Actor '${actor.actorId}' is not registered for ${actor.transport} access.`,
          {
            actorId: actor.actorId,
            actorRole: actor.actorRole,
            transport: actor.transport,
            command
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
          command
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
          command,
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
          command
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
          command
        }
      );
    }

    if (
      registeredActor.allowedCommands &&
      !registeredActor.allowedCommands.has(command)
    ) {
      throw new ActorAuthorizationError(
        "forbidden",
        `Actor '${actor.actorId}' is not allowed to execute '${command}'.`,
        {
          actorId: actor.actorId,
          command
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
          command
        }
      );
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
            command
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
            command,
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
          command
        }
      );
    }
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

  private isAnonymousInternalAllowed(actor: ActorContext): boolean {
    return this.allowAnonymousInternal && actor.transport === "internal";
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
