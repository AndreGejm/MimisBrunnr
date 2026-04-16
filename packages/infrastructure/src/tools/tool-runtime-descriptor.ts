import type {
  AiToolRuntimeDescriptor,
  ListedAiTool
} from "@mimir/contracts";
import type { ToolManifest } from "./tool-manifest.js";

export const RUNTIME_COMPOSE_FILES = ["docker/compose.local.yml", "docker/compose.tools.yml"];

const WORKSPACE_MOUNT_ENVIRONMENT_VARIABLE = "MIMIR_TOOL_WORKSPACE";
const DEFAULT_WORKSPACE_HOST_PATH = "..";
const WORKSPACE_CONTAINER_PATH = "/workspace";
const CACHE_CONTAINER_PATH = "/cache";
const TOOL_WORKING_DIR = "/workspace";

export function toListedTool(
  tool: ToolManifest,
  options: { includeEnvironment: boolean; includeRuntime: boolean }
): ListedAiTool {
  const listed: ListedAiTool = {
    id: tool.id,
    displayName: tool.displayName,
    kind: tool.kind,
    image: tool.image,
    dockerProfile: tool.dockerProfile,
    entrypoint: tool.entrypoint,
    capabilities: tool.capabilities,
    mounts: tool.mounts,
    memoryWritePolicy: tool.memoryWritePolicy,
    allowedMimirCommands: tool.allowedMimirCommands,
    authRole: tool.authRole,
    requiresOperatorReview: tool.requiresOperatorReview,
    healthcheck: tool.healthcheck
  };

  if (options.includeEnvironment && tool.environment) {
    listed.environment = tool.environment;
  }

  if (options.includeRuntime) {
    listed.runtime = toRuntimeDescriptor(tool);
  }

  return listed;
}

export function toRuntimeDescriptor(tool: ToolManifest): AiToolRuntimeDescriptor {
  const cacheMount = tool.mounts.cache === "none"
    ? undefined
    : {
        volume: `mimir_${tool.id}_cache`,
        containerPath: CACHE_CONTAINER_PATH,
        access: tool.mounts.cache
      };

  return {
    compose: {
      files: [...RUNTIME_COMPOSE_FILES],
      profile: tool.dockerProfile,
      service: tool.dockerProfile
    },
    container: {
      image: tool.image,
      entrypoint: tool.entrypoint,
      workingDir: TOOL_WORKING_DIR,
      workspaceMount: {
        environmentVariable: WORKSPACE_MOUNT_ENVIRONMENT_VARIABLE,
        defaultHostPath: DEFAULT_WORKSPACE_HOST_PATH,
        containerPath: WORKSPACE_CONTAINER_PATH,
        access: tool.mounts.workspace
      },
      ...(cacheMount ? { cacheMount } : {}),
      mimisbrunnrMountAllowed: false
    },
    environmentKeys: Object.keys(tool.environment ?? {}).sort()
  };
}