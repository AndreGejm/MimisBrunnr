#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import process from "node:process";
import type {
  ActorContext,
  ActorRole,
  AssembleContextPacketRequest,
  CreateRefreshDraftRequest,
  DraftNoteRequest,
  ExecuteCodingTaskRequest,
  GetDecisionSummaryRequest,
  PromoteNoteRequest,
  QueryHistoryRequest,
  RetrieveContextRequest,
  TransportKind,
  ValidateNoteRequest
} from "@multi-agent-brain/contracts";
import {
  ActorAuthorizationError,
  ActorAuthorizationPolicy,
  buildServiceContainer,
  FileIssuedTokenRevocationStore,
  issueActorAccessToken,
  loadEnvironment,
  validateInspectActorTokenControlRequest,
  validateIssueActorTokenControlRequest,
  validateRevokeActorTokenControlRequest,
  TransportValidationError,
  validateTransportRequest
} from "@multi-agent-brain/infrastructure";

type CommandName =
  | "version"
  | "auth-status"
  | "auth-introspect-token"
  | "freshness-status"
  | "issue-auth-token"
  | "revoke-auth-token"
  | "execute-coding-task"
  | "search-context"
  | "get-context-packet"
  | "fetch-decision-summary"
  | "draft-note"
  | "create-refresh-draft"
  | "validate-note"
  | "promote-note"
  | "query-history";
type RoutedCommandName = Exclude<
  CommandName,
  "version" | "auth-status" | "auth-introspect-token" | "freshness-status" | "issue-auth-token"
  | "revoke-auth-token"
>;

type JsonRecord = Record<string, unknown>;

interface ParsedCli {
  command?: CommandName;
  options: {
    help: boolean;
    version: boolean;
    pretty: boolean;
    stdin: boolean;
    inputPath?: string;
    inlineJson?: string;
  };
}

const COMMANDS: ReadonlyArray<CommandName> = [
  "version",
  "auth-status",
  "auth-introspect-token",
  "freshness-status",
  "issue-auth-token",
  "revoke-auth-token",
  "execute-coding-task",
  "search-context",
  "get-context-packet",
  "fetch-decision-summary",
  "draft-note",
  "create-refresh-draft",
  "validate-note",
  "promote-note",
  "query-history"
];

const DEFAULT_ACTOR_ROLE: Record<RoutedCommandName, ActorRole> = {
  "execute-coding-task": "operator",
  "search-context": "retrieval",
  "get-context-packet": "retrieval",
  "fetch-decision-summary": "retrieval",
  "draft-note": "writer",
  "create-refresh-draft": "operator",
  "validate-note": "orchestrator",
  "promote-note": "orchestrator",
  "query-history": "operator"
};
const ACTOR_ROLES: ReadonlyArray<ActorRole> = [
  "retrieval",
  "writer",
  "orchestrator",
  "system",
  "operator"
];
const TRANSPORTS: ReadonlyArray<TransportKind> = [
  "internal",
  "cli",
  "http",
  "mcp",
  "automation"
];
const COMMAND_NAMES: ReadonlyArray<string> = [
  "execute_coding_task",
  "search_context",
  "get_context_packet",
  "fetch_decision_summary",
  "draft_note",
  "create_refresh_draft",
  "validate_note",
  "promote_note",
  "query_history"
];
const CORPORA: ReadonlyArray<"context_brain" | "general_notes"> = [
  "context_brain",
  "general_notes"
];

