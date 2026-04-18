import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  RUNTIME_COMMAND_DEFINITIONS,
  type RuntimeCliCommandName
} from "@mimir/contracts";
import type {
  ActorContext,
  ActorRole,
  AssembleAgentContextRequest,
  AssembleContextPacketRequest,
  CheckAiToolsRequest,
  CreateSessionArchiveRequest,
  CreateRefreshDraftBatchRequest,
  CreateRefreshDraftRequest,
  DraftNoteRequest,
  ExecuteCodingTaskRequest,
  GetDecisionSummaryRequest,
  GetAiToolPackagePlanRequest,
  ImportResourceRequest,
  ListAgentTracesRequest,
  ListAiToolsRequest,
  ListContextTreeRequest,
  PromoteNoteRequest,
  QueryHistoryRequest,
  ReadContextNodeRequest,
  RetrieveContextRequest,
  SearchSessionArchivesRequest,
  ServiceError,
  ShowToolOutputRequest,
  ValidateNoteRequest
} from "@mimir/contracts";
import {
  ActorAuthorizationError,
  buildServiceContainer,
  dispatchRuntimeCommand,
  FileIssuedTokenRevocationStore,
  getRuntimeCommandHttpStatus,
  issueActorAccessToken,
  loadEnvironment,
  recordIssuedAuthTokenAudit,
  recordRevokedAuthTokenAudit,
  runRuntimeHealthChecks,
  validateListIssuedActorTokensControlRequest,
  validateRevokeActorTokenControlRequest,
  TransportValidationError,
  validateInspectActorTokenControlRequest,
  validateIssueActorTokenControlRequest,
  validateTransportRequest,
  type AppEnvironment
} from "@mimir/infrastructure";

type RouteName = RuntimeCliCommandName;

type JsonRecord = Record<string, unknown>;

const DEFAULT_ACTOR_ROLE: Record<RouteName, ActorRole> = Object.fromEntries(
  RUNTIME_COMMAND_DEFINITIONS.map((command) => [
    command.cliName,
    command.defaultActorRole
  ])
) as Record<RouteName, ActorRole>;
const ROUTES: Record<string, { method: "GET" | "POST"; name?: RouteName; healthMode?: "live" | "ready" }> = {
  "/health/live": { method: "GET", healthMode: "live" },
  "/health/ready": { method: "GET", healthMode: "ready" },
  "/v1/system/auth": { method: "GET" },
  "/v1/system/auth/issued-tokens": { method: "GET" },
  "/v1/system/auth/issue-token": { method: "POST" },
  "/v1/system/auth/introspect-token": { method: "POST" },
  "/v1/system/auth/revoke-token": { method: "POST" },
  "/v1/system/freshness": { method: "GET" },
  "/v1/system/version": { method: "GET" },
  "/v1/coding/execute": { method: "POST", name: "execute-coding-task" },
  "/v1/coding/traces": { method: "POST", name: "list-agent-traces" },
  "/v1/coding/tool-output": { method: "POST", name: "show-tool-output" },
  "/v1/tools/ai": { method: "POST", name: "list-ai-tools" },
  "/v1/tools/ai/check": { method: "POST", name: "check-ai-tools" },
  "/v1/tools/ai/package-plan": { method: "POST", name: "tools-package-plan" },
  "/v1/context/search": { method: "POST", name: "search-context" },
  "/v1/context/agent-context": { method: "POST", name: "assemble-agent-context" },
  "/v1/context/tree": { method: "POST", name: "list-context-tree" },
  "/v1/context/node": { method: "POST", name: "read-context-node" },
  "/v1/context/packet": { method: "POST", name: "get-context-packet" },
  "/v1/context/decision-summary": { method: "POST", name: "fetch-decision-summary" },
  "/v1/notes/drafts": { method: "POST", name: "draft-note" },
  "/v1/review/queue": { method: "POST", name: "list-review-queue" },
  "/v1/review/note": { method: "POST", name: "read-review-note" },
  "/v1/review/accept": { method: "POST", name: "accept-note" },
  "/v1/review/reject": { method: "POST", name: "reject-note" },
  "/v1/system/freshness/refresh-draft": { method: "POST", name: "create-refresh-draft" },
  "/v1/system/freshness/refresh-drafts": { method: "POST", name: "create-refresh-drafts" },
  "/v1/notes/validate": { method: "POST", name: "validate-note" },
  "/v1/notes/promote": { method: "POST", name: "promote-note" },
  "/v1/maintenance/import-resource": { method: "POST", name: "import-resource" },
  "/v1/history/query": { method: "POST", name: "query-history" },
  "/v1/history/session-archives": { method: "POST", name: "create-session-archive" },
  "/v1/history/session-archives/search": { method: "POST", name: "search-session-archives" }
};
export interface RuntimeHttpRouteDefinition {
  path: string;
  method: "GET" | "POST";
  commandName: RouteName;
  defaultActorRole: ActorRole;
}

