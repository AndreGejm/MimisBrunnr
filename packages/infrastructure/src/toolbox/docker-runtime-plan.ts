import type { CompiledToolboxPolicy } from "@mimir/contracts";
import { spawnSync } from "node:child_process";

export interface DockerMcpBlockedServer {
  id: string;
  blockedReason: string;
}

export interface DockerMcpRuntimeServerPlan {
  id: string;
  dockerServerName: string;
  source: "owned" | "peer";
  kind: "control" | "semantic" | "peer";
  toolIds: string[];
  runtimeBindingKind?: "docker-catalog" | "descriptor-only" | "local-stdio";
  dockerApplyMode?: "catalog" | "descriptor-only";
  catalogServerId?: string;
  blockedReason?: string;
  unsafeCatalogServerIds?: string[];
  configTarget?: "codex-mcp-json";
}

export interface DockerMcpRuntimeProfilePlan {
  id: string;
  dockerProfileName: string;
  sessionMode: "toolbox-bootstrap" | "toolbox-activated";
  serverIds: string[];
  toolIds: string[];
}

export interface DockerMcpRuntimePlan {
  manifestRevision: string;
  generatedAt: string;
  servers: DockerMcpRuntimeServerPlan[];
  profiles: DockerMcpRuntimeProfilePlan[];
}

export interface DockerMcpRuntimeApplyCommandPlan {
  description: string;
  argv: string[];
  profileId: string;
  serverRefs: string[];
  blockedServers?: DockerMcpBlockedServer[];
}

export interface DockerMcpRuntimeGatewayRunCommandPlan {
  description: string;
  argv: string[];
  profileId: string;
  serverNames: string[];
  omittedServers?: DockerMcpBlockedServer[];
}

export interface DockerMcpRuntimeApplyPlan {
  commands: DockerMcpRuntimeApplyCommandPlan[];
  gatewayRunCommands: DockerMcpRuntimeGatewayRunCommandPlan[];
  omittedServers?: DockerMcpBlockedServer[];
  blockedServers?: DockerMcpBlockedServer[];
}

export interface DockerMcpRuntimeCompatibilityReport {
  supported: boolean;
  executable: string;
  probeCommand: string[];
  availableCommands: string[];
  profileCommandDetected: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  nextSteps: string[];
}

export interface DockerMcpGatewayProfileCompatibilityReport {
  supported: boolean;
  executable: string;
  probeCommand: string[];
  gatewayRunDetected: boolean;
  profileFlagDetected: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  nextSteps: string[];
}

