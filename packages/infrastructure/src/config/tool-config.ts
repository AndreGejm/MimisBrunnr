import path from "node:path";
import type { AppEnvironment } from "./app-environment.js";
import { DEFAULT_WORKSPACE_ROOT } from "./config-helpers.js";

export type ToolConfig = Pick<AppEnvironment, "toolRegistryDir">;

export function loadToolConfig(env: NodeJS.ProcessEnv = process.env): ToolConfig {
  return {
    toolRegistryDir:
      env.MAB_TOOL_REGISTRY_DIR?.trim() ||
      path.join(DEFAULT_WORKSPACE_ROOT, "docker", "tool-registry")
  };
}

export function normalizeToolConfig(input: Partial<AppEnvironment>): ToolConfig {
  return {
    toolRegistryDir:
      input.toolRegistryDir ??
      path.join(DEFAULT_WORKSPACE_ROOT, "docker", "tool-registry")
  };
}