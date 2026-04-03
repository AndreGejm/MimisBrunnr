import type {
  ActorContext,
  ActorRole,
  ServiceError,
  TransportKind
} from "@multi-agent-brain/contracts";
import type { OrchestratorCommand } from "../routing/task-family-router.js";

export type ActorAuthorizationMode = "permissive" | "enforced";

export interface ActorRegistryEntry {
  actorId: string;
  actorRole: ActorRole;
  authToken?: string;
  source?: string;
  enabled?: boolean;
  allowedTransports?: TransportKind[];
  allowedCommands?: OrchestratorCommand[];
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
  authToken?: string;
  source?: string;
  enabled: boolean;
  allowedTransports?: ReadonlySet<TransportKind>;
  allowedCommands?: ReadonlySet<OrchestratorCommand>;
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

    if (registeredActor.authToken) {
      if (actor.authToken !== registeredActor.authToken) {
        throw new ActorAuthorizationError(
          "unauthorized",
          `Actor '${actor.actorId}' failed authentication.`,
          {
            actorId: actor.actorId,
            transport: actor.transport,
            command
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
    authToken: entry.authToken?.trim() || undefined,
    source: entry.source?.trim() || undefined,
    enabled: entry.enabled ?? true,
    allowedTransports:
      entry.allowedTransports && entry.allowedTransports.length > 0
        ? new Set(entry.allowedTransports)
        : undefined,
    allowedCommands:
      entry.allowedCommands && entry.allowedCommands.length > 0
        ? new Set(entry.allowedCommands)
        : undefined
  };
}