export function getRuntimeHttpRouteDefinitions(): RuntimeHttpRouteDefinition[] {
  const routeByCommandName = new Map<RouteName, { path: string; method: "GET" | "POST" }>();

  for (const [path, route] of Object.entries(ROUTES)) {
    if (route.name) {
      routeByCommandName.set(route.name, {
        path,
        method: route.method
      });
    }
  }

  return RUNTIME_COMMAND_DEFINITIONS.map((command) => {
    const route = routeByCommandName.get(command.cliName);
    if (!route) {
      throw new Error(`HTTP route is not registered for runtime command '${command.cliName}'.`);
    }

    return {
      path: route.path,
      method: route.method,
      commandName: command.cliName,
      defaultActorRole: DEFAULT_ACTOR_ROLE[command.cliName]
    };
  });
}

export interface MimirApiServer {
  env: AppEnvironment;
  server: Server;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export function createMimirApiServer(
  envInput: Partial<AppEnvironment> = loadEnvironment()
): MimirApiServer {
  const container = buildServiceContainer(envInput);
  const env = container.env;

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, container);
    } catch (error) {
      sendJson(response, mapUnhandledErrorToStatus(error), {
        ok: false,
        error: mapUnhandledError(error)
      });
    }
  });

  return {
    env,
    server,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(env.apiPort, env.apiHost, () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      container.dispose();
    }
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  container: ReturnType<typeof buildServiceContainer>
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const route = ROUTES[url.pathname];

  if (!route) {
    sendJson(response, 404, {
      ok: false,
      error: {
        code: "not_found",
        message: `Route '${url.pathname}' was not found.`
      }
    });
    return;
  }

  if (request.method !== route.method) {
    sendJson(response, 405, {
      ok: false,
      error: {
        code: "method_not_allowed",
        message: `Route '${url.pathname}' only supports ${route.method}.`
      }
    });
    return;
  }

  if (route.healthMode) {
    const report = await runRuntimeHealthChecks(container.env, route.healthMode, {
      vectorHealth: container.ports.vectorIndex?.getHealthSnapshot?.(),
      temporalValidity:
        await container.ports.metadataControlStore.getTemporalValiditySummary()
    });
    const statusCode =
      route.healthMode === "live"
        ? report.status === "fail" ? 503 : 200
        : report.status === "pass" ? 200 : 503;
    sendJson(response, statusCode, {
      ...report,
      release: container.env.release
    });
    return;
  }

  if (url.pathname === "/v1/system/version") {
    sendJson(response, 200, {
      ok: true,
      release: container.env.release
    });
    return;
  }

  if (url.pathname === "/v1/system/auth") {
    container.authPolicy.authorizeAdministrativeAction(
      "view_auth_status",
      buildAdministrativeActorContext("view_auth_status", request.headers)
    );
    sendJson(response, 200, {
      ok: true,
      auth: container.authPolicy.getRegistrySummary(),
      issuedTokens: container.ports.issuedTokenStore.getIssuedTokenSummary()
    });
    return;
  }

  if (url.pathname === "/v1/system/auth/issued-tokens") {
    container.authPolicy.authorizeAdministrativeAction(
      "view_issued_tokens",
      buildAdministrativeActorContext("view_issued_tokens", request.headers)
    );
    const query = parseIssuedTokensQuery(url.searchParams);
    sendJson(response, 200, {
      ok: true,
      issuedTokens: container.ports.issuedTokenStore.listIssuedTokens(query),
      summary: container.ports.issuedTokenStore.getIssuedTokenSummary(query)
    });
    return;
  }

  if (url.pathname === "/v1/system/auth/issue-token") {
    const administrativeActor = buildAdministrativeActorContext(
      "issue_auth_token",
      request.headers
    );
    container.authPolicy.authorizeAdministrativeAction(
      "issue_auth_token",
      administrativeActor
    );
    if (!container.env.auth.issuerSecret) {
      sendJson(response, 422, {
        ok: false,
        error: {
          code: "validation_failed",
          message: "MAB_AUTH_ISSUER_SECRET must be configured to issue actor access tokens."
        }
      });
      return;
    }

    const body = await readJsonBody(request);
    const validated = validateIssueActorTokenControlRequest(body);
    const issuedAt = new Date().toISOString();
    const validUntil =
      validated.validUntil ??
      (validated.ttlMinutes !== undefined
        ? new Date(Date.now() + validated.ttlMinutes * 60_000).toISOString()
        : undefined);
    const issuedToken = issueActorAccessToken(
      {
        actorId: validated.actorId,
        actorRole: validated.actorRole,
        source: validated.source,
        allowedTransports: validated.allowedTransports,
        allowedCommands: validated.allowedCommands,
        allowedAdminActions: validated.allowedAdminActions,
        allowedCorpora: validated.allowedCorpora,
        validFrom: validated.validFrom,
        validUntil,
        issuedAt
      },
      container.env.auth.issuerSecret
    );
    const warnings: string[] = [];
    const inspection = container.authPolicy.inspectToken(issuedToken);
    if (inspection.tokenKind === "issued" && inspection.claims?.tokenId) {
      container.ports.issuedTokenStore.recordIssuedToken(inspection.claims, {
        issuedBy: {
          actorId: administrativeActor.actorId,
          actorRole: administrativeActor.actorRole,
          source: administrativeActor.source,
          transport: administrativeActor.transport
        }
      });
      warnings.push(
        ...(await recordIssuedAuthTokenAudit({
          auditHistoryService: container.services.auditHistoryService,
          administrativeActor,
          tokenId: inspection.claims.tokenId,
          targetActorId: validated.actorId,
          targetActorRole: validated.actorRole,
          targetSource: validated.source,
          command: "issue-token",
          validFrom: validated.validFrom,
          validUntil,
          hasAllowedCommands: (validated.allowedCommands?.length ?? 0) > 0,
          hasAllowedAdminActions: (validated.allowedAdminActions?.length ?? 0) > 0,
          hasAllowedCorpora: (validated.allowedCorpora?.length ?? 0) > 0
        })).warnings
      );
    }

    sendJson(response, 200, {
      ok: true,
      issuedToken,
      claims: {
        ...validated,
        issuedAt,
        validUntil
      },
      ...(warnings.length > 0 ? { warnings } : {})
    });
    return;
  }

  if (url.pathname === "/v1/system/auth/introspect-token") {
    container.authPolicy.authorizeAdministrativeAction(
      "inspect_auth_token",
      buildAdministrativeActorContext("inspect_auth_token", request.headers)
    );
    const body = await readJsonBody(request);
    const validated = validateInspectActorTokenControlRequest(body);
    sendJson(response, 200, {
      ok: true,
      inspection: container.authPolicy.inspectToken(validated.token, {
        asOf: validated.asOf,
        expectedTransport: validated.expectedTransport,
        expectedCommand: validated.expectedCommand,
        expectedAdministrativeAction: validated.expectedAdministrativeAction
      })
    });
    return;
  }

  if (url.pathname === "/v1/system/auth/revoke-token") {
    const administrativeActor = buildAdministrativeActorContext(
      "revoke_auth_token",
      request.headers
    );
    container.authPolicy.authorizeAdministrativeAction(
      "revoke_auth_token",
      administrativeActor
    );
    if (!container.env.auth.issuedTokenRevocationPath) {
      sendJson(response, 422, {
        ok: false,
        error: {
          code: "validation_failed",
          message:
            "MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH must be configured to revoke actor access tokens."
        }
      });
      return;
    }

    const body = await readJsonBody(request);
    const validated = validateRevokeActorTokenControlRequest(body);
    const revocationStore = await FileIssuedTokenRevocationStore.create(
      container.env.auth.issuedTokenRevocationPath,
      container.authPolicy.getRevokedIssuedTokenIds()
    );
    const tokenId = resolveIssuedTokenIdForRevocation(
      validated,
      container.authPolicy
    );
    const revocation = await revocationStore.revokeTokenId(tokenId);
    container.authPolicy.revokeIssuedTokenId(tokenId);
    const ledgerRevocation = container.ports.issuedTokenStore.markTokenRevoked(
      tokenId,
      {
        reason: validated.reason,
        revokedBy: {
          actorId: administrativeActor.actorId,
          actorRole: administrativeActor.actorRole,
          source: administrativeActor.source,
          transport: administrativeActor.transport
        }
      }
    );
    const warnings = (
      await recordRevokedAuthTokenAudit({
        auditHistoryService: container.services.auditHistoryService,
        administrativeActor,
        tokenId,
        command: "revoke-token",
        reason: validated.reason,
        alreadyRevoked: revocation.alreadyRevoked,
        persisted: revocation.persisted,
        recordedTokenFound: ledgerRevocation.found
      })
    ).warnings;

    sendJson(response, 200, {
      ok: true,
      revokedTokenId: tokenId,
      alreadyRevoked: revocation.alreadyRevoked,
      persisted: revocation.persisted,
      recordedTokenFound: ledgerRevocation.found,
      reason: validated.reason,
      ...(warnings.length > 0 ? { warnings } : {})
    });
    return;
  }

  if (url.pathname === "/v1/system/freshness") {
    container.authPolicy.authorizeAdministrativeAction(
      "view_freshness_status",
      buildAdministrativeActorContext("view_freshness_status", request.headers)
    );
    sendJson(response, 200, {
      ok: true,
      freshness: await container.ports.metadataControlStore.getTemporalValidityReport(
        parseFreshnessQuery(url.searchParams)
      )
    });
    return;
  }

  if (!route.name) {
    sendJson(response, 500, {
      ok: false,
      error: {
        code: "route_configuration_invalid",
        message: `Route '${url.pathname}' is missing a service mapping.`
      }
    });
    return;
  }

  const body = await readJsonBody(request);
  const validatedBody = validateTransportRequest(route.name, body);
  const actor = buildActorContext(route.name, validatedBody.actor, request.headers);
  const normalizedRequest = { ...validatedBody, actor };

  const result = await dispatchRuntimeCommand(route.name, normalizedRequest, container);
  sendJson(response, getRuntimeCommandHttpStatus(route.name, result), result);
}