async function main(): Promise<void> {
  const parsed = parseCli(process.argv.slice(2));

  if (parsed.options.help || !parsed.command) {
    printUsage();
    process.exitCode = parsed.command ? 0 : 1;
    return;
  }

  if (parsed.command === "version") {
    const env = loadEnvironment();
    writeJson(
      {
        ok: true,
        release: env.release
      },
      parsed.options.pretty
    );
    process.exitCode = 0;
    return;
  }

  if (parsed.command === "auth-status") {
    const env = loadEnvironment();
    const policy = new ActorAuthorizationPolicy({
      mode: env.auth.mode,
      allowAnonymousInternal: env.auth.allowAnonymousInternal,
      registry: env.auth.actorRegistry,
      issuerSecret: env.auth.issuerSecret,
      issuedTokenRequireRegistryMatch: env.auth.issuedTokenRequireRegistryMatch,
      revokedIssuedTokenIds: env.auth.revokedIssuedTokenIds
    });
    writeJson(
      {
        ok: true,
        auth: policy.getRegistrySummary()
      },
      parsed.options.pretty
    );
    process.exitCode = 0;
    return;
  }

  if (parsed.command === "auth-introspect-token") {
    const env = loadEnvironment();
    const policy = new ActorAuthorizationPolicy({
      mode: env.auth.mode,
      allowAnonymousInternal: env.auth.allowAnonymousInternal,
      registry: env.auth.actorRegistry,
      issuerSecret: env.auth.issuerSecret,
      issuedTokenRequireRegistryMatch: env.auth.issuedTokenRequireRegistryMatch,
      revokedIssuedTokenIds: env.auth.revokedIssuedTokenIds
    });
    const request = validateInspectActorTokenControlRequest(
      await loadCommandPayload(parsed.options)
    );
    writeJson(
      {
        ok: true,
        inspection: policy.inspectToken(request.token, {
          asOf: request.asOf,
          expectedTransport: request.expectedTransport,
          expectedCommand: request.expectedCommand,
          expectedAdministrativeAction: request.expectedAdministrativeAction
        })
      },
      parsed.options.pretty
    );
    process.exitCode = 0;
    return;
  }

  if (parsed.command === "freshness-status") {
    const container = buildServiceContainer(loadEnvironment());
    try {
      const request = validateFreshnessStatusRequest(
        await loadOptionalCommandPayload(parsed.options)
      );
      writeJson(
        {
          ok: true,
          freshness: await container.ports.metadataControlStore.getTemporalValidityReport(
            request
          )
        },
        parsed.options.pretty
      );
      process.exitCode = 0;
      return;
    } finally {
      container.dispose();
    }
  }

  if (parsed.command === "issue-auth-token") {
    const env = loadEnvironment();
    if (!env.auth.issuerSecret) {
      throw new Error(
        "MAB_AUTH_ISSUER_SECRET must be configured to issue actor access tokens."
      );
    }

    const request = validateIssueActorTokenControlRequest(
      await loadCommandPayload(parsed.options)
    );
    writeJson(
      {
        ok: true,
        issuedToken: issueActorAccessToken(
          {
            actorId: request.actorId,
            actorRole: request.actorRole,
            source: request.source,
            allowedTransports: request.allowedTransports,
            allowedCommands: request.allowedCommands,
            allowedAdminActions: request.allowedAdminActions,
            validFrom: request.validFrom,
            validUntil: request.validUntil,
            issuedAt: new Date().toISOString()
          },
          env.auth.issuerSecret
        ),
        claims: request
      },
      parsed.options.pretty
    );
    process.exitCode = 0;
    return;
  }

  if (parsed.command === "revoke-auth-token") {
    const env = loadEnvironment();
    if (!env.auth.issuedTokenRevocationPath) {
      throw new Error(
        "MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH must be configured to revoke actor access tokens."
      );
    }

    const policy = new ActorAuthorizationPolicy({
      mode: env.auth.mode,
      allowAnonymousInternal: env.auth.allowAnonymousInternal,
      registry: env.auth.actorRegistry,
      issuerSecret: env.auth.issuerSecret,
      issuedTokenRequireRegistryMatch: env.auth.issuedTokenRequireRegistryMatch,
      revokedIssuedTokenIds: env.auth.revokedIssuedTokenIds
    });
    const request = validateRevokeActorTokenControlRequest(
      await loadCommandPayload(parsed.options)
    );
    const revocationStore = await FileIssuedTokenRevocationStore.create(
      env.auth.issuedTokenRevocationPath,
      policy.getRevokedIssuedTokenIds()
    );
    const tokenId = resolveIssuedTokenIdForRevocation(request, policy);
    const revocation = await revocationStore.revokeTokenId(tokenId);
    policy.revokeIssuedTokenId(tokenId);

    writeJson(
      {
        ok: true,
        revokedTokenId: tokenId,
        alreadyRevoked: revocation.alreadyRevoked,
        persisted: revocation.persisted,
        reason: request.reason
      },
      parsed.options.pretty
    );
    process.exitCode = 0;
    return;
  }

  const container = buildServiceContainer(loadEnvironment());
  try {
    const request = await loadCommandPayload(parsed.options);
    const validatedRequest = validateTransportRequest(parsed.command, request);
    const actor = buildActorContext(parsed.command, validatedRequest.actor);
    const normalizedRequest = normalizeCommandRequest(parsed.command, {
      ...validatedRequest,
      actor
    });

    const result = await runCommand(parsed.command, normalizedRequest, container);
    writeJson(result, parsed.options.pretty);

    process.exitCode = shouldFailProcess(result, parsed.command) ? 1 : 0;
  } catch (error) {
    writeJson(
      mapCliError(error),
      parsed.options.pretty
    );
    process.exitCode = 1;
  } finally {
    container.dispose();
  }
}

