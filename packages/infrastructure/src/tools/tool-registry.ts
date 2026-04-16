import { resolve } from "node:path";
import type {
  CheckAiToolsRequest,
  CheckAiToolsResponse,
  GetAiToolPackagePlanRequest,
  GetAiToolPackagePlanResponse,
  ListAiToolsRequest,
  ListAiToolsResponse
} from "@mimir/contracts";
import {
  loadToolRegistryChecksFromDirectory,
  loadToolRegistryFromDirectory
} from "./tool-manifest-store.js";
import {
  type ToolManifest,
  validateToolManifest
} from "./tool-manifest.js";
import { toPackagePlanTool } from "./tool-package-planner.js";
import { RUNTIME_COMPOSE_FILES, toListedTool } from "./tool-runtime-descriptor.js";

export type {
  ToolKind,
  ToolManifest,
  ToolMemoryWritePolicy,
  ToolMountAccess
} from "./tool-manifest.js";
export { loadToolRegistryFromDirectory, validateToolManifest };

type ToolRegistryListRequest = Partial<Pick<ListAiToolsRequest, "ids" | "includeEnvironment" | "includeRuntime">>;
type ToolRegistryCheckRequest = Partial<Pick<CheckAiToolsRequest, "ids">>;
type ToolRegistryPackagePlanRequest = Partial<Pick<GetAiToolPackagePlanRequest, "ids">>;

export class FileSystemToolRegistry {
  constructor(
    private readonly directory: string,
    private readonly repoRoot = resolve(directory, "..", "..")
  ) {}

  listTools(request: ToolRegistryListRequest = {}): ListAiToolsResponse {
    const manifests = loadToolRegistryFromDirectory(this.directory);
    const requestedIds = new Set(request.ids ?? []);
    const filteredTools = requestedIds.size === 0
      ? manifests
      : manifests.filter((tool) => requestedIds.has(tool.id));
    const foundIds = new Set(filteredTools.map((tool) => tool.id));

    return {
      registryPath: this.directory,
      generatedAt: new Date().toISOString(),
      tools: filteredTools.map((tool) =>
        toListedTool(tool, {
          includeEnvironment: request.includeEnvironment === true,
          includeRuntime: request.includeRuntime === true
        })
      ),
      warnings: [...requestedIds]
        .filter((id) => !foundIds.has(id))
        .map((id) => `Tool manifest '${id}' was not found.`)
    };
  }

  getPackagePlan(request: ToolRegistryPackagePlanRequest = {}): GetAiToolPackagePlanResponse {
    const listed = this.listTools({ ids: request.ids, includeRuntime: true });

    return {
      registryPath: listed.registryPath,
      generatedAt: listed.generatedAt,
      packageReady: listed.tools.length > 0 && listed.warnings.length === 0,
      composeFiles: [...RUNTIME_COMPOSE_FILES],
      tools: listed.tools.map((tool) => toPackagePlanTool(tool, this.repoRoot)),
      warnings: listed.warnings
    };
  }

  checkTools(request: ToolRegistryCheckRequest = {}): CheckAiToolsResponse {
    const requestedIds = new Set(request.ids ?? []);
    const { checks, warnings } = loadToolRegistryChecksFromDirectory(
      this.directory,
      requestedIds
    );

    return {
      registryPath: this.directory,
      generatedAt: new Date().toISOString(),
      ok: checks.length > 0 && checks.every((check) => check.status === "valid"),
      checks,
      warnings
    };
  }
}