async function readJsonBody(request: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  let totalLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalLength += buffer.length;
    if (totalLength > 1024 * 1024) {
      throw new Error("HTTP request body exceeded the 1 MB safety limit.");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new Error("HTTP request body must be a JSON object.");
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("HTTP request body must be a JSON object.");
  }

  return parsed as JsonRecord;
}

function buildActorContext(
  routeName: RouteName,
  actor: unknown,
  headers: IncomingMessage["headers"]
): ActorContext {
  const input = actor && typeof actor === "object" ? actor as Partial<ActorContext> : {};
  const now = new Date().toISOString();

  return {
    actorId: firstHeader(headers["x-mimir-actor-id"]) ?? input.actorId ?? `${routeName}-http`,
    actorRole: (firstHeader(headers["x-mimir-actor-role"]) as ActorRole | undefined) ?? input.actorRole ?? DEFAULT_ACTOR_ROLE[routeName],
    transport: "http",
    source: firstHeader(headers["x-mimir-source"]) ?? input.source ?? "mimir-api",
    requestId: firstHeader(headers["x-request-id"]) ?? input.requestId ?? randomUUID(),
    initiatedAt: input.initiatedAt ?? now,
    toolName: firstHeader(headers["x-mimir-tool-name"]) ?? input.toolName ?? routeName,
    authToken: firstHeader(headers["x-mimir-actor-token"]) ?? input.authToken
  };
}

