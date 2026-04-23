import type { CompiledToolboxPolicy } from "@mimir/contracts";
import { spawnSync } from "node:child_process";

export interface DockerMcpRuntimeServerPlan {
  id: string;
  dockerServerName: string;
  source: "owned" | "peer";
  kind: "control" | "semantic" | "peer";
  toolIds: string[];
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
}

export interface DockerMcpRuntimeApplyPlan {
  commands: DockerMcpRuntimeApplyCommandPlan[];
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
  status: "applied" | "unsupported" | "failed";
  plan: DockerMcpRuntimeApplyPlan;
  compatibility: DockerMcpRuntimeCompatibilityReport;
  commandResults: DockerMcpRuntimeCommandResult[];
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
    return {
      id: server.id,
      dockerServerName,
      source: server.source,
      kind: server.kind,
      toolIds: server.tools.map((tool) => tool.toolId).sort()
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

  return {
    commands: plan.profiles.map((profile) => {
      const serverRefs = profile.serverIds.map((serverId) => {
        const server = serversById.get(serverId);
        if (!server) {
          throw new Error(
            `Profile '${profile.id}' references unknown server '${serverId}' in the runtime plan.`
          );
        }

        if (server.source === "peer") {
          return `catalog://mcp/docker-mcp-catalog/${server.dockerServerName}`;
        }

        return `file://./docker/mcp/servers/${server.id}.yaml`;
      });

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
        serverRefs
      } satisfies DockerMcpRuntimeApplyCommandPlan;
    })
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
