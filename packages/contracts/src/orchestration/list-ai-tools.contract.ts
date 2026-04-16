import type { ActorContext, ActorRole } from "../common/actor-context.js";
import type { RuntimeCliCommandName } from "./command-catalog.js";

export type AiToolKind = "cli" | "coding_agent" | "repo_indexer" | "mcp_server";
export type AiToolMountAccess = "none" | "read_only" | "read_write";
export type AiToolMemoryWritePolicy = "none" | "session_only" | "draft_note_only";

export interface AiToolRuntimeDescriptor {
  compose: {
    files: string[];
    profile: string;
    service: string;
  };
  container: {
    image: string;
    entrypoint: string[];
    workingDir: string;
    workspaceMount: {
      environmentVariable: string;
      defaultHostPath: string;
      containerPath: string;
      access: AiToolMountAccess;
    };
    cacheMount?: {
      volume: string;
      containerPath: string;
      access: Exclude<AiToolMountAccess, "none">;
    };
    mimisbrunnrMountAllowed: false;
  };
  environmentKeys: string[];
}

export interface AiToolPackagePlanTool {
  id: string;
  displayName: string;
  kind: AiToolKind;
  image: string;
  dockerProfile: string;
  service: string;
  entrypoint: string[];
  capabilities: string[];
  composeFiles: string[];
  composeRun: {
    command: "docker";
    args: string[];
  };
  workspaceMount: AiToolRuntimeDescriptor["container"]["workspaceMount"];
  cacheMount?: AiToolRuntimeDescriptor["container"]["cacheMount"];
  mimisbrunnrMountAllowed: false;
  memoryWritePolicy: AiToolMemoryWritePolicy;
  allowedMimirCommands: RuntimeCliCommandName[];
  authRole: ActorRole;
  requiresOperatorReview: boolean;
  environmentKeys: string[];
  healthcheck: {
    command: string[];
  };
  buildRecipe: {
    path: string;
    exists: boolean;
  };
  caveats: string[];
}

export interface ListedAiTool {
  id: string;
  displayName: string;
  kind: AiToolKind;
  image: string;
  dockerProfile: string;
  entrypoint: string[];
  capabilities: string[];
  mounts: {
    workspace: AiToolMountAccess;
    cache: AiToolMountAccess;
    mimisbrunnr: AiToolMountAccess;
  };
  memoryWritePolicy: AiToolMemoryWritePolicy;
  allowedMimirCommands: RuntimeCliCommandName[];
  authRole: ActorRole;
  requiresOperatorReview: boolean;
  healthcheck: {
    command: string[];
  };
  environment?: Record<string, string>;
  runtime?: AiToolRuntimeDescriptor;
}

export interface ListAiToolsRequest {
  actor: ActorContext;
  ids?: string[];
  includeEnvironment?: boolean;
  includeRuntime?: boolean;
}

export interface ListAiToolsResponse {
  registryPath: string;
  generatedAt: string;
  tools: ListedAiTool[];
  warnings: string[];
}

export interface GetAiToolPackagePlanRequest {
  actor: ActorContext;
  ids?: string[];
}

export interface GetAiToolPackagePlanResponse {
  registryPath: string;
  generatedAt: string;
  packageReady: boolean;
  composeFiles: string[];
  tools: AiToolPackagePlanTool[];
  warnings: string[];
}

export interface AiToolCheckResult {
  fileName: string;
  toolId?: string;
  dockerProfile?: string;
  status: "valid" | "invalid";
  errors: string[];
  warnings: string[];
}

export interface CheckAiToolsRequest {
  actor: ActorContext;
  ids?: string[];
}

export interface CheckAiToolsResponse {
  registryPath: string;
  generatedAt: string;
  ok: boolean;
  checks: AiToolCheckResult[];
  warnings: string[];
}