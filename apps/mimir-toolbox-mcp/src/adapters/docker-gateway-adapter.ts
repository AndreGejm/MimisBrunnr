import process from "node:process";
import type { ToolboxRuntimeBindingManifest } from "@mimir/contracts";
import type {
  ToolboxBackendAdapter,
  ToolboxBackendHealth
} from "./toolbox-backend-adapter.js";
import { ProcessBackedToolboxBackendAdapter } from "./process-backed-adapter.js";

export class DockerGatewayToolboxBackendAdapter implements ToolboxBackendAdapter {
  readonly serverId: string;
  private readonly delegate: ProcessBackedToolboxBackendAdapter;

  constructor(
    serverId: string,
    private readonly runtimeBinding: Extract<ToolboxRuntimeBindingManifest, { kind: "docker-catalog" }>
  ) {
    this.serverId = serverId;
    this.delegate = new ProcessBackedToolboxBackendAdapter(serverId, {
      command: resolveGatewayExecutable(),
      args: [
        ...resolveGatewayBaseArgs(),
        "--servers",
        this.runtimeBinding.catalogServerId
      ],
      workingDirectory: process.cwd(),
      env: resolveGatewayEnv()
    });
  }

  start(): Promise<void> {
    return this.delegate.start();
  }

  stop(): Promise<void> {
    return this.delegate.stop();
  }

  listTools() {
    return this.delegate.listTools();
  }

  callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.delegate.callTool(name, args);
  }

  health(): ToolboxBackendHealth {
    return this.delegate.health();
  }
}

function resolveGatewayExecutable(): string {
  return (
    process.env.MAB_TOOLBOX_DOCKER_GATEWAY_EXECUTABLE?.trim()
    || "__missing_docker_gateway_executable__"
  );
}

function resolveGatewayBaseArgs(): string[] {
  const raw = process.env.MAB_TOOLBOX_DOCKER_GATEWAY_ARGS_JSON?.trim();
  if (!raw) {
    return ["mcp", "gateway", "run"];
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed)
      && parsed.every((entry) => typeof entry === "string")
    ) {
      return parsed;
    }
  } catch {
    // fall through to default
  }

  return ["mcp", "gateway", "run"];
}

function resolveGatewayEnv(): Record<string, string> {
  const raw = process.env.MAB_TOOLBOX_DOCKER_GATEWAY_ENV_JSON?.trim();
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] =>
            typeof entry[0] === "string" && typeof entry[1] === "string"
        )
      );
    }
  } catch {
    // fall through to default
  }

  return {};
}