async function runCommand(
  command: RoutedCommandName,
  request: JsonRecord,
  container: ReturnType<typeof buildServiceContainer>
): Promise<unknown> {
  switch (command) {
    case "search-context":
      return container.orchestrator.searchContext(
        request as unknown as RetrieveContextRequest
      );
    case "get-context-packet":
      return container.orchestrator.getContextPacket(
        request as unknown as AssembleContextPacketRequest
      );
    case "execute-coding-task":
      return container.orchestrator.executeCodingTask(
        request as unknown as ExecuteCodingTaskRequest
      );
    case "fetch-decision-summary":
      return container.orchestrator.fetchDecisionSummary(
        request as unknown as GetDecisionSummaryRequest
      );
    case "draft-note":
      return container.orchestrator.draftNote(
        request as unknown as DraftNoteRequest
      );
    case "create-refresh-draft":
      return container.orchestrator.createRefreshDraft(
        request as unknown as CreateRefreshDraftRequest
      );
    case "validate-note":
      return container.orchestrator.validateNote(
        request as unknown as ValidateNoteRequest
      );
    case "promote-note":
      return container.orchestrator.promoteNote(
        request as unknown as PromoteNoteRequest
      );
    case "query-history":
      return container.orchestrator.queryHistory(
        request as unknown as QueryHistoryRequest
      );
  }
}

function parseCli(argv: string[]): ParsedCli {
  const options: ParsedCli["options"] = {
    help: false,
    version: false,
    pretty: true,
    stdin: false
  };

  let command: CommandName | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--help" || value === "-h") {
      options.help = true;
      continue;
    }

  if (value === "--version") {
      options.version = true;
      command = "version";
      continue;
    }

    if (value === "--no-pretty") {
      options.pretty = false;
      continue;
    }

    if (value === "--pretty") {
      options.pretty = true;
      continue;
    }

    if (value === "--stdin") {
      options.stdin = true;
      continue;
    }

    if (value === "--input") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --input.");
      }
      options.inputPath = next;
      index += 1;
      continue;
    }

    if (value === "--json") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --json.");
      }
      options.inlineJson = next;
      index += 1;
      continue;
    }

    if (!command) {
      if (COMMANDS.includes(value as CommandName)) {
        command = value as CommandName;
        continue;
      }

      throw new Error(`Unknown command '${value}'.`);
    }

    throw new Error(`Unexpected argument '${value}'.`);
  }

  if (options.version) {
    command = "version";
  }

  return { command, options };
}

async function loadCommandPayload(options: ParsedCli["options"]): Promise<JsonRecord> {
  const sources = countCommandPayloadSources(options);
  if (sources.length !== 1) {
    throw new Error("Provide exactly one request source: --stdin, --input <path>, or --json <payload>.");
  }

  if (options.stdin) {
    return parseJson(await readStdin());
  }

  if (options.inputPath) {
    return parseJson(await readFile(options.inputPath, "utf8"));
  }

  return parseJson(options.inlineJson ?? "");
}

