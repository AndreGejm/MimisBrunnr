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
  dockerApplyMode?: "catalog" | "descriptor-only";
  catalogServerId?: string;
  blockedReason?: string;
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

    const dockerApplyMode = server.dockerRuntime?.applyMode;
    const catalogServerId = server.dockerRuntime?.catalogServerId;
    const blockedReason = server.dockerRuntime?.blockedReason;

    return {
      id: server.id,
      dockerServerName,
      source: server.source,
      kind: server.kind,
      toolIds: server.tools.map((tool) => tool.toolId).sort(),
      ...(dockerApplyMode !== undefined ? { dockerApplyMode } : {}),
      ...(catalogServerId !== undefined ? { catalogServerId } : {}),
      ...(blockedReason !== undefined ? { blockedReason } : {})
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
        if (server.dockerApplyMode === "descriptor-only") {
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
        } else if (server.dockerApplyMode === "catalog" && server.catalogServerId) {
          serverRefs.push(`catalog://mcp/docker-mcp-catalog/${server.catalogServerId}`);
          gatewayServerNames.push(server.catalogServerId);
        } else if (server.dockerApplyMode === "catalog") {
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

  return {
    commands,
    gatewayRunCommands,
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