function buildAdministrativeActorContext(
  administrativeAction:
    | "view_auth_status"
    | "view_issued_tokens"
    | "issue_auth_token"
    | "inspect_auth_token"
    | "revoke_auth_token"
    | "view_freshness_status",
  headers: IncomingMessage["headers"]
): ActorContext {
  const now = new Date().toISOString();

  return {
    actorId: firstHeader(headers["x-mimir-actor-id"]) ?? `${administrativeAction}-http`,
    actorRole:
      (firstHeader(headers["x-mimir-actor-role"]) as ActorRole | undefined) ??
      "operator",
    transport: "http",
    source: firstHeader(headers["x-mimir-source"]) ?? "mimir-api",
    requestId: firstHeader(headers["x-request-id"]) ?? randomUUID(),
    initiatedAt: now,
    toolName: firstHeader(headers["x-mimir-tool-name"]) ?? administrativeAction,
    authToken: firstHeader(headers["x-mimir-actor-token"])
  };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseFreshnessQuery(searchParams: URLSearchParams): {
  asOf?: string;
  expiringWithinDays?: number;
  corpusId?: "mimisbrunnr" | "general_notes";
  limitPerCategory?: number;
} {
  const asOf = searchParams.get("asOf") ?? undefined;
  const expiringWithinDays = parseOptionalPositiveIntegerQuery(
    searchParams,
    "expiringWithinDays"
  );
  const limitPerCategory = parseOptionalPositiveIntegerQuery(
    searchParams,
    "limitPerCategory"
  );
  const corpusId = searchParams.get("corpusId");

  if (
    corpusId !== null &&
    corpusId !== "mimisbrunnr" &&
    corpusId !== "general_notes"
  ) {
    throw new TransportValidationError(
      "Invalid request field 'corpusId': must be one of: mimisbrunnr, general_notes.",
      {
        field: "corpusId",
        problem: "must be one of: mimisbrunnr, general_notes"
      }
    );
  }

  return {
    asOf,
    expiringWithinDays,
    limitPerCategory,
    corpusId: corpusId ?? undefined
  };
}

function parseIssuedTokensQuery(searchParams: URLSearchParams): {
  actorId?: string;
  asOf?: string;
  includeRevoked?: boolean;
  issuedByActorId?: string;
  revokedByActorId?: string;
  lifecycleStatus?: "active" | "future" | "expired" | "revoked";
  limit?: number;
} {
  return validateListIssuedActorTokensControlRequest({
    actorId: searchParams.get("actorId") ?? undefined,
    asOf: searchParams.get("asOf") ?? undefined,
    includeRevoked: parseOptionalBooleanQuery(searchParams, "includeRevoked"),
    issuedByActorId: searchParams.get("issuedByActorId") ?? undefined,
    revokedByActorId: searchParams.get("revokedByActorId") ?? undefined,
    lifecycleStatus: searchParams.get("lifecycleStatus") ?? undefined,
    limit: parseOptionalPositiveIntegerQuery(searchParams, "limit")
  });
}

function resolveIssuedTokenIdForRevocation(
  request: ReturnType<typeof validateRevokeActorTokenControlRequest>,
  authPolicy: ReturnType<typeof buildServiceContainer>["authPolicy"]
): string {
  if (request.tokenId) {
    return request.tokenId;
  }

  const inspection = authPolicy.inspectToken(request.token ?? "");
  if (inspection.tokenKind !== "issued" || !inspection.claims?.tokenId) {
    throw new TransportValidationError(
      "Invalid auth control field 'token': must be a valid issued actor token.",
      {
        field: "token",
        problem: "must be a valid issued actor token"
      }
    );
  }

  return inspection.claims.tokenId;
}

function parseOptionalPositiveIntegerQuery(
  searchParams: URLSearchParams,
  field: string
): number | undefined {
  const value = searchParams.get(field);
  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TransportValidationError(
      `Invalid request field '${field}': must be an integer greater than or equal to 1.`,
      {
        field,
        problem: "must be an integer greater than or equal to 1"
      }
    );
  }

  return parsed;
}

