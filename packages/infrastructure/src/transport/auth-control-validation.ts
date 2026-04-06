import type { ActorRole, TransportKind } from "@multi-agent-brain/contracts";
import type {
  AdministrativeAction,
  OrchestratorCommand
} from "@multi-agent-brain/orchestration";
import { TransportValidationError } from "./request-validation.js";

type JsonRecord = Record<string, unknown>;

const ACTOR_ROLES = new Set<ActorRole>([
  "retrieval",
  "writer",
  "orchestrator",
  "system",
  "operator"
]);

const TRANSPORTS = new Set<TransportKind>([
  "internal",
  "cli",
  "http",
  "mcp",
  "automation"
]);

const COMMAND_NAMES = new Set<OrchestratorCommand>([
  "execute_coding_task",
  "search_context",
  "get_context_packet",
  "fetch_decision_summary",
  "draft_note",
  "create_refresh_draft",
  "validate_note",
  "promote_note",
  "query_history"
]);

const ADMIN_ACTION_NAMES = new Set<AdministrativeAction>([
  "view_auth_status",
  "issue_auth_token",
  "inspect_auth_token",
  "revoke_auth_token",
  "view_freshness_status"
]);

export interface IssueActorTokenControlRequest {
  actorId: string;
  actorRole: ActorRole;
  source?: string;
  allowedTransports?: TransportKind[];
  allowedCommands?: OrchestratorCommand[];
  allowedAdminActions?: AdministrativeAction[];
  allowedCorpora?: string[];
  validFrom?: string;
  validUntil?: string;
  ttlMinutes?: number;
}

export interface InspectActorTokenControlRequest {
  token: string;
  asOf?: string;
  expectedTransport?: TransportKind;
  expectedCommand?: OrchestratorCommand;
  expectedAdministrativeAction?: AdministrativeAction;
}

export interface RevokeActorTokenControlRequest {
  token?: string;
  tokenId?: string;
  reason?: string;
}

export function validateIssueActorTokenControlRequest(
  payload: JsonRecord
): IssueActorTokenControlRequest {
  return {
    actorId: requireString(payload.actorId, "actorId"),
    actorRole: requireEnum(payload.actorRole, "actorRole", ACTOR_ROLES),
    source: optionalString(payload.source, "source"),
    allowedTransports: optionalEnumArray(
      payload.allowedTransports,
      "allowedTransports",
      TRANSPORTS
    ),
    allowedCommands: optionalEnumArray(
      payload.allowedCommands,
      "allowedCommands",
      COMMAND_NAMES
    ),
    allowedAdminActions: optionalEnumArray(
      payload.allowedAdminActions,
      "allowedAdminActions",
      ADMIN_ACTION_NAMES
    ),
    allowedCorpora: optionalStringArray(payload.allowedCorpora, "allowedCorpora"),
    validFrom: optionalString(payload.validFrom, "validFrom"),
    validUntil: optionalString(payload.validUntil, "validUntil"),
    ttlMinutes: optionalInteger(payload.ttlMinutes, "ttlMinutes", 1)
  };
}

export function validateInspectActorTokenControlRequest(
  payload: JsonRecord
): InspectActorTokenControlRequest {
  return {
    token: requireString(payload.token, "token"),
    asOf: optionalString(payload.asOf, "asOf"),
    expectedTransport: optionalEnum(
      payload.expectedTransport,
      "expectedTransport",
      TRANSPORTS
    ),
    expectedCommand: optionalEnum(
      payload.expectedCommand,
      "expectedCommand",
      COMMAND_NAMES
    ),
    expectedAdministrativeAction: optionalEnum(
      payload.expectedAdministrativeAction,
      "expectedAdministrativeAction",
      ADMIN_ACTION_NAMES
    )
  };
}

export function validateRevokeActorTokenControlRequest(
  payload: JsonRecord
): RevokeActorTokenControlRequest {
  const token = optionalString(payload.token, "token");
  const tokenId = optionalString(payload.tokenId, "tokenId");
  if (!token && !tokenId) {
    throw validationError("token", "token or tokenId must be supplied");
  }

  return {
    token,
    tokenId,
    reason: optionalString(payload.reason, "reason")
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw validationError(field, "must be a non-empty string");
  }

  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireString(value, field);
}

function optionalStringArray(
  value: unknown,
  field: string
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw validationError(field, "must be an array");
  }

  return value.map((item, index) => requireString(item, `${field}[${index}]`));
}

function requireInteger(value: unknown, field: string, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw validationError(
      field,
      `must be an integer greater than or equal to ${min}`
    );
  }

  return value;
}

function optionalInteger(
  value: unknown,
  field: string,
  min: number
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireInteger(value, field, min);
}

function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>
): T {
  const normalized = requireString(value, field);
  if (!allowedValues.has(normalized as T)) {
    throw validationError(
      field,
      `must be one of ${[...allowedValues].join(", ")}`
    );
  }

  return normalized as T;
}

function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireEnum(value, field, allowedValues);
}

function optionalEnumArray<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>
): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw validationError(field, "must be an array");
  }

  return value.map((item, index) =>
    requireEnum(item, `${field}[${index}]`, allowedValues)
  );
}

function validationError(field: string, problem: string): TransportValidationError {
  return new TransportValidationError(
    `Invalid auth control field '${field}': ${problem}.`,
    { field, problem }
  );
}
