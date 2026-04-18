import type { ActorRole, TransportKind } from "@mimir/contracts";
import type {
  AdministrativeAction,
  OrchestratorCommand
} from "@mimir/orchestration";
import { TransportValidationError } from "./transport-validation-error.js";

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
  "search_context",
  "search_session_archives",
  "assemble_agent_context",
  "get_context_packet",
  "fetch_decision_summary",
  "draft_note",
  "create_session_archive",
  "create_refresh_draft",
  "create_refresh_drafts",
  "import_resource",
  "validate_note",
  "promote_note",
  "query_history",
  "execute_coding_task",
  "list_agent_traces",
  "show_tool_output",
  "list_ai_tools",
  "check_ai_tools"
]);

const ADMIN_ACTION_NAMES = new Set<AdministrativeAction>([
  "view_auth_status",
  "view_auth_issuers",
  "view_issued_tokens",
  "manage_auth_issuers",
  "issue_auth_token",
  "inspect_auth_token",
  "revoke_auth_token",
  "revoke_auth_tokens",
  "view_freshness_status"
]);
const ISSUED_TOKEN_LIFECYCLE_STATUSES = new Set<
  "active" | "future" | "expired" | "revoked"
>(["active", "future", "expired", "revoked"]);

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

export interface ListIssuedActorTokensControlRequest {
  actorId?: string;
  asOf?: string;
  includeRevoked?: boolean;
  issuedByActorId?: string;
  revokedByActorId?: string;
  lifecycleStatus?: "active" | "future" | "expired" | "revoked";
  limit?: number;
}

export interface RevokeIssuedActorTokensControlRequest
  extends ListIssuedActorTokensControlRequest {
  dryRun?: boolean;
  reason?: string;
}

export interface SetAuthIssuerStateControlRequest {
  actorId: string;
  enabled: boolean;
  allowIssueAuthToken: boolean;
  allowRevokeAuthToken: boolean;
  validFrom?: string;
  validUntil?: string;
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
    validFrom: optionalIsoTimestamp(payload.validFrom, "validFrom"),
    validUntil: optionalIsoTimestamp(payload.validUntil, "validUntil"),
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

export function validateListIssuedActorTokensControlRequest(
  payload: JsonRecord
): ListIssuedActorTokensControlRequest {
  return {
    actorId: optionalString(payload.actorId, "actorId"),
    asOf: optionalString(payload.asOf, "asOf"),
    includeRevoked: optionalBoolean(payload.includeRevoked, "includeRevoked"),
    issuedByActorId: optionalString(payload.issuedByActorId, "issuedByActorId"),
    revokedByActorId: optionalString(payload.revokedByActorId, "revokedByActorId"),
    lifecycleStatus: optionalEnum(
      payload.lifecycleStatus,
      "lifecycleStatus",
      ISSUED_TOKEN_LIFECYCLE_STATUSES
    ),
    limit: optionalInteger(payload.limit, "limit", 1)
  };
}

export function validateRevokeIssuedActorTokensControlRequest(
  payload: JsonRecord
): RevokeIssuedActorTokensControlRequest {
  const request = {
    ...validateListIssuedActorTokensControlRequest(payload),
    dryRun: optionalBoolean(payload.dryRun, "dryRun"),
    reason: optionalString(payload.reason, "reason")
  };

  if (
    request.actorId === undefined &&
    request.issuedByActorId === undefined &&
    request.revokedByActorId === undefined &&
    request.lifecycleStatus === undefined
  ) {
    throw validationError(
      "filters",
      "at least one of actorId, issuedByActorId, revokedByActorId, or lifecycleStatus must be supplied"
    );
  }

  return request;
}

export function validateSetAuthIssuerStateControlRequest(
  payload: JsonRecord
): SetAuthIssuerStateControlRequest {
  return {
    actorId: requireString(payload.actorId, "actorId"),
    enabled: requireBoolean(payload.enabled, "enabled"),
    allowIssueAuthToken: requireBoolean(
      payload.allowIssueAuthToken,
      "allowIssueAuthToken"
    ),
    allowRevokeAuthToken: requireBoolean(
      payload.allowRevokeAuthToken,
      "allowRevokeAuthToken"
    ),
    validFrom: optionalIsoTimestamp(payload.validFrom, "validFrom"),
    validUntil: optionalIsoTimestamp(payload.validUntil, "validUntil"),
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

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireBoolean(value, field);
}

function optionalIsoTimestamp(
  value: unknown,
  field: string
): string | undefined {
  const normalized = optionalString(value, field);
  if (normalized === undefined) {
    return undefined;
  }

  if (Number.isNaN(Date.parse(normalized))) {
    throw validationError(field, "must be a valid ISO-8601 timestamp");
  }

  return normalized;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw validationError(field, "must be a boolean");
  }

  return value;
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
