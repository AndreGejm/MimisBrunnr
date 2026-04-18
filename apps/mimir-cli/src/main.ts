#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import process from "node:process";
import {
  CLI_RUNTIME_COMMAND_NAMES,
  RUNTIME_COMMAND_DEFINITIONS,
  type RuntimeCliCommandName
} from "@mimir/contracts";
import type {
  ActorContext,
  ActorRole,
  TransportKind
} from "@mimir/contracts";
import type { AdministrativeAction } from "@mimir/orchestration";
import {
  ActorAuthorizationError,
  ActorAuthorizationPolicy,
  buildMimirControlSurface,
  buildServiceContainer,
  compileDockerMcpRuntimePlan,
  compileToolboxPolicyFromDirectory,
  dispatchRuntimeCommand,
  FileIssuedTokenRevocationStore,
  issueActorAccessToken,
  loadEnvironment,
  recordIssuedAuthTokenAudit,
  recordRevokedAuthTokenAudit,
  SqliteToolboxSessionLeaseStore,
  validateListIssuedActorTokensControlRequest,
  validateInspectActorTokenControlRequest,
  validateIssueActorTokenControlRequest,
  validateRevokeActorTokenControlRequest,
  TransportValidationError,
  validateTransportRequest
} from "@mimir/infrastructure";

type SystemCommandName =
  | "version"
  | "auth-status"
  | "auth-issued-tokens"
  | "auth-introspect-token"
  | "check-mcp-profiles"
  | "deactivate-toolbox"
  | "describe-toolbox"
  | "freshness-status"
  | "issue-auth-token"
  | "list-active-toolbox"
  | "list-active-tools"
  | "list-toolboxes"
  | "request-toolbox-activation"
  | "revoke-auth-token"
  | "sync-mcp-profiles";

type CommandName = SystemCommandName | RuntimeCliCommandName;
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

const SYSTEM_COMMANDS: ReadonlyArray<SystemCommandName> = [
  "version",
  "auth-status",
  "auth-issued-tokens",
  "auth-introspect-token",
  "check-mcp-profiles",
  "deactivate-toolbox",
  "describe-toolbox",
  "freshness-status",
  "issue-auth-token",
  "list-active-toolbox",
  "list-active-tools",
  "list-toolboxes",
  "request-toolbox-activation",
  "revoke-auth-token",
  "sync-mcp-profiles"
];
const COMMANDS: ReadonlyArray<CommandName> = [
  ...SYSTEM_COMMANDS,
  ...CLI_RUNTIME_COMMAND_NAMES
];

const DEFAULT_ACTOR_ROLE: Record<RuntimeCliCommandName, ActorRole> = {
  ...(Object.fromEntries(
    RUNTIME_COMMAND_DEFINITIONS.map((command) => [
      command.cliName,
      command.defaultActorRole
    ])
  ) as Record<RuntimeCliCommandName, ActorRole>),
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
type CliCorpusId = "mimisbrunnr" | "general_notes";

const CORPORA: ReadonlyArray<CliCorpusId> = [
  "mimisbrunnr",
  "general_notes"
];
const CLI_CORPUS_ALIASES: ReadonlyMap<string, CliCorpusId> = new Map([
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

  if (parsed.command === "check-mcp-profiles") {
    try {
      const env = loadEnvironment();
      const payload = await loadOptionalCommandPayload(parsed.options);
      const manifestDirectory = resolveCliToolboxManifestDirectory(
        payload,
        env.toolboxManifestDir
      );
      const policy = compileToolboxPolicyFromDirectory(manifestDirectory);
      writeJson(
        {
          ok: true,
          manifestDirectory,
          manifestRevision: policy.manifestRevision,
          profiles: Object.keys(policy.profiles).sort(),
          servers: Object.keys(policy.servers).sort(),
          intents: Object.keys(policy.intents).sort(),
          clients: Object.keys(policy.clients).sort()
        },
        parsed.options.pretty
      );
      process.exitCode = 0;
      return;
    } catch (error) {
      writeJson(mapCliError(error), parsed.options.pretty);
      process.exitCode = 1;
      return;
    }
  }

  if (parsed.command === "sync-mcp-profiles") {
    try {
      const env = loadEnvironment();
      const payload = await loadOptionalCommandPayload(parsed.options);
      const manifestDirectory = resolveCliToolboxManifestDirectory(
        payload,
        env.toolboxManifestDir
      );
      const policy = compileToolboxPolicyFromDirectory(manifestDirectory);
      const generatedAt =
        optionalCliString(payload.generatedAt, "generatedAt")
        ?? new Date().toISOString();
      const plan = compileDockerMcpRuntimePlan(policy, { generatedAt });
      writeJson(
        {
          ok: true,
          dryRun: true,
          manifestDirectory,
          plan
        },
        parsed.options.pretty
      );
      process.exitCode = 0;
      return;
    } catch (error) {
      writeJson(mapCliError(error), parsed.options.pretty);
      process.exitCode = 1;
      return;
    }
  }

  if (
    parsed.command === "list-toolboxes" ||
    parsed.command === "describe-toolbox" ||
    parsed.command === "request-toolbox-activation" ||
    parsed.command === "list-active-toolbox" ||
    parsed.command === "list-active-tools" ||
    parsed.command === "deactivate-toolbox"
  ) {
    const env = loadEnvironment();
    const payload =
      parsed.command === "describe-toolbox" ||
      parsed.command === "request-toolbox-activation" ||
      parsed.command === "deactivate-toolbox"
        ? await loadCommandPayload(parsed.options)
        : await loadOptionalCommandPayload(parsed.options);
    const { controlSurface, dispose, manifestDirectory, activeProfileId, clientId } =
      buildCliToolboxControlSurface(payload, env);
    try {
      if (parsed.command === "list-toolboxes") {
        writeJson(
          {
            ok: true,
            manifestDirectory,
            ...(await controlSurface.listToolboxes())
          },
          parsed.options.pretty
        );
        process.exitCode = 0;
        return;
      }

      if (parsed.command === "describe-toolbox") {
        writeJson(
          {
            ok: true,
            manifestDirectory,
            clientId,
            ...(await controlSurface.describeToolbox(
              requireCliString(payload.toolboxId, "toolboxId")
            ))
          },
          parsed.options.pretty
        );
        process.exitCode = 0;
        return;
      }

      if (parsed.command === "request-toolbox-activation") {
        writeJson(
          {
            ok: true,
            manifestDirectory,
            activeProfileId,
            activation: await controlSurface.requestToolboxActivation({
              requestedToolbox: optionalCliString(
                payload.requestedToolbox,
                "requestedToolbox"
              ),
              requiredCategories: optionalCliStringArray(
                payload.requiredCategories,
                "requiredCategories"
              ),
              taskSummary: optionalCliString(payload.taskSummary, "taskSummary"),
              clientId: optionalCliString(payload.clientId, "clientId")
            })
          },
          parsed.options.pretty
        );
        process.exitCode = 0;
        return;
      }

      if (parsed.command === "list-active-toolbox") {
        writeJson(
          {
            ok: true,
            manifestDirectory,
            activeProfileId,
            clientId,
            ...(await controlSurface.listActiveToolbox())
          },
          parsed.options.pretty
        );
        process.exitCode = 0;
        return;
      }

      if (parsed.command === "list-active-tools") {
        writeJson(
          {
            ok: true,
            manifestDirectory,
            activeProfileId,
            ...(await controlSurface.listActiveTools())
          },
          parsed.options.pretty
        );
        process.exitCode = 0;
        return;
      }

      writeJson(
        {
          ok: true,
          manifestDirectory,
          activeProfileId,
          ...(await controlSurface.deactivateToolbox(
            optionalCliString(payload.leaseToken, "leaseToken")
          ))
        },
        parsed.options.pretty
      );
      process.exitCode = 0;
      return;
    } catch (error) {
      writeJson(mapCliError(error), parsed.options.pretty);
      process.exitCode = 1;
      return;
    } finally {
      dispose();
    }
  }

  if (parsed.command === "auth-status") {
    const container = buildServiceContainer(loadEnvironment());
    try {
      const payload = await loadOptionalCommandPayload(parsed.options);
      container.authPolicy.authorizeAdministrativeAction(
        "view_auth_status",
        buildAdministrativeActorContext(
          "view_auth_status",
          extractAdministrativeActor(payload)
        )
      );
      writeJson(
        {
          ok: true,
          auth: container.authPolicy.getRegistrySummary(),
          issuedTokens: container.ports.issuedTokenStore.getIssuedTokenSummary()
        },
        parsed.options.pretty
      );
      process.exitCode = 0;
      return;
    } catch (error) {
      writeJson(mapCliError(error), parsed.options.pretty);
      process.exitCode = 1;
      return;
    } finally {
      container.dispose();
    }
  }

  if (parsed.command === "auth-issued-tokens") {
    const container = buildServiceContainer(loadEnvironment());
    try {
      const payload = await loadOptionalCommandPayload(parsed.options);
      container.authPolicy.authorizeAdministrativeAction(
        "view_issued_tokens",
        buildAdministrativeActorContext(
          "view_issued_tokens",
          extractAdministrativeActor(payload)
        )
      );
      const request = validateListIssuedActorTokensControlRequest(
        payload
      );
      writeJson(
        {
          ok: true,
          issuedTokens: container.ports.issuedTokenStore.listIssuedTokens(request),
          summary: container.ports.issuedTokenStore.getIssuedTokenSummary(request)
        },
        parsed.options.pretty
      );
      process.exitCode = 0;
      return;
    } catch (error) {
      writeJson(mapCliError(error), parsed.options.pretty);
      process.exitCode = 1;
      return;
    } finally {
      container.dispose();
    }
  }

  if (parsed.command === "auth-introspect-token") {
    const container = buildServiceContainer(loadEnvironment());
    try {
      const payload = await loadCommandPayload(parsed.options);
      container.authPolicy.authorizeAdministrativeAction(
        "inspect_auth_token",
        buildAdministrativeActorContext(
          "inspect_auth_token",
          extractAdministrativeActor(payload)
        )
      );
      const request = validateInspectActorTokenControlRequest(payload);
      writeJson(
        {
          ok: true,
          inspection: container.authPolicy.inspectToken(request.token, {
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
    } catch (error) {
      writeJson(mapCliError(error), parsed.options.pretty);
      process.exitCode = 1;
      return;
    } finally {
      container.dispose();
    }
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
    } catch (error) {
      writeJson(mapCliError(error), parsed.options.pretty);
      process.exitCode = 1;
      return;
    } finally {
      container.dispose();
    }
  }

  if (parsed.command === "issue-auth-token") {
    const container = buildServiceContainer(loadEnvironment());
    try {
      if (!container.env.auth.issuerSecret) {
        throw new Error(
          "MAB_AUTH_ISSUER_SECRET must be configured to issue actor access tokens."
        );
      }

      const payload = await loadCommandPayload(parsed.options);
      const administrativeActor = buildAdministrativeActorContext(
        "issue_auth_token",
        extractAdministrativeActor(payload)
      );
      container.authPolicy.authorizeAdministrativeAction(
        "issue_auth_token",
        administrativeActor
      );
      const request = validateIssueActorTokenControlRequest(
        payload
      );
      const issuedAt = new Date().toISOString();
      const validUntil =
        request.validUntil ??
        (request.ttlMinutes !== undefined
          ? new Date(Date.now() + request.ttlMinutes * 60_000).toISOString()
          : undefined);
      const issuedToken = issueActorAccessToken(
        {
          actorId: request.actorId,
          actorRole: request.actorRole,
          source: request.source,
          allowedTransports: request.allowedTransports,
          allowedCommands: request.allowedCommands,
          allowedAdminActions: request.allowedAdminActions,
          allowedCorpora: request.allowedCorpora,
          validFrom: request.validFrom,
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
            targetActorId: request.actorId,
            targetActorRole: request.actorRole,
            targetSource: request.source,
            command: "issue-auth-token",
            validFrom: request.validFrom,
            validUntil,
            hasAllowedCommands: (request.allowedCommands?.length ?? 0) > 0,
            hasAllowedAdminActions: (request.allowedAdminActions?.length ?? 0) > 0,
            hasAllowedCorpora: (request.allowedCorpora?.length ?? 0) > 0
          })).warnings
        );
      }

      writeJson(
        {
          ok: true,
          issuedToken,
          claims: {
            ...request,
            issuedAt,
            validUntil
          },
          ...(warnings.length > 0 ? { warnings } : {})
        },
        parsed.options.pretty
      );
      process.exitCode = 0;
      return;
    } catch (error) {
      writeJson(mapCliError(error), parsed.options.pretty);
      process.exitCode = 1;
      return;
    } finally {
      container.dispose();
    }
  }

  if (parsed.command === "revoke-auth-token") {
    const container = buildServiceContainer(loadEnvironment());
    try {
      if (!container.env.auth.issuedTokenRevocationPath) {
        throw new Error(
          "MAB_AUTH_REVOKED_ISSUED_TOKEN_IDS_PATH must be configured to revoke actor access tokens."
        );
      }

      const payload = await loadCommandPayload(parsed.options);
      const administrativeActor = buildAdministrativeActorContext(
        "revoke_auth_token",
        extractAdministrativeActor(payload)
      );
      container.authPolicy.authorizeAdministrativeAction(
        "revoke_auth_token",
        administrativeActor
      );
      const request = validateRevokeActorTokenControlRequest(
        payload
      );
      const revocationStore = await FileIssuedTokenRevocationStore.create(
        container.env.auth.issuedTokenRevocationPath,
        container.authPolicy.getRevokedIssuedTokenIds()
      );
      const tokenId = resolveIssuedTokenIdForRevocation(request, container.authPolicy);
      const revocation = await revocationStore.revokeTokenId(tokenId);
      container.authPolicy.revokeIssuedTokenId(tokenId);
      const ledgerRevocation = container.ports.issuedTokenStore.markTokenRevoked(
        tokenId,
        {
          reason: request.reason,
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
          command: "revoke-auth-token",
          reason: request.reason,
          alreadyRevoked: revocation.alreadyRevoked,
          persisted: revocation.persisted,
          recordedTokenFound: ledgerRevocation.found
        })
      ).warnings;

      writeJson(
        {
          ok: true,
          revokedTokenId: tokenId,
          alreadyRevoked: revocation.alreadyRevoked,
          persisted: revocation.persisted,
          recordedTokenFound: ledgerRevocation.found,
          reason: request.reason,
          ...(warnings.length > 0 ? { warnings } : {})
        },
        parsed.options.pretty
      );
      process.exitCode = 0;
      return;
    } catch (error) {
      writeJson(mapCliError(error), parsed.options.pretty);
      process.exitCode = 1;
      return;
    } finally {
      container.dispose();
    }
  }

  const container = buildServiceContainer(loadEnvironment());
  try {
    const runtimeCommand = parsed.command as RuntimeCliCommandName;
    const request = runtimeCommand === "list-review-queue"
      ? await loadOptionalCommandPayload(parsed.options)
      : await loadCommandPayload(parsed.options);
    const validatedRequest = validateTransportRequest(runtimeCommand, request);
    const actor = buildActorContext(runtimeCommand, validatedRequest.actor);
    const normalizedRequest = normalizeCommandRequest(runtimeCommand, {
      ...validatedRequest,
      actor
    });

    const result = await dispatchRuntimeCommand(runtimeCommand, normalizedRequest, container);
    writeJson(result, parsed.options.pretty);

    process.exitCode = shouldFailProcess(result, runtimeCommand) ? 1 : 0;
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

    if (value === "--") {
      continue;
    }

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

function buildCliToolboxControlSurface(
  payload: JsonRecord,
  env: ReturnType<typeof loadEnvironment>
) {
  const container = buildServiceContainer(env);
  const manifestDirectory = resolveCliToolboxManifestDirectory(
    payload,
    env.toolboxManifestDir
  );
  const activeProfileId =
    optionalCliString(payload.activeProfileId, "activeProfileId")
    ?? env.toolboxActiveProfile
    ?? "bootstrap";
  const clientId =
    optionalCliString(payload.clientId, "clientId")
    ?? env.toolboxClientId
    ?? "codex";
  const leaseStore = env.toolboxLeaseIssuerSecret
    ? new SqliteToolboxSessionLeaseStore(env.sqlitePath)
    : undefined;

  return {
    manifestDirectory,
    activeProfileId,
    clientId,
    controlSurface: buildMimirControlSurface({
      manifestDirectory,
      activeProfileId,
      clientId,
      auditHistoryService: container.services.auditHistoryService,
      leaseIssuer: env.toolboxLeaseIssuer,
      leaseAudience: env.toolboxLeaseAudience,
      leaseIssuerSecret: env.toolboxLeaseIssuerSecret,
      leaseStore
    }),
    dispose: () => {
      leaseStore?.close();
      container.dispose();
    }
  };
}

function resolveCliToolboxManifestDirectory(
  payload: JsonRecord,
  defaultDirectory: string
): string {
  return (
    optionalCliString(payload.manifestDirectory, "manifestDirectory")
    ?? defaultDirectory
  );
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

function buildActorContext(command: RuntimeCliCommandName, actor: unknown): ActorContext {
  const input = actor && typeof actor === "object" ? actor as Partial<ActorContext> : {};
  const now = new Date().toISOString();
  const activeProfile = process.env.MAB_TOOLBOX_ACTIVE_PROFILE?.trim() || undefined;
  const sessionPolicyToken =
    input.sessionPolicyToken ??
    process.env.MAB_TOOLBOX_SESSION_POLICY_TOKEN?.trim() ??
    undefined;

  return {
    actorId: input.actorId ?? `${command}-cli`,
    actorRole: input.actorRole ?? DEFAULT_ACTOR_ROLE[command],
    transport: "cli",
    source: input.source ?? "mimir-cli",
    requestId: input.requestId ?? randomUUID(),
    initiatedAt: input.initiatedAt ?? now,
    toolName: input.toolName ?? command,
    authToken: input.authToken,
    sessionPolicyToken,
    toolboxSessionMode:
      input.toolboxSessionMode ??
      (process.env.MAB_TOOLBOX_SESSION_MODE?.trim() as ActorContext["toolboxSessionMode"] | undefined) ??
      (activeProfile
        ? (activeProfile === "bootstrap" ? "toolbox-bootstrap" : "toolbox-activated")
        : undefined),
    toolboxClientId:
      input.toolboxClientId ??
      process.env.MAB_TOOLBOX_CLIENT_ID?.trim() ??
      undefined,
    toolboxProfileId:
      input.toolboxProfileId ??
      activeProfile
  };
}

function buildAdministrativeActorContext(
  administrativeAction: AdministrativeAction,
  actor: unknown
): ActorContext {
  const input = actor && typeof actor === "object" ? actor as Partial<ActorContext> : {};
  const now = new Date().toISOString();
  const activeProfile = process.env.MAB_TOOLBOX_ACTIVE_PROFILE?.trim() || undefined;
  const sessionPolicyToken =
    input.sessionPolicyToken ??
    process.env.MAB_TOOLBOX_SESSION_POLICY_TOKEN?.trim() ??
    undefined;

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
      (process.env.MAB_TOOLBOX_SESSION_MODE?.trim() as ActorContext["toolboxSessionMode"] | undefined) ??
      (activeProfile
        ? (activeProfile === "bootstrap" ? "toolbox-bootstrap" : "toolbox-activated")
        : undefined),
    toolboxClientId:
      input.toolboxClientId ??
      process.env.MAB_TOOLBOX_CLIENT_ID?.trim() ??
      undefined,
    toolboxProfileId:
      input.toolboxProfileId ??
      activeProfile
  };
}

function extractAdministrativeActor(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  return (payload as JsonRecord).actor;
}

function normalizeCommandRequest(command: RuntimeCliCommandName, request: JsonRecord): JsonRecord {
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

function shouldFailProcess(result: unknown, command: RuntimeCliCommandName): boolean {
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
mimir CLI
mimir-cli <command> [--input <file> | --stdin | --json <payload>] [--pretty | --no-pretty]

The root workspace pnpm cli script invokes this same CLI.

Commands:
  version              Print the runtime release metadata used for this build
  auth-status          Print the effective actor-registry and issued-token summary
  auth-issued-tokens   List recorded issued actor tokens and their lifecycle state
  auth-introspect-token  Inspect a static or issued actor token against the current auth policy
  check-mcp-profiles   Validate repo-managed Docker MCP toolbox manifests and emit the compiled contract summary
  sync-mcp-profiles    Compile a deterministic Docker MCP runtime plan from the checked-in toolbox manifests
  list-toolboxes       List intent-level toolboxes before peer MCP tools are exposed
  describe-toolbox     Describe one toolbox, its categories, and anti-use-cases
  request-toolbox-activation  Approve a profile-bound toolbox handoff and issue a lease when configured
  list-active-toolbox  Report the current active toolbox profile and overlay
  list-active-tools    Report the current profile's active tool descriptors after overlay suppression
  deactivate-toolbox   Revoke an issued toolbox lease and return the downgrade target
  freshness-status     Print temporal-validity summary data and refresh candidates
  issue-auth-token     Mint a short-lived issued actor token from JSON input
  revoke-auth-token    Revoke a previously issued actor token through the local revocation store
  execute-coding-task  Run a coding-domain task through the vendored safety-gated runtime
  list-agent-traces  List compact operational traces for one local-agent request
  show-tool-output  Read a full spilled local-agent tool output by output id
  list-ai-tools    List read-only Docker AI tool manifests from the registry
  check-ai-tools   Validate Docker AI tool manifests and return per-file check results
  tools-package-plan  Build a reusable Docker package plan for registered AI tools
  search-context   Run bounded retrieval through retrieveContextService
  search-session-archives  Search immutable non-authoritative session archives
  assemble-agent-context  Assemble a fenced local-agent context packet
  list-context-tree  List namespace nodes through the shared context namespace service
  read-context-node  Read a namespace node through the shared context namespace service
  get-context-packet  Assemble a bounded packet directly from ranked candidates
  fetch-decision-summary  Retrieve a bounded decision-focused packet
  draft-note       Create a staging draft through stagingDraftService
  list-review-queue  List active staging notes for thin review frontends
  read-review-note  Read one staging note for thin review frontends
  accept-note      Promote one staging note through the current mimir promotion service
  reject-note      Mark one staging note as rejected
  create-refresh-draft  Create a governed refresh draft for an existing current-state note
  create-refresh-drafts  Create a bounded batch of governed refresh drafts from freshness candidates
  validate-note    Run deterministic schema validation
  promote-note     Promote a staging draft through the orchestrator
  import-resource  Record a controlled import job without writing canonical memory
  query-history    Query bounded audit history
  create-session-archive  Persist an immutable non-authoritative session transcript archive

Notes:
  - version and --version do not require an input payload.
  - auth-status has no required payload, but enforced auth mode requires operator or system actor context when you call the command.
  - auth-issued-tokens accepts optional JSON input with actor, actorId, asOf, includeRevoked, issuedByActorId, revokedByActorId, lifecycleStatus, and limit.
  - auth-introspect-token expects JSON input with token and optional asOf, expectedTransport, expectedCommand, or expectedAdministrativeAction.
  - check-mcp-profiles accepts optional JSON input with manifestDirectory.
  - sync-mcp-profiles accepts optional JSON input with manifestDirectory and generatedAt.
  - list-toolboxes accepts optional JSON input with manifestDirectory, activeProfileId, and clientId.
  - describe-toolbox expects JSON input with toolboxId and optional manifestDirectory, activeProfileId, and clientId.
  - request-toolbox-activation expects JSON input with requestedToolbox or requiredCategories, plus optional taskSummary, clientId, manifestDirectory, and activeProfileId.
  - list-active-toolbox and list-active-tools accept optional JSON input with manifestDirectory, activeProfileId, and clientId.
  - deactivate-toolbox accepts JSON input with optional leaseToken and optional manifestDirectory, activeProfileId, and clientId.
  - freshness-status accepts optional JSON input with asOf, expiringWithinDays, corpusId, and limitPerCategory.
  - create-refresh-draft expects JSON input with noteId and optional asOf, expiringWithinDays, or bodyHints.
  - create-refresh-drafts accepts optional JSON input with asOf, expiringWithinDays, corpusId, limitPerCategory, maxDrafts, sourceStates, and bodyHints.
  - list-review-queue accepts optional JSON input with targetCorpus and includeRejected.
  - read-review-note expects JSON input with draftNoteId.
  - accept-note expects JSON input with draftNoteId.
  - reject-note expects JSON input with draftNoteId and optional reviewNotes.
  - create-session-archive expects JSON input with sessionId and a non-empty messages array of { role, content } objects.
  - search-session-archives expects query and optional sessionId, limit, and maxTokens.
  - assemble-agent-context expects query, corpusIds, budget, and optional session recall controls.
  - list-agent-traces expects requestId.
  - show-tool-output expects outputId.
  - list-ai-tools accepts optional JSON input with ids (string array), includeEnvironment (boolean), and includeRuntime (boolean).
  - check-ai-tools accepts optional JSON input with ids (string array) to filter by tool id.
  - tools-package-plan accepts optional JSON input with ids (string array) and returns Docker compose run plans without executing tools.
  - issue-auth-token expects JSON input with actorId, actorRole, and optional source, allowedTransports, allowedCommands, allowedAdminActions, validFrom, validUntil, or ttlMinutes.
  - revoke-auth-token expects JSON input with tokenId or a valid issued token, and optional reason.
  - Input payloads are JSON objects shaped like the existing service contracts.
  - Runtime command actor context is optional in the payload; the CLI injects command-safe defaults for those commands.
  - In enforced auth mode, auth-status, auth-issued-tokens, auth-introspect-token, issue-auth-token, and revoke-auth-token require operator or system actor context in the JSON payload.
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

function optionalCliStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid field '${field}': must be an array of non-empty strings.`);
  }

  return value.map((item, index) => requireCliString(item, `${field}[${index}]`));
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
  corpusId?: "mimisbrunnr" | "general_notes";
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

function requireCliCorpus(value: unknown, field: string): CliCorpusId {
  const normalized = normalizeCliCorpus(requireCliString(value, field));
  if (!CORPORA.includes(normalized as CliCorpusId)) {
    throw new Error(
      `Invalid freshness-status field '${field}': must be one of ${CORPORA.join(", ")}.`
    );
  }

  return normalized as CliCorpusId;
}

function normalizeCliCorpus(value: string): string {
  return CLI_CORPUS_ALIASES.get(value.trim().toLowerCase()) ?? value;
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