function parseOptionalBooleanQuery(
  searchParams: URLSearchParams,
  field: string
): boolean | undefined {
  const raw = searchParams.get(field);
  if (raw === null) {
    return undefined;
  }

  if (raw === "true") return true;
  if (raw === "false") return false;

  throw new TransportValidationError(
    `Invalid query parameter '${field}': must be 'true' or 'false'.`,
    {
      field,
      problem: "must be 'true' or 'false'"
    }
  );
}

function mapServiceErrorToStatus(error: ServiceError): number {
  switch (error.code) {
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "revision_conflict":
    case "duplicate_detected":
      return 409;
    case "validation_failed":
      return 422;
    default:
      return 500;
  }
}

function mapUnhandledErrorToStatus(error: unknown): number {
  if (error instanceof TransportValidationError) {
    return 400;
  }

  if (error instanceof ActorAuthorizationError) {
    return error.code === "unauthorized" ? 401 : 403;
  }

  return 500;
}

function mapUnhandledError(error: unknown): ServiceError {
  if (error instanceof TransportValidationError) {
    return error.toServiceError();
  }

  if (error instanceof ActorAuthorizationError) {
    return error.toServiceError();
  }

  return {
    code: "http_failed",
    message: error instanceof Error ? error.message : String(error)
  };
}

function mapCodingStatusToStatusCode(
  status: "success" | "fail" | "escalate"
): number {
  switch (status) {
    case "success":
      return 200;
    case "fail":
      return 422;
    case "escalate":
      return 409;
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body, null, 2));
}
