import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type {
  ActorContext,
  ActorRole,
  AssembleContextPacketRequest,
  DraftNoteRequest,
  ExecuteCodingTaskRequest,
  GetDecisionSummaryRequest,
  PromoteNoteRequest,
  QueryHistoryRequest,
  RetrieveContextRequest,
  ServiceError,
  ValidateNoteRequest
} from "@multi-agent-brain/contracts";
import {
  ActorAuthorizationError,
  buildServiceContainer,
  loadEnvironment,
  runRuntimeHealthChecks,
  TransportValidationError,
  validateTransportRequest,
  type AppEnvironment
} from "@multi-agent-brain/infrastructure";

type RouteName =
  | "execute-coding-task"
  | "search-context"
  | "get-context-packet"
  | "fetch-decision-summary"
  | "draft-note"
  | "validate-note"
  | "promote-note"
  | "query-history";

type JsonRecord = Record<string, unknown>;

const DEFAULT_ACTOR_ROLE: Record<RouteName, ActorRole> = {
  "execute-coding-task": "operator",
  "search-context": "retrieval",
  "get-context-packet": "retrieval",
  "fetch-decision-summary": "retrieval",
  "draft-note": "writer",
  "validate-note": "orchestrator",
  "promote-note": "orchestrator",
  "query-history": "operator"
};

const ROUTES: Record<string, { method: "GET" | "POST"; name?: RouteName; healthMode?: "live" | "ready" }> = {
  "/health/live": { method: "GET", healthMode: "live" },
  "/health/ready": { method: "GET", healthMode: "ready" },
  "/v1/system/auth": { method: "GET" },
  "/v1/system/version": { method: "GET" },
  "/v1/coding/execute": { method: "POST", name: "execute-coding-task" },
  "/v1/context/search": { method: "POST", name: "search-context" },
  "/v1/context/packet": { method: "POST", name: "get-context-packet" },
  "/v1/context/decision-summary": { method: "POST", name: "fetch-decision-summary" },
  "/v1/notes/drafts": { method: "POST", name: "draft-note" },
  "/v1/notes/validate": { method: "POST", name: "validate-note" },
  "/v1/notes/promote": { method: "POST", name: "promote-note" },
  "/v1/history/query": { method: "POST", name: "query-history" }
};

export interface BrainApiServer {
  env: AppEnvironment;
  server: Server;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export function createBrainApiServer(
  envInput: Partial<AppEnvironment> = loadEnvironment()
): BrainApiServer {
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
    sendJson(response, 200, {
      ok: true,
      auth: container.authPolicy.getRegistrySummary()
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

  switch (route.name) {
    case "execute-coding-task": {
      const result = await container.orchestrator.executeCodingTask(
        normalizedRequest as unknown as ExecuteCodingTaskRequest
      );
      sendJson(response, mapCodingStatusToStatusCode(result.status), result);
      return;
    }
    case "search-context": {
      const result = await container.orchestrator.searchContext(
        normalizedRequest as unknown as RetrieveContextRequest
      );
      sendJson(response, result.ok ? 200 : mapServiceErrorToStatus(result.error), result);
      return;
    }
    case "get-context-packet": {
      const result = await container.orchestrator.getContextPacket(
        normalizedRequest as unknown as AssembleContextPacketRequest
      );
      sendJson(response, 200, result);
      return;
    }
    case "fetch-decision-summary": {
      const result = await container.orchestrator.fetchDecisionSummary(
        normalizedRequest as unknown as GetDecisionSummaryRequest
      );
      sendJson(response, result.ok ? 200 : mapServiceErrorToStatus(result.error), result);
      return;
    }
    case "draft-note": {
      const result = await container.orchestrator.draftNote(
        normalizedRequest as unknown as DraftNoteRequest
      );
      sendJson(response, result.ok ? 200 : mapServiceErrorToStatus(result.error), result);
      return;
    }
    case "validate-note": {
      const result = container.orchestrator.validateNote(
        normalizedRequest as unknown as ValidateNoteRequest
      );
      sendJson(response, result.valid ? 200 : 422, result);
      return;
    }
    case "promote-note": {
      const result = await container.orchestrator.promoteNote(
        normalizedRequest as unknown as PromoteNoteRequest
      );
      sendJson(response, result.ok ? 200 : mapServiceErrorToStatus(result.error), result);
      return;
    }
    case "query-history": {
      const result = await container.orchestrator.queryHistory(
        normalizedRequest as unknown as QueryHistoryRequest
      );
      sendJson(response, result.ok ? 200 : mapServiceErrorToStatus(result.error), result);
      return;
    }
  }
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
    actorId: firstHeader(headers["x-brain-actor-id"]) ?? input.actorId ?? `${routeName}-http`,
    actorRole: (firstHeader(headers["x-brain-actor-role"]) as ActorRole | undefined) ?? input.actorRole ?? DEFAULT_ACTOR_ROLE[routeName],
    transport: "http",
    source: firstHeader(headers["x-brain-source"]) ?? input.source ?? "brain-api",
    requestId: firstHeader(headers["x-request-id"]) ?? input.requestId ?? randomUUID(),
    initiatedAt: input.initiatedAt ?? now,
    toolName: firstHeader(headers["x-brain-tool-name"]) ?? input.toolName ?? routeName,
    authToken: firstHeader(headers["x-brain-actor-token"]) ?? input.authToken
  };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
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