export interface DockerMcpRuntimeCommandResult {
  argv: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface DockerMcpRuntimeApplyExecutionResult {
  attempted: boolean;
  status: "applied" | "unsupported" | "failed" | "blocked";
  plan: DockerMcpRuntimeApplyPlan;
  compatibility: DockerMcpRuntimeCompatibilityReport;
  commandResults: DockerMcpRuntimeCommandResult[];
  blockedServers?: DockerMcpBlockedServer[];
  failedCommand?: DockerMcpRuntimeApplyCommandPlan;
  failureMessage?: string;
}

export interface CompileDockerMcpRuntimePlanOptions {
  generatedAt?: string;
}

export function compileDockerMcpRuntimePlan(
  policy: CompiledToolboxPolicy,
  options: CompileDockerMcpRuntimePlanOptions = {}
): DockerMcpRuntimePlan {
  const profileNameCollisions = new Map<string, string>();
  const serverNameCollisions = new Map<string, string>();

  const servers = Object.values(policy.servers).map((server) => {
    const dockerServerName = canonicalizeDockerIdentifier(server.id);
    assertCollision(serverNameCollisions, dockerServerName, server.id, "server");

    const runtimeBinding = server.runtimeBinding;
    const runtimeBindingKind = runtimeBinding?.kind;
    let dockerApplyMode: "catalog" | "descriptor-only" | undefined;
    let catalogServerId: string | undefined;
    let blockedReason: string | undefined;
    let unsafeCatalogServerIds: string[] | undefined;
    let configTarget: "codex-mcp-json" | undefined;
    if (runtimeBinding) {
      switch (runtimeBinding.kind) {
        case "docker-catalog":
          dockerApplyMode = "catalog";
          catalogServerId = runtimeBinding.catalogServerId;
          break;
        case "descriptor-only":
          dockerApplyMode = "descriptor-only";
          blockedReason = runtimeBinding.blockedReason;
          unsafeCatalogServerIds = runtimeBinding.unsafeCatalogServerIds;
          break;
        case "local-stdio":
          configTarget = runtimeBinding.configTarget;
          break;
      }
    }

    return {
      id: server.id,
      dockerServerName,
      source: server.source,
      kind: server.kind,
      toolIds: server.tools.map((tool) => tool.toolId).sort(),
      ...(runtimeBindingKind !== undefined ? { runtimeBindingKind } : {}),
      ...(dockerApplyMode !== undefined ? { dockerApplyMode } : {}),
      ...(catalogServerId !== undefined ? { catalogServerId } : {}),
      ...(blockedReason !== undefined ? { blockedReason } : {}),
      ...(unsafeCatalogServerIds !== undefined
        ? { unsafeCatalogServerIds: [...unsafeCatalogServerIds].sort() }
        : {}),
      ...(configTarget !== undefined ? { configTarget } : {})
    } satisfies DockerMcpRuntimeServerPlan;
  });

  const profiles = Object.values(policy.profiles).map((profile) => {
    const dockerProfileName = canonicalizeDockerIdentifier(profile.id);
    assertCollision(profileNameCollisions, dockerProfileName, profile.id, "profile");
    return {
      id: profile.id,
      dockerProfileName,
      sessionMode: profile.sessionMode,
      serverIds: [...profile.includeServers].sort(),
      toolIds: profile.tools.map((tool) => tool.toolId).sort()
    } satisfies DockerMcpRuntimeProfilePlan;
  });

  return {
    manifestRevision: policy.manifestRevision,
    generatedAt: options.generatedAt ?? "1970-01-01T00:00:00.000Z",
    servers: servers.sort((left, right) => left.id.localeCompare(right.id)),
    profiles: profiles.sort((left, right) => left.id.localeCompare(right.id))
  };
}

export function canonicalizeDockerIdentifier(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
  return normalized || "default";
}

export function buildDockerMcpRuntimeApplyPlan(
  plan: DockerMcpRuntimePlan
): DockerMcpRuntimeApplyPlan {
  const serversById = new Map(plan.servers.map((server) => [server.id, server]));
  const planBlockedById = new Map<string, DockerMcpBlockedServer>();
  const planOmittedById = new Map<string, DockerMcpBlockedServer>();
  const gatewayRunCommands: DockerMcpRuntimeGatewayRunCommandPlan[] = [];

  const commands: DockerMcpRuntimeApplyCommandPlan[] = plan.profiles.map((profile) => {
    const commandBlockedServers: DockerMcpBlockedServer[] = [];
    const serverRefs: string[] = [];
    const gatewayServerNames: string[] = [];
    const gatewayOmittedServers: DockerMcpBlockedServer[] = [];

    for (const serverId of profile.serverIds) {
      const server = serversById.get(serverId);
      if (!server) {
        throw new Error(
          `Profile '${profile.id}' references unknown server '${serverId}' in the runtime plan.`
        );
      }

      if (server.source === "peer") {
        const isLocalStdio = server.runtimeBindingKind === "local-stdio";
        const isDescriptorOnly =
          server.runtimeBindingKind === "descriptor-only" ||
          server.dockerApplyMode === "descriptor-only";
        const isCatalogMode =
          server.runtimeBindingKind === "docker-catalog" ||
          server.dockerApplyMode === "catalog";

        if (isLocalStdio) {
          const omitted: DockerMcpBlockedServer = {
            id: server.id,
            blockedReason:
              server.configTarget === "codex-mcp-json"
                ? "client-materialized local-stdio peer: sync-toolbox-client writes this server into Codex MCP config"
                : "client-materialized local-stdio peer"
          };
          gatewayOmittedServers.push(omitted);
          planOmittedById.set(server.id, omitted);
        } else if (isDescriptorOnly) {
          const descriptorOnlyReason = server.blockedReason ?? "no safe catalog target";
          const blocked: DockerMcpBlockedServer = {
            id: server.id,
            blockedReason: /descriptor-only/i.test(descriptorOnlyReason)
              ? descriptorOnlyReason
              : `descriptor-only: ${descriptorOnlyReason}`
          };
          commandBlockedServers.push(blocked);
          gatewayOmittedServers.push(blocked);
          planBlockedById.set(server.id, blocked);
        } else if (isCatalogMode && server.catalogServerId) {
          serverRefs.push(`catalog://mcp/docker-mcp-catalog/${server.catalogServerId}`);
          gatewayServerNames.push(server.catalogServerId);
        } else if (isCatalogMode) {
          const blocked: DockerMcpBlockedServer = {
            id: server.id,
            blockedReason: "missing catalogServerId: catalog-mode peer server has no catalog target"
          };
          commandBlockedServers.push(blocked);
          gatewayOmittedServers.push(blocked);
          planBlockedById.set(server.id, blocked);
        } else {
          const blocked: DockerMcpBlockedServer = {
            id: server.id,
            blockedReason:
              server.blockedReason ??
              "missing dockerApplyMode: apply metadata required for peer servers"
          };
          commandBlockedServers.push(blocked);
          gatewayOmittedServers.push(blocked);
          planBlockedById.set(server.id, blocked);
        }
      } else {
        serverRefs.push(`file://./docker/mcp/servers/${server.id}.yaml`);
        gatewayOmittedServers.push({
          id: server.id,
          blockedReason:
            "owned server: docker mcp gateway run --servers fallback only supports catalog-mode peer servers"
        });
      }
    }

    if (gatewayServerNames.length > 0) {
      gatewayRunCommands.push({
        description:
          `Run Docker MCP gateway for catalog-mode peer subset in profile '${profile.id}' (diagnostic fallback only).`,
        argv: [
          "mcp",
          "gateway",
          "run",
          "--servers",
          gatewayServerNames.join(",")
        ],
        profileId: profile.id,
        serverNames: gatewayServerNames,
        ...(gatewayOmittedServers.length > 0 ? { omittedServers: gatewayOmittedServers } : {})
      } satisfies DockerMcpRuntimeGatewayRunCommandPlan);
    }

    return {
      description: `Create or refresh Docker MCP profile '${profile.id}'.`,
      argv: [
        "mcp",
        "profile",
        "create",
        "--name",
        profile.dockerProfileName,
        "--id",
        profile.dockerProfileName,
        ...serverRefs.flatMap((serverRef) => ["--server", serverRef])
      ],
      profileId: profile.id,
      serverRefs,
      ...(commandBlockedServers.length > 0 ? { blockedServers: commandBlockedServers } : {})
    } satisfies DockerMcpRuntimeApplyCommandPlan;
  });

  const planBlockedServers = [...planBlockedById.values()].sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  const planOmittedServers = [...planOmittedById.values()].sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  return {
    commands,
    gatewayRunCommands,
    ...(planOmittedServers.length > 0 ? { omittedServers: planOmittedServers } : {}),
    ...(planBlockedServers.length > 0 ? { blockedServers: planBlockedServers } : {})
  };
}

export function probeDockerMcpProfileSupport(
  executable = "docker",
  executableArgs: string[] = []
): DockerMcpRuntimeCompatibilityReport {
  const probeCommand = ["mcp", "--help"];
  const probe = spawnSync(executable, [...executableArgs, ...probeCommand], {
    encoding: "utf8"
  });
  const stdout = normalizeTextOutput(probe.stdout);
  const stderr = normalizeTextOutput(probe.stderr);
  const availableCommands = parseDockerMcpCommands(stdout);
  const profileCommandDetected = availableCommands.includes("profile");
  return {
    supported: profileCommandDetected && probe.status === 0,
    executable,
    probeCommand,
    availableCommands,
    profileCommandDetected,
    stdout,
    stderr,
    exitCode: probe.status,
    nextSteps: profileCommandDetected
      ? []
      : [
          "Upgrade to a Docker MCP Toolkit build that exposes `docker mcp profile`.",
          "Enable the profiles feature with `docker mcp feature enable profiles` if it is available in your installation.",
          "Re-run the sync after `docker mcp --help` lists `profile` under available commands."
        ]
  };
}

export function probeDockerMcpGatewayProfileSupport(
  executable = "docker",
  executableArgs: string[] = []
): DockerMcpGatewayProfileCompatibilityReport {
  const probeCommand = ["mcp", "gateway", "run", "--help"];
  const probe = spawnSync(executable, [...executableArgs, ...probeCommand], {
    encoding: "utf8"
  });
  const stdout = normalizeTextOutput(probe.stdout);
  const stderr = normalizeTextOutput(probe.stderr);
  const gatewayRunDetected =
    probe.status === 0 && /Usage:\s+docker\s+mcp\s+gateway\s+run/i.test(stdout);
  const profileFlagDetected = /^\s*--profile(?:\s|,|$)/im.test(stdout);
  return {
    supported: gatewayRunDetected && profileFlagDetected,
    executable,
    probeCommand,
    gatewayRunDetected,
    profileFlagDetected,
    stdout,
    stderr,
    exitCode: probe.status,
    nextSteps: gatewayRunDetected && profileFlagDetected
      ? []
      : [
          "Upgrade to Docker Desktop 4.62 or later so `docker mcp gateway run --profile <profile-id>` is available.",
          "Re-run `docker mcp gateway run --help` and confirm it lists `--profile`.",
          "Use profile-scoped client commands only after the gateway supports profile selection."
        ]
  };
}

export function applyDockerMcpRuntimePlan(
  plan: DockerMcpRuntimePlan,
  options: { executable?: string; executableArgs?: string[] } = {}
): DockerMcpRuntimeApplyExecutionResult {
  const applyPlan = buildDockerMcpRuntimeApplyPlan(plan);
  const executable = options.executable ?? "docker";
  const executableArgs = options.executableArgs ?? [];
  const compatibility = probeDockerMcpProfileSupport(executable, executableArgs);
  if (!compatibility.supported) {
    return {
      attempted: false,
      status: "unsupported",
      plan: applyPlan,
      compatibility,
      commandResults: []
    };
  }

  const blockedServers = applyPlan.blockedServers ?? [];
  if (blockedServers.length > 0) {
    return {
      attempted: false,
      status: "blocked",
      plan: applyPlan,
      compatibility,
      commandResults: [],
      blockedServers
    };
  }

  const commandResults: DockerMcpRuntimeCommandResult[] = [];
  for (const command of applyPlan.commands) {
    const result = spawnSync(
      executable,
      [...executableArgs, ...command.argv],
      { encoding: "utf8" }
    );
    const commandResult: DockerMcpRuntimeCommandResult = {
      argv: command.argv,
      exitCode: result.status,
      stdout: normalizeTextOutput(result.stdout),
      stderr: normalizeTextOutput(result.stderr)
    };
    commandResults.push(commandResult);
    if (result.status !== 0) {
      return {
        attempted: true,
        status: "failed",
        plan: applyPlan,
        compatibility,
        commandResults,
        failedCommand: command,
        failureMessage: commandResult.stderr || commandResult.stdout || `docker exited with status ${String(result.status)}`
      };
    }
  }

  return {
    attempted: true,
    status: "applied",
    plan: applyPlan,
    compatibility,
    commandResults
  };
}

function assertCollision(
  seenValues: Map<string, string>,
  dockerIdentifier: string,
  originalId: string,
  label: "profile" | "server"
): void {
  const previous = seenValues.get(dockerIdentifier);
  if (previous && previous !== originalId) {
    throw new Error(
      `Canonical Docker ${label} identifier collision: '${previous}' and '${originalId}' both map to '${dockerIdentifier}'.`
    );
  }
  seenValues.set(dockerIdentifier, originalId);
}

function parseDockerMcpCommands(stdout: string): string[] {
  const commands: string[] = [];
  const lines = stdout.split(/\r?\n/);
  let inCommandSection = false;
  for (const line of lines) {
    if (/^Available Commands:/i.test(line)) {
      inCommandSection = true;
      continue;
    }
    if (!inCommandSection) {
      continue;
    }
    if (!line.trim()) {
      break;
    }
    const match = line.match(/^\s{2,}([a-z][a-z0-9-]*)\s{2,}/i);
    if (match) {
      commands.push(match[1]);
    }
  }
  return commands;
}

function normalizeTextOutput(value: unknown): string {
  return typeof value === "string" ? value : "";
}
