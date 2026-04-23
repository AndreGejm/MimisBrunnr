import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { ActorContext, ActorRole } from "@mimir/contracts";
import type { AdministrativeAction } from "@mimir/orchestration";
import {
  optionalEnum,
  optionalInteger,
  optionalString,
  requestValidationError,
  type JsonRecord
} from "./request-field-validation.js";

type FreshnessCorpusId = "mimisbrunnr" | "general_notes";

const FRESHNESS_CORPORA = new Set<FreshnessCorpusId>([
  "mimisbrunnr",
  "general_notes"
]);
const FRESHNESS_CORPUS_ALIASES = new Map<string, FreshnessCorpusId>([
  ["brain", "mimisbrunnr"],
  ["context_brain", "mimisbrunnr"],
  ["mimir_brunnr", "mimisbrunnr"],
  ["mimir-brunnr", "mimisbrunnr"],
  ["mimirbrunnr", "mimisbrunnr"],
  ["mimirsbrunn", "mimisbrunnr"],
  ["mimirsbrunnr", "mimisbrunnr"],
  ["mimis", "mimisbrunnr"],
  ["mimisbrunn", "mimisbrunnr"],
  ["multi agent brain", "mimisbrunnr"],
  ["multiagent brain", "mimisbrunnr"],
  ["multiagentbrain", "mimisbrunnr"],
  ["multiagent-brain", "mimisbrunnr"],
  ["multi-agent-brain", "mimisbrunnr"]
]);
const FRESHNESS_CORPUS_ALIAS_OPTIONS = {
  aliases: FRESHNESS_CORPUS_ALIASES
};

export interface FreshnessStatusRequest {
  asOf?: string;
  expiringWithinDays?: number;
  corpusId?: FreshnessCorpusId;
  limitPerCategory?: number;
}

export function buildCliAdministrativeActorContext(
  administrativeAction: AdministrativeAction,
  actor: unknown,
  environment: NodeJS.ProcessEnv = process.env
): ActorContext {
  const input = coerceActorContextInput(actor);
  const now = new Date().toISOString();
  const activeProfile = trimOrUndefined(environment.MAB_TOOLBOX_ACTIVE_PROFILE);
  const sessionPolicyToken =
    input.sessionPolicyToken ??
    trimOrUndefined(environment.MAB_TOOLBOX_SESSION_POLICY_TOKEN);

  return {
    actorId: input.actorId ?? `${administrativeAction}-cli`,
    actorRole: input.actorRole ?? "operator",
    transport: "cli",
    source: input.source ?? "mimir-cli-admin",
    requestId: input.requestId ?? randomUUID(),
    initiatedAt: input.initiatedAt ?? now,
    toolName: input.toolName ?? administrativeAction,
    authToken: input.authToken,
    sessionPolicyToken,
    toolboxSessionMode:
      input.toolboxSessionMode ??
      (trimOrUndefined(environment.MAB_TOOLBOX_SESSION_MODE) as
        | ActorContext["toolboxSessionMode"]
        | undefined) ??
      (activeProfile
        ? activeProfile === "bootstrap"
          ? "toolbox-bootstrap"
          : "toolbox-activated"
        : undefined),
    toolboxClientId:
      input.toolboxClientId ??
      trimOrUndefined(environment.MAB_TOOLBOX_CLIENT_ID),
    toolboxProfileId: input.toolboxProfileId ?? activeProfile
  };
}

export function buildHttpAdministrativeActorContext(
  administrativeAction: AdministrativeAction,
  headers: IncomingMessage["headers"]
): ActorContext {
  const now = new Date().toISOString();

  return {
    actorId:
      firstHeader(headers["x-mimir-actor-id"]) ??
      `${administrativeAction}-http`,
    actorRole:
      (firstHeader(headers["x-mimir-actor-role"]) as ActorRole | undefined) ??
      "operator",
    transport: "http",
    source: firstHeader(headers["x-mimir-source"]) ?? "mimir-api",
    requestId: firstHeader(headers["x-request-id"]) ?? randomUUID(),
    initiatedAt: now,
    toolName:
      firstHeader(headers["x-mimir-tool-name"]) ?? administrativeAction,
    authToken: firstHeader(headers["x-mimir-actor-token"])
  };
}

export function extractAdministrativeActor(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  return (payload as JsonRecord).actor;
}

export function validateAdministrativeFreshnessStatusRequest(
  payload: JsonRecord,
  options: {
    allowCorpusAliases?: boolean;
  } = {}
): FreshnessStatusRequest {
  return {
    asOf: optionalString(payload.asOf, "asOf"),
    expiringWithinDays: optionalInteger(
      payload.expiringWithinDays,
      "expiringWithinDays",
      { min: 1 }
    ),
    corpusId: options.allowCorpusAliases
      ? optionalEnum(
          payload.corpusId,
          "corpusId",
          FRESHNESS_CORPORA,
          FRESHNESS_CORPUS_ALIAS_OPTIONS
        )
      : optionalEnum(payload.corpusId, "corpusId", FRESHNESS_CORPORA),
    limitPerCategory: optionalInteger(
      payload.limitPerCategory,
      "limitPerCategory",
      { min: 1 }
    )
  };
}

export function parseAdministrativeFreshnessQuery(
  searchParams: URLSearchParams
): FreshnessStatusRequest {
  return validateAdministrativeFreshnessStatusRequest({
    asOf: searchParams.get("asOf") ?? undefined,
    expiringWithinDays: parseOptionalPositiveIntegerQuery(
      searchParams,
      "expiringWithinDays"
    ),
    corpusId: searchParams.get("corpusId") ?? undefined,
    limitPerCategory: parseOptionalPositiveIntegerQuery(
      searchParams,
      "limitPerCategory"
    )
  });
}

function coerceActorContextInput(actor: unknown): Partial<ActorContext> {
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
    return {};
  }

  return actor as Partial<ActorContext>;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
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
    throw requestValidationError(
      field,
      "must be an integer greater than or equal to 1"
    );
  }

  return parsed;
}