async function loadOptionalCommandPayload(
  options: ParsedCli["options"]
): Promise<JsonRecord> {
  const sources = countCommandPayloadSources(options);
  if (sources.length === 0) {
    return {};
  }

  if (sources.length > 1) {
    throw new Error("Provide at most one request source: --stdin, --input <path>, or --json <payload>.");
  }

  return loadCommandPayload(options);
}

function countCommandPayloadSources(options: ParsedCli["options"]): boolean[] {
  return [options.stdin, Boolean(options.inputPath), Boolean(options.inlineJson)].filter(Boolean);
}

function parseJson(value: string): JsonRecord {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Command input must be a JSON object.");
  }
  return parsed as JsonRecord;
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(String(chunk));
  }
  return chunks.join("");
}

function buildActorContext(command: RoutedCommandName, actor: unknown): ActorContext {
  const input = actor && typeof actor === "object" ? actor as Partial<ActorContext> : {};
  const now = new Date().toISOString();

  return {
    actorId: input.actorId ?? `${command}-cli`,
    actorRole: input.actorRole ?? DEFAULT_ACTOR_ROLE[command],
    transport: "cli",
    source: input.source ?? "brain-cli",
    requestId: input.requestId ?? randomUUID(),
    initiatedAt: input.initiatedAt ?? now,
    toolName: input.toolName ?? command,
    authToken: input.authToken
  };
}

function normalizeCommandRequest(command: RoutedCommandName, request: JsonRecord): JsonRecord {
  if (
    command === "execute-coding-task" &&
    typeof request.repoRoot !== "string"
  ) {
    return {
      ...request,
      repoRoot: process.cwd()
    };
  }

  return request;
}

function shouldFailProcess(result: unknown, command: RoutedCommandName): boolean {
  if (!result || typeof result !== "object") {
    return true;
  }

  if ("ok" in result && result.ok === false) {
    return true;
  }

  if (
    command === "execute-coding-task" &&
    "status" in result &&
    typeof result.status === "string" &&
    result.status !== "success"
  ) {
    return true;
  }

  if (
    command === "validate-note" &&
    "valid" in result &&
    typeof result.valid === "boolean" &&
    result.valid === false
  ) {
    return true;
  }

  return false;
}

function writeJson(value: unknown, pretty: boolean): void {
  const rendered = JSON.stringify(value, null, pretty ? 2 : 0);
  process.stdout.write(`${rendered}\n`);
}

function mapCliError(error: unknown): { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } } {
  if (error instanceof ActorAuthorizationError) {
    return {
      ok: false,
      error: error.toServiceError()
    };
  }

  if (error instanceof TransportValidationError) {
    return {
      ok: false,
      error: error.toServiceError()
    };
  }

  return {
    ok: false,
    error: {
      code: "cli_failed",
      message: error instanceof Error ? error.message : String(error)
    }
  };
}

function printUsage(): void {
  const usage = `
brain-cli <command> [--input <file> | --stdin | --json <payload>] [--pretty | --no-pretty]

Commands:
  version              Print the runtime release metadata used for this build
  auth-status          Print the effective actor-registry and issued-token summary
  auth-introspect-token  Inspect a static or issued actor token against the current auth policy
  freshness-status     Print temporal-validity summary data and refresh candidates
  issue-auth-token     Mint a short-lived issued actor token from JSON input
  revoke-auth-token    Revoke a previously issued actor token through the local revocation store
  execute-coding-task  Run a coding-domain task through the vendored safety-gated runtime
  search-context   Run bounded retrieval through retrieveContextService
  get-context-packet  Assemble a bounded packet directly from ranked candidates
  fetch-decision-summary  Retrieve a bounded decision-focused packet
  draft-note       Create a staging draft through stagingDraftService
  create-refresh-draft  Create a governed refresh draft for an existing current-state note
  validate-note    Run deterministic schema validation
  promote-note     Promote a staging draft through the orchestrator
  query-history    Query bounded audit history

Notes:
  - version, --version, and auth-status do not require an input payload.
  - auth-introspect-token expects JSON input with token and optional asOf, expectedTransport, expectedCommand, or expectedAdministrativeAction.
  - freshness-status accepts optional JSON input with asOf, expiringWithinDays, corpusId, and limitPerCategory.
  - create-refresh-draft expects JSON input with noteId and optional asOf, expiringWithinDays, or bodyHints.
  - issue-auth-token expects JSON input with actorId, actorRole, and optional source, allowedTransports, allowedCommands, allowedAdminActions, validFrom, validUntil, or ttlMinutes.
  - revoke-auth-token expects JSON input with tokenId or a valid issued token, and optional reason.
  - Input payloads are JSON objects shaped like the existing service contracts.
  - Actor context is optional in the payload; the CLI injects command-safe defaults.
  - execute-coding-task defaults repoRoot to the current working directory when omitted.
  - Output is always JSON so later HTTP and MCP adapters can mirror the same response shape.
`.trim();

  process.stdout.write(`${usage}\n`);
}

await main();

function requireCliString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid issued-token field '${field}': must be a non-empty string.`);
  }

  return value.trim();
}

function optionalCliString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireCliString(value, field);
}

function requireCliActorRole(value: unknown, field: string): ActorRole {
  const normalized = requireCliString(value, field);
  if (!ACTOR_ROLES.includes(normalized as ActorRole)) {
    throw new Error(
      `Invalid issued-token field '${field}': must be one of ${ACTOR_ROLES.join(", ")}.`
    );
  }

  return normalized as ActorRole;
}

function optionalCliEnumArray<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlyArray<T>
): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid issued-token field '${field}': must be an array.`);
  }

  return value.map((item, index) => {
    const normalized = requireCliString(item, `${field}[${index}]`);
    if (!allowedValues.includes(normalized as T)) {
      throw new Error(
        `Invalid issued-token field '${field}[${index}]': must be one of ${allowedValues.join(", ")}.`
      );
    }

    return normalized as T;
  });
}

function optionalCliInteger(
  value: unknown,
  field: string,
  min: number
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new Error(
      `Invalid issued-token field '${field}': must be an integer greater than or equal to ${min}.`
    );
  }

  return value;
}

function validateFreshnessStatusRequest(payload: JsonRecord): {
  asOf?: string;
  expiringWithinDays?: number;
  corpusId?: "context_brain" | "general_notes";
  limitPerCategory?: number;
} {
  const corpusId =
    payload.corpusId === undefined
      ? undefined
      : requireCliCorpus(payload.corpusId, "corpusId");

  return {
    asOf: optionalCliString(payload.asOf, "asOf"),
    expiringWithinDays: optionalCliInteger(
      payload.expiringWithinDays,
      "expiringWithinDays",
      1
    ),
    corpusId,
    limitPerCategory: optionalCliInteger(
      payload.limitPerCategory,
      "limitPerCategory",
      1
    )
  };
}

function requireCliCorpus(
  value: unknown,
  field: string
): "context_brain" | "general_notes" {
  const normalized = requireCliString(value, field);
  if (!CORPORA.includes(normalized as "context_brain" | "general_notes")) {
    throw new Error(
      `Invalid freshness-status field '${field}': must be one of ${CORPORA.join(", ")}.`
    );
  }

  return normalized as "context_brain" | "general_notes";
}

function resolveIssuedTokenIdForRevocation(
  request: ReturnType<typeof validateRevokeActorTokenControlRequest>,
  authPolicy: ActorAuthorizationPolicy
): string {
  if (request.tokenId) {
    return request.tokenId;
  }

  const inspection = authPolicy.inspectToken(request.token ?? "");
  if (inspection.tokenKind !== "issued" || !inspection.claims?.tokenId) {
    throw new Error("revoke-auth-token requires a valid issued actor token or tokenId.");
  }

  return inspection.claims.tokenId;
}
