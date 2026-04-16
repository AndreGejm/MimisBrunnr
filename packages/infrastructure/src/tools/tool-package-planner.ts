import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ListedAiTool } from "@mimir/contracts";

export function toPackagePlanTool(tool: ListedAiTool, repoRoot: string) {
  if (!tool.runtime) {
    throw new Error(`Runtime descriptor is required for package plan tool '${tool.id}'.`);
  }

  const buildRecipePath = normalizePath(join("docker", "tool-images", tool.id, "Dockerfile"));
  const buildRecipeExists = existsSync(join(repoRoot, buildRecipePath));
  const caveats: string[] = [];
  if (!buildRecipeExists) {
    caveats.push(
      `Tool image must already exist locally as '${tool.image}'; no image build recipe exists at ${buildRecipePath}.`
    );
  }
  if (tool.mounts.workspace === "read_write") {
    caveats.push("Tool can write to the mounted workspace; review file edits before accepting them.");
  }
  if (tool.memoryWritePolicy !== "none") {
    caveats.push(
      "Tool must use governed Mimir commands for memory proposals; it must not mount Mimisbrunnr directly."
    );
  }

  return {
    id: tool.id,
    displayName: tool.displayName,
    kind: tool.kind,
    image: tool.image,
    dockerProfile: tool.dockerProfile,
    service: tool.runtime.compose.service,
    entrypoint: tool.entrypoint,
    capabilities: tool.capabilities,
    composeFiles: [...tool.runtime.compose.files],
    composeRun: {
      command: "docker" as const,
      args: [
        "compose",
        ...tool.runtime.compose.files.flatMap((file) => ["-f", file]),
        "--profile",
        tool.runtime.compose.profile,
        "run",
        "--rm",
        tool.runtime.compose.service
      ]
    },
    workspaceMount: tool.runtime.container.workspaceMount,
    ...(tool.runtime.container.cacheMount ? { cacheMount: tool.runtime.container.cacheMount } : {}),
    mimisbrunnrMountAllowed: tool.runtime.container.mimisbrunnrMountAllowed,
    memoryWritePolicy: tool.memoryWritePolicy,
    allowedMimirCommands: tool.allowedMimirCommands,
    authRole: tool.authRole,
    requiresOperatorReview: tool.requiresOperatorReview,
    environmentKeys: tool.runtime.environmentKeys,
    healthcheck: tool.healthcheck,
    buildRecipe: {
      path: buildRecipePath,
      exists: buildRecipeExists
    },
    caveats
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}