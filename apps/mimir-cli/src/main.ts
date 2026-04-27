#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import { type RuntimeCliCommandName } from "@mimir/contracts";
import type {
  ActorContext,
  ActorRole,
  ToolboxMutationLevel,
  TransportKind
} from "@mimir/contracts";
import {
  ActorAuthorizationError,
  buildMimirControlSurface,
  buildCliAdministrativeActorContext,
  buildServiceContainer,
  applyDockerMcpRuntimePlan,
  buildDockerMcpRuntimeApplyPlan,
  compileDockerMcpRuntimePlan,
  compileToolboxPolicyFromDirectory,
  dispatchRuntimeCommand,
  extractAdministrativeActor,
  getAdministrativeAuthStatus,
  getAdministrativeFreshnessStatus,
  inspectAdministrativeAuthToken,
  issueAdministrativeAuthToken,
  loadEnvironment,
  probeDockerMcpGatewayProfileSupport,
  probeDockerMcpProfileSupport,
  previewScaffoldToolbox,
  listToolboxServers,
  scaffoldToolbox,
  scaffoldToolboxBand,
  SqliteToolboxSessionLeaseStore,
  listAdministrativeAuthIssuers,
  listAdministrativeIssuedTokens,
  revokeAdministrativeAuthToken,
  revokeAdministrativeAuthTokens,
  setAdministrativeAuthIssuerState,
  validateAdministrativeFreshnessStatusRequest,
  validateListIssuedActorTokensControlRequest,
  validateInspectActorTokenControlRequest,
  validateIssueActorTokenControlRequest,
  validateRevokeActorTokenControlRequest,
  validateRevokeIssuedActorTokensControlRequest,
  validateSetAuthIssuerStateControlRequest,
  TransportValidationError,
  validateTransportRequest,
  writeCodexClientMaterializationPlan
} from "@mimir/infrastructure";
import {
  CLI_COMMAND_NAMES,
  CLI_DEFAULT_RUNTIME_ACTOR_ROLE,
  SYSTEM_COMMAND_NAMES,
  type CliCommandName
} from "./command-surface.js";
type JsonRecord = Record<string, unknown>;

interface ParsedCli {
  command?: CliCommandName;
  options: {
    help: boolean;
    version: boolean;
    pretty: boolean;
    stdin: boolean;
    apply: boolean;
    wizard: boolean;
    inputPath?: string;
    inlineJson?: string;
  };
}

const SYSTEM_COMMANDS = SYSTEM_COMMAND_NAMES;
const COMMANDS = CLI_COMMAND_NAMES;

const DEFAULT_ACTOR_ROLE: Record<RuntimeCliCommandName, ActorRole> = {
  ...CLI_DEFAULT_RUNTIME_ACTOR_ROLE
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
          clients: Object.keys(policy.clients).sort(),
          dockerMcp: {
            profileSupport: probeDockerMcpProfileSupport(
              process.env.MIMIR_DOCKER_EXECUTABLE?.trim() || "docker",
              parseJsonStringArrayEnv(
                process.env.MIMIR_DOCKER_EXECUTABLE_ARGS_JSON,
                "MIMIR_DOCKER_EXECUTABLE_ARGS_JSON"
              )
            ),
            gatewayProfileSupport: probeDockerMcpGatewayProfileSupport(
              process.env.MIMIR_DOCKER_EXECUTABLE?.trim() || "docker",
              parseJsonStringArrayEnv(
                process.env.MIMIR_DOCKER_EXECUTABLE_ARGS_JSON,
                "MIMIR_DOCKER_EXECUTABLE_ARGS_JSON"
              )
            )
          }
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

  if (parsed.command === "list-toolbox-servers") {
    try {
      const env = loadEnvironment();
      const payload = await loadOptionalCommandPayload(parsed.options);
      const manifestDirectory = resolveCliToolboxManifestDirectory(
        payload,
        env.toolboxManifestDir
      );
      writeJson(
        {
          ok: true,
          ...listToolboxServers(manifestDirectory)
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

  if (parsed.command === "scaffold-toolbox" || parsed.command === "scaffold-toolbox-band") {
    try {
      const env = loadEnvironment();
      const payload =
        parsed.command === "scaffold-toolbox" && parsed.options.wizard
          ? await runScaffoldToolboxWizard(env.toolboxManifestDir)
          : await loadCommandPayload(parsed.options);
      const manifestDirectory = resolveCliToolboxManifestDirectory(
        payload,
        env.toolboxManifestDir
      );
      const result =
        parsed.command === "scaffold-toolbox-band"
          ? await scaffoldToolboxBand({
              manifestDirectory,
              bandId: requireCliString(payload.bandId, "bandId"),
              displayName: requireCliString(payload.displayName, "displayName"),
              serverIds: requireCliStringArray(payload.serverIds, "serverIds"),
              summary: optionalCliString(payload.summary, "summary"),
              exampleTasks: optionalCliStringArray(payload.exampleTasks, "exampleTasks"),
              trustClass: optionalCliString(payload.trustClass, "trustClass"),
              mutationLevel: optionalCliMutationLevel(payload.mutationLevel, "mutationLevel"),
              autoExpand: optionalCliBoolean(payload.autoExpand, "autoExpand"),
              requiresApproval: optionalCliBoolean(payload.requiresApproval, "requiresApproval"),
              preferredActorRoles: optionalCliActorRoleArray(payload.preferredActorRoles, "preferredActorRoles"),
              allowedCategories: optionalCliStringArray(payload.allowedCategories, "allowedCategories"),
              deniedCategories: optionalCliStringArray(payload.deniedCategories, "deniedCategories"),
              fallbackProfile: optionalCliString(payload.fallbackProfile, "fallbackProfile"),
              sessionMode: optionalCliSessionMode(payload.sessionMode, "sessionMode"),
              taskAware: optionalCliBoolean(payload.taskAware, "taskAware"),
              idleTimeoutSeconds: optionalCliPositiveInteger(payload.idleTimeoutSeconds, "idleTimeoutSeconds"),
              onLeaseExpiry: optionalCliBoolean(payload.onLeaseExpiry, "onLeaseExpiry"),
              compatibilityProfiles: optionalCliCompatibilityProfiles(payload.compatibilityProfiles),
              overwrite: optionalCliBoolean(payload.overwrite, "overwrite")
            })
          : await scaffoldToolbox(parseCliScaffoldToolboxPayload(payload, manifestDirectory));
      writeJson(
        {
          ok: true,
          ...result
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

  if (parsed.command === "preview-toolbox") {
    try {
      const env = loadEnvironment();
      const payload = await loadCommandPayload(parsed.options);
      const manifestDirectory = resolveCliToolboxManifestDirectory(
        payload,
        env.toolboxManifestDir
      );
      const preview = await previewScaffoldToolbox(
        parseCliScaffoldToolboxPayload(payload, manifestDirectory)
      );
      writeJson(
        {
          ok: true,
          preview
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
      const dryRun = !parsed.options.apply;
      const applyPlan = buildDockerMcpRuntimeApplyPlan(plan);
      if (!dryRun) {
        const execution = applyDockerMcpRuntimePlan(plan, {
          executable: process.env.MIMIR_DOCKER_EXECUTABLE?.trim() || "docker",
          executableArgs: parseJsonStringArrayEnv(
            process.env.MIMIR_DOCKER_EXECUTABLE_ARGS_JSON,
            "MIMIR_DOCKER_EXECUTABLE_ARGS_JSON"
          )
        });
        writeJson(
          {
            ok: execution.status === "applied",
            dryRun: false,
            manifestDirectory,
            plan,
            apply: execution
          },
          parsed.options.pretty
        );
        process.exitCode = execution.status === "applied" ? 0 : 1;
        return;
      }
      writeJson(
        {
          ok: true,
          dryRun: true,
          manifestDirectory,
          plan,
          apply: {
            status: "dry-run",
            attempted: false,
            ...applyPlan
          }
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

  if (parsed.command === "sync-toolbox-runtime") {
    const env = loadEnvironment();
    const payload = await loadOptionalCommandPayload(parsed.options);
    const { controlSurface, dispose, manifestDirectory, activeProfileId, clientId } =
      buildCliToolboxControlSurface(payload, env);
    try {
      const generatedAt =
        optionalCliString(payload.generatedAt, "generatedAt")
        ?? new Date().toISOString();
      const policy = compileToolboxPolicyFromDirectory(manifestDirectory);
      const plan = compileDockerMcpRuntimePlan(policy, { generatedAt });
      const applyPlan = buildDockerMcpRuntimeApplyPlan(plan);
      const materialization = controlSurface.buildClientMaterialization(
        optionalCliString(payload.outputPath, "outputPath")
      );
      let applied = false;
      if (parsed.options.apply && materialization) {
        writeCodexClientMaterializationPlan(materialization);
        applied = true;
      }
      writeJson(
        {
          ok: true,
          dryRun: !parsed.options.apply,
          manifestDirectory,
          manifestRevision: policy.manifestRevision,
          activeProfileId,
          clientId,
          docker: {
            plan,
            applyPlan,
            applied: false
          },
          client: {
            applied,
            materialization
          }
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

  if (
    parsed.command === "list-toolboxes" ||
    parsed.command === "describe-toolbox" ||
    parsed.command === "request-toolbox-activation" ||
    parsed.command === "list-active-toolbox" ||
    parsed.command === "list-active-tools" ||
    parsed.command === "deactivate-toolbox" ||
    parsed.command === "sync-toolbox-client"
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
              actorRole: optionalCliActorRole(payload.actorRole, "actorRole"),
              taskSummary: optionalCliString(payload.taskSummary, "taskSummary"),
              clientId: optionalCliString(payload.clientId, "clientId"),
              approval: optionalToolboxApproval(payload.approval)
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

      if (parsed.command === "sync-toolbox-client") {
        const materialization = controlSurface.buildClientMaterialization(
          optionalCliString(payload.outputPath, "outputPath")
        );
        if (parsed.options.apply && materialization) {
          writeCodexClientMaterializationPlan(materialization);
        }
        writeJson(
          {
            ok: true,
            dryRun: !parsed.options.apply,
            manifestDirectory,
            activeProfileId,
            clientId,
            materialization
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
      writeJson(
        getAdministrativeAuthStatus(
          container,
          buildCliAdministrativeActorContext(
            "view_auth_status",
            extractAdministrativeActor(payload)
          )
        ),
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

  if (parsed.command === "auth-issuers") {
    const container = buildServiceContainer(loadEnvironment());
    try {
      const payload = await loadOptionalCommandPayload(parsed.options);
      writeJson(
        await listAdministrativeAuthIssuers(
          container,
          buildCliAdministrativeActorContext(
            "view_auth_issuers",
            extractAdministrativeActor(payload)
          )
        ),
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
      writeJson(
        listAdministrativeIssuedTokens(
          container,
          buildCliAdministrativeActorContext(
            "view_issued_tokens",
            extractAdministrativeActor(payload)
          ),
          validateListIssuedActorTokensControlRequest(payload)
        ),
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
      writeJson(
        inspectAdministrativeAuthToken(
          container,
          buildCliAdministrativeActorContext(
            "inspect_auth_token",
            extractAdministrativeActor(payload)
          ),
          validateInspectActorTokenControlRequest(payload)
        ),
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
      const payload = await loadOptionalCommandPayload(parsed.options);
      writeJson(
        await getAdministrativeFreshnessStatus(
          container,
          buildCliAdministrativeActorContext(
            "view_freshness_status",
            extractAdministrativeActor(payload)
          ),
          validateAdministrativeFreshnessStatusRequest(payload, {
            allowCorpusAliases: true
          })
        ),
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
      const payload = await loadCommandPayload(parsed.options);
      writeJson(
        await issueAdministrativeAuthToken(
          container,
          buildCliAdministrativeActorContext(
            "issue_auth_token",
            extractAdministrativeActor(payload)
          ),
          validateIssueActorTokenControlRequest(payload),
          {
            commandLabel: "issue-auth-token"
          }
        ),
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
      const payload = await loadCommandPayload(parsed.options);
      writeJson(
        await revokeAdministrativeAuthToken(
          container,
          buildCliAdministrativeActorContext(
            "revoke_auth_token",
            extractAdministrativeActor(payload)
          ),
          validateRevokeActorTokenControlRequest(payload),
          {
            commandLabel: "revoke-auth-token"
          }
        ),
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

  if (parsed.command === "revoke-auth-tokens") {
    const container = buildServiceContainer(loadEnvironment());
    try {
      const payload = await loadCommandPayload(parsed.options);
      writeJson(
        await revokeAdministrativeAuthTokens(
          container,
          buildCliAdministrativeActorContext(
            "revoke_auth_tokens",
            extractAdministrativeActor(payload)
          ),
          validateRevokeIssuedActorTokensControlRequest(payload),
          {
            commandLabel: "revoke-auth-tokens"
          }
        ),
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

  if (parsed.command === "set-auth-issuer-state") {
    const container = buildServiceContainer(loadEnvironment());
    try {
      const payload = await loadCommandPayload(parsed.options);
      writeJson(
        await setAdministrativeAuthIssuerState(
          container,
          buildCliAdministrativeActorContext(
            "manage_auth_issuers",
            extractAdministrativeActor(payload)
          ),
          validateSetAuthIssuerStateControlRequest(payload)
        ),
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
    stdin: false,
    apply: false,
    wizard: false
  };

  let command: CliCommandName | undefined;

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

    if (value === "--apply") {
      options.apply = true;
      continue;
    }

    if (value === "--wizard") {
      options.wizard = true;
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
      if (COMMANDS.includes(value as CliCommandName)) {
        command = value as CliCommandName;
        continue;
      }

      throw new Error(`Unknown command '${value}'.`);
    }

    throw new Error(`Unexpected argument '${value}'.`);
  }

  if (options.version) {
    command = "version";
  }

  if (
    options.apply &&
    command !== "sync-mcp-profiles" &&
    command !== "sync-toolbox-runtime" &&
    command !== "sync-toolbox-client"
  ) {
    throw new Error("--apply is only supported by sync-mcp-profiles, sync-toolbox-runtime, and sync-toolbox-client.");
  }

  if (options.wizard && command !== "scaffold-toolbox") {
    throw new Error("--wizard is only supported by scaffold-toolbox.");
  }

  if (options.wizard && (options.stdin || options.inputPath || options.inlineJson)) {
    throw new Error("--wizard cannot be combined with --stdin, --input, or --json.");
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

async function runScaffoldToolboxWizard(
  defaultManifestDirectory: string
): Promise<JsonRecord> {
  const manifestDirectory = path.resolve(defaultManifestDirectory);
  const policy = compileToolboxPolicyFromDirectory(manifestDirectory);
  const questioner = await createWizardQuestioner();
  const ask = questioner.ask;

  try {
    const mode = await promptRequiredChoice(
      ask,
      "Create a toolbox or a repeated workflow? [toolbox/workflow]: ",
      ["toolbox", "workflow"]
    );
    if (mode === "toolbox") {
      process.stderr.write(
        `Available server ids: ${Object.keys(policy.servers).sort().join(", ")}\n`
      );
      const bandId = await promptRequiredText(ask, "Toolbox id: ");
      const displayName = await promptRequiredText(ask, "Display name: ");
      const serverIds = await promptRequiredCsv(ask, "Server ids (comma separated): ");
      const summary = await promptOptionalText(ask, "Summary (optional): ");
      const exampleTasks = await promptOptionalCsv(ask, "Example tasks (comma separated, optional): ");
      const fallbackProfile = await promptTextWithDefault(ask, "Fallback profile", "bootstrap");
      const preferredActorRoles = await promptOptionalActorRoles(ask);
      const autoExpand = await promptBooleanWithDefault(ask, "Allow auto-expand", false);
      const requiresApproval = await promptBooleanWithDefault(ask, "Require approval", false);
      return {
        mode,
        manifestDirectory,
        bandId,
        displayName,
        serverIds,
        ...(summary ? { summary } : {}),
        ...(exampleTasks.length > 0 ? { exampleTasks } : {}),
        fallbackProfile,
        ...(preferredActorRoles.length > 0 ? { preferredActorRoles } : {}),
        autoExpand,
        requiresApproval
      };
    }

    process.stderr.write(
      `Available band ids: ${Object.keys(policy.bands).sort().join(", ")}\n`
    );
    const workflowId = await promptRequiredText(ask, "Workflow id: ");
    const displayName = await promptRequiredText(ask, "Display name: ");
    const includeBands = await promptRequiredCsv(ask, "Band ids to combine (comma separated): ");
    const summary = await promptOptionalText(ask, "Summary (optional): ");
    const exampleTasks = await promptOptionalCsv(ask, "Example tasks (comma separated, optional): ");
    const fallbackProfile = await promptTextWithDefault(ask, "Fallback profile", "bootstrap");
    const preferredActorRoles = await promptOptionalActorRoles(ask);
    const autoExpand = await promptBooleanWithDefault(ask, "Allow auto-expand", false);
    const requiresApproval = await promptBooleanWithDefault(ask, "Require approval", false);
    return {
      mode,
      manifestDirectory,
      workflowId,
      displayName,
      includeBands,
      ...(summary ? { summary } : {}),
      ...(exampleTasks.length > 0 ? { exampleTasks } : {}),
      fallbackProfile,
      ...(preferredActorRoles.length > 0 ? { preferredActorRoles } : {}),
        autoExpand,
        requiresApproval
      };
  } finally {
    questioner.close();
  }
}

function countCommandPayloadSources(options: ParsedCli["options"]): boolean[] {
  return [options.stdin, Boolean(options.inputPath), Boolean(options.inlineJson)].filter(Boolean);
}

type WizardQuestioner = (prompt: string) => Promise<string>;

async function createWizardQuestioner(): Promise<{
  ask: WizardQuestioner;
  close: () => void;
}> {
  if (!process.stdin.isTTY) {
    const scriptedAnswers = (await readStdin()).split(/\r?\n/);
    let answerIndex = 0;
    return {
      ask: async (prompt: string) => {
        process.stderr.write(prompt);
        const answer = scriptedAnswers[answerIndex];
        if (answer === undefined) {
          throw new Error("Wizard input ended before all prompts were answered.");
        }
        answerIndex += 1;
        process.stderr.write("\n");
        return answer;
      },
      close: () => {}
    };
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr
  });

  return {
    ask: (prompt: string) => rl.question(prompt),
    close: () => rl.close()
  };
}

async function promptRequiredChoice(
  ask: WizardQuestioner,
  prompt: string,
  allowedValues: string[]
): Promise<string> {
  while (true) {
    const answer = (await ask(prompt)).trim().toLowerCase();
    if (allowedValues.includes(answer)) {
      return answer;
    }
    process.stderr.write(`Please enter one of: ${allowedValues.join(", ")}.\n`);
  }
}

async function promptRequiredText(
  ask: WizardQuestioner,
  prompt: string
): Promise<string> {
  while (true) {
    const answer = (await ask(prompt)).trim();
    if (answer.length > 0) {
      return answer;
    }
    process.stderr.write("A value is required.\n");
  }
}

async function promptOptionalText(
  ask: WizardQuestioner,
  prompt: string
): Promise<string | undefined> {
  const answer = (await ask(prompt)).trim();
  return answer.length > 0 ? answer : undefined;
}

async function promptTextWithDefault(
  ask: WizardQuestioner,
  label: string,
  defaultValue: string
): Promise<string> {
  const answer = (await ask(`${label} [${defaultValue}]: `)).trim();
  return answer.length > 0 ? answer : defaultValue;
}

async function promptRequiredCsv(
  ask: WizardQuestioner,
  prompt: string
): Promise<string[]> {
  while (true) {
    const values = parseCsvValues(await ask(prompt));
    if (values.length > 0) {
      return values;
    }
    process.stderr.write("Provide at least one comma-separated value.\n");
  }
}

async function promptOptionalCsv(
  ask: WizardQuestioner,
  prompt: string
): Promise<string[]> {
  return parseCsvValues(await ask(prompt));
}

async function promptOptionalActorRoles(
  ask: WizardQuestioner
): Promise<ActorRole[]> {
  while (true) {
    const answer = await ask(
      `Preferred actor roles (comma separated, optional) [${ACTOR_ROLES.join(", ")}]: `
    );
    const values = parseCsvValues(answer);
    if (values.length === 0) {
      return [];
    }
    const invalidValue = values.find((value) => !ACTOR_ROLES.includes(value as ActorRole));
    if (!invalidValue) {
      return values as ActorRole[];
    }
    process.stderr.write(`Unknown actor role '${invalidValue}'.\n`);
  }
}

async function promptBooleanWithDefault(
  ask: WizardQuestioner,
  label: string,
  defaultValue: boolean
): Promise<boolean> {
  const defaultLabel = defaultValue ? "Y/n" : "y/N";
  while (true) {
    const answer = (await ask(`${label}? [${defaultLabel}]: `)).trim().toLowerCase();
    if (!answer) {
      return defaultValue;
    }
    if (["y", "yes", "true", "1"].includes(answer)) {
      return true;
    }
    if (["n", "no", "false", "0"].includes(answer)) {
      return false;
    }
    process.stderr.write("Please answer yes or no.\n");
  }
}

function parseCsvValues(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
      clientMaterializationRoot: process.cwd(),
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

function parseJsonStringArrayEnv(value: string | undefined, envName: string): string[] {
  if (!value?.trim()) {
    return [];
  }

  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`${envName} must be a JSON array of strings.`);
  }

  return parsed;
}

function optionalToolboxApproval(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const approval = value as Record<string, unknown>;
  const grantedBy = optionalCliString(approval.grantedBy, "approval.grantedBy");
  if (!grantedBy) {
    return undefined;
  }

  return {
    grantedBy,
    grantedAt: optionalCliString(approval.grantedAt, "approval.grantedAt"),
    reason: optionalCliString(approval.reason, "approval.reason"),
    toolboxId: optionalCliString(approval.toolboxId, "approval.toolboxId")
  };
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
mimir-cli <command> [--input <file> | --stdin | --json <payload> | --wizard] [--pretty | --no-pretty]

The root workspace pnpm cli script invokes this same CLI.

Commands:
  version              Print the runtime release metadata used for this build
  auth-issuers         List effective auth issuer controls for registered operators
  auth-status          Print the effective actor-registry and issued-token summary
  auth-issued-tokens   List recorded issued actor tokens and their lifecycle state
  auth-introspect-token  Inspect a static or issued actor token against the current auth policy
  check-mcp-profiles   Validate repo-managed Docker MCP toolbox manifests and emit the compiled contract summary
  list-toolbox-servers  List compiled MCP server choices and their categories/runtime bindings
  scaffold-toolbox     Create either a reusable toolbox band or a repeated workflow from JSON input or an interactive wizard
  scaffold-toolbox-band  Create a band-backed toolbox, base profile, and intent wiring from one JSON payload
  preview-toolbox      Validate a toolbox/workflow scaffold and show the compiled result without writing files
  sync-mcp-profiles    Compile a deterministic Docker MCP runtime plan; pass --apply to refresh Docker MCP profiles
  sync-toolbox-runtime Compile toolbox policy, Docker runtime output, and client materialization in one command; pass --apply to write the client artifact only
  sync-toolbox-client  Render Codex local-stdio peers into a deterministic client MCP config; pass --apply to write the file
  list-toolboxes       List intent-level toolboxes before peer MCP tools are exposed
  describe-toolbox     Describe one toolbox, its categories, and anti-use-cases
  request-toolbox-activation  Approve a profile-bound toolbox handoff and issue a lease when configured
  list-active-toolbox  Report the current active toolbox profile and overlay
  list-active-tools    Report the current profile's active tool descriptors after overlay suppression
  deactivate-toolbox   Revoke an issued toolbox lease and return the downgrade target
  freshness-status     Print temporal-validity summary data and refresh candidates
  issue-auth-token     Mint a short-lived issued actor token from JSON input
  revoke-auth-token    Revoke a previously issued actor token through the local revocation store
  revoke-auth-tokens   Revoke a bounded set of issued actor tokens through the local revocation store
  set-auth-issuer-state  Override issuer controls for one registered operator
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
  - auth-issuers accepts optional JSON input with actor.
  - auth-status has no required payload, but enforced auth mode requires operator or system actor context when you call the command.
  - auth-issued-tokens accepts optional JSON input with actor, actorId, asOf, includeRevoked, issuedByActorId, revokedByActorId, lifecycleStatus, and limit.
  - auth-introspect-token expects JSON input with token and optional asOf, expectedTransport, expectedCommand, or expectedAdministrativeAction.
  - check-mcp-profiles accepts optional JSON input with manifestDirectory.
  - list-toolbox-servers accepts optional JSON input with manifestDirectory and returns compiled server summaries.
  - scaffold-toolbox expects JSON input with mode=toolbox or mode=workflow; toolbox mode accepts bandId, displayName, serverIds, and workflow mode accepts workflowId, displayName, includeBands.
  - scaffold-toolbox --wizard runs an interactive prompt and must not be combined with --stdin, --input, or --json.
  - scaffold-toolbox-band expects JSON input with bandId, displayName, serverIds, and optional summary, exampleTasks, fallbackProfile, compatibilityProfiles, trust/mutation overrides, and preferredActorRoles.
  - preview-toolbox expects the same JSON input as scaffold-toolbox and returns a compiled preview without writing manifest files.
  - sync-mcp-profiles accepts optional JSON input with manifestDirectory and generatedAt; --apply probes Docker MCP profile support and exits non-zero when the local Docker MCP Toolkit cannot apply profiles.
  - sync-toolbox-runtime accepts optional JSON input with manifestDirectory, activeProfileId, clientId, generatedAt, and outputPath; --apply writes the rendered client artifact but does not mutate Docker.
  - sync-toolbox-client accepts optional JSON input with manifestDirectory, activeProfileId, clientId, and outputPath; --apply writes the rendered Codex MCP config to disk.
  - list-toolboxes accepts optional JSON input with manifestDirectory, activeProfileId, and clientId.
  - describe-toolbox expects JSON input with toolboxId and optional manifestDirectory, activeProfileId, and clientId.
  - request-toolbox-activation expects JSON input with requestedToolbox or requiredCategories, plus optional actorRole, taskSummary, clientId, manifestDirectory, and activeProfileId.
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
  - revoke-auth-tokens expects JSON input with at least one selector filter from actorId, issuedByActorId, revokedByActorId, or lifecycleStatus, plus optional asOf, includeRevoked, limit, dryRun, and reason.
  - set-auth-issuer-state expects JSON input with actorId, enabled, allowIssueAuthToken, allowRevokeAuthToken, and optional validFrom, validUntil, or reason.
  - Input payloads are JSON objects shaped like the existing service contracts.
  - Runtime command actor context is optional in the payload; the CLI injects command-safe defaults for those commands.
  - In enforced auth mode, auth-issuers, auth-status, auth-issued-tokens, auth-introspect-token, issue-auth-token, revoke-auth-token, revoke-auth-tokens, and set-auth-issuer-state require operator or system actor context in the JSON payload.
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

function requireCliStringArray(value: unknown, field: string): string[] {
  const parsed = optionalCliStringArray(value, field);
  if (!parsed || parsed.length === 0) {
    throw new Error(`Invalid field '${field}': must be a non-empty array of strings.`);
  }
  return parsed;
}

function optionalCliBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Invalid field '${field}': must be a boolean.`);
  }
  return value;
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

function optionalCliActorRoleArray(value: unknown, field: string): ActorRole[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid field '${field}': must be an array of actor roles.`);
  }
  return value.map((entry, index) => requireCliActorRole(entry, `${field}[${index}]`));
}

function optionalCliActorRole(value: unknown, field: string): ActorRole | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireCliActorRole(value, field);
}

function optionalCliMutationLevel(
  value: unknown,
  field: string
): ToolboxMutationLevel | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "read" || value === "write" || value === "admin") {
    return value;
  }
  throw new Error(`Invalid field '${field}': must be one of read, write, admin.`);
}

function optionalCliSessionMode(
  value: unknown,
  field: string
): "toolbox-bootstrap" | "toolbox-activated" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "toolbox-bootstrap" || value === "toolbox-activated") {
    return value;
  }
  throw new Error(`Invalid field '${field}': must be one of toolbox-bootstrap, toolbox-activated.`);
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

function optionalCliPositiveInteger(value: unknown, field: string): number | undefined {
  return optionalCliInteger(value, field, 1);
}

function optionalCliCompatibilityProfiles(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("Invalid field 'compatibilityProfiles': must be an array.");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid field 'compatibilityProfiles[${index}]': must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    return {
      id: requireCliString(record.id, `compatibilityProfiles[${index}].id`),
      displayName: requireCliString(record.displayName, `compatibilityProfiles[${index}].displayName`),
      additionalBands: requireCliStringArray(
        record.additionalBands,
        `compatibilityProfiles[${index}].additionalBands`
      ),
      compositeReason: optionalCliString(
        record.compositeReason,
        `compatibilityProfiles[${index}].compositeReason`
      ),
      fallbackProfile: optionalCliString(
        record.fallbackProfile,
        `compatibilityProfiles[${index}].fallbackProfile`
      ),
      summary: optionalCliString(record.summary, `compatibilityProfiles[${index}].summary`),
      exampleTasks: optionalCliStringArray(
        record.exampleTasks,
        `compatibilityProfiles[${index}].exampleTasks`
      )
    };
  });
}

function parseCliScaffoldToolboxPayload(
  payload: JsonRecord,
  manifestDirectory: string
) {
  const mode = requireCliString(payload.mode, "mode");
  if (mode === "toolbox") {
    return {
      mode,
      manifestDirectory,
      bandId: requireCliString(payload.bandId, "bandId"),
      displayName: requireCliString(payload.displayName, "displayName"),
      serverIds: requireCliStringArray(payload.serverIds, "serverIds"),
      summary: optionalCliString(payload.summary, "summary"),
      exampleTasks: optionalCliStringArray(payload.exampleTasks, "exampleTasks"),
      trustClass: optionalCliString(payload.trustClass, "trustClass"),
      mutationLevel: optionalCliMutationLevel(payload.mutationLevel, "mutationLevel"),
      autoExpand: optionalCliBoolean(payload.autoExpand, "autoExpand"),
      requiresApproval: optionalCliBoolean(payload.requiresApproval, "requiresApproval"),
      preferredActorRoles: optionalCliActorRoleArray(payload.preferredActorRoles, "preferredActorRoles"),
      allowedCategories: optionalCliStringArray(payload.allowedCategories, "allowedCategories"),
      deniedCategories: optionalCliStringArray(payload.deniedCategories, "deniedCategories"),
      fallbackProfile: optionalCliString(payload.fallbackProfile, "fallbackProfile"),
      sessionMode: optionalCliSessionMode(payload.sessionMode, "sessionMode"),
      taskAware: optionalCliBoolean(payload.taskAware, "taskAware"),
      idleTimeoutSeconds: optionalCliPositiveInteger(payload.idleTimeoutSeconds, "idleTimeoutSeconds"),
      onLeaseExpiry: optionalCliBoolean(payload.onLeaseExpiry, "onLeaseExpiry"),
      compatibilityProfiles: optionalCliCompatibilityProfiles(payload.compatibilityProfiles),
      overwrite: optionalCliBoolean(payload.overwrite, "overwrite")
    } as const;
  }

  if (mode === "workflow") {
    return {
      mode,
      manifestDirectory,
      workflowId: requireCliString(payload.workflowId, "workflowId"),
      displayName: requireCliString(payload.displayName, "displayName"),
      includeBands: requireCliStringArray(payload.includeBands, "includeBands"),
      summary: optionalCliString(payload.summary, "summary"),
      exampleTasks: optionalCliStringArray(payload.exampleTasks, "exampleTasks"),
      fallbackProfile: optionalCliString(payload.fallbackProfile, "fallbackProfile"),
      sessionMode: optionalCliSessionMode(payload.sessionMode, "sessionMode"),
      compositeReason: optionalCliString(payload.compositeReason, "compositeReason"),
      preferredActorRoles: optionalCliActorRoleArray(payload.preferredActorRoles, "preferredActorRoles"),
      autoExpand: optionalCliBoolean(payload.autoExpand, "autoExpand"),
      requiresApproval: optionalCliBoolean(payload.requiresApproval, "requiresApproval"),
      overwrite: optionalCliBoolean(payload.overwrite, "overwrite")
    } as const;
  }

  throw new Error("Invalid field 'mode': must be one of toolbox, workflow.");
}
