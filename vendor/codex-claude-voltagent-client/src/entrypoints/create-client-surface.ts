import type { IOType } from "node:child_process";
import type { Stream } from "node:stream";
import type {
  AgentHooks,
  WorkspaceSkillsPromptOptions
} from "@voltagent/core";
import { loadClientConfig } from "../config/load-client-config.js";
import type { WorkflowMemoryAuthority } from "../runtime/workflow-policy.js";
import { MimirCommandAdapter, type MimirCommandSurface } from "../mimir/mimir-command-adapter.js";
import {
  connectStdioMimirTransport,
  type MimirClientInfo
} from "../mimir/stdio-mimir-transport.js";
import { createCachedMimirCommandSurface } from "../mimir/create-cached-mimir-command-surface.js";
import {
  classifyTaskRoute,
  type ClientTaskRoute,
  type ClientTaskRouteInput
} from "../router/client-task-router.js";

interface RuntimeOptions {
  hooks?: AgentHooks;
  workspaceSkillsPrompt?: WorkspaceSkillsPromptOptions | boolean;
  workflowMemoryAuthority?: WorkflowMemoryAuthority;
}

export interface CreateClientSurfaceInput extends RuntimeOptions {
  config: unknown;
  mimirStdio?: {
    clientInfo?: MimirClientInfo;
    cwd?: string;
    env?: Record<string, string>;
    stderr?: IOType | Stream | number;
  };
}

export interface ClientSurface<TRuntime> {
  runtime: TRuntime;
  mimir: MimirCommandSurface;
  classifyTaskRoute(input: ClientTaskRouteInput): ClientTaskRoute;
  close(): Promise<void>;
}

export async function createClientSurface<TRuntime>(
  input: CreateClientSurfaceInput,
  createRuntime: (input: {
    model: string;
    skillRootPaths: string[];
    hooks?: AgentHooks;
    workspaceSkillsPrompt?: WorkspaceSkillsPromptOptions | boolean;
    workflowMemoryAuthority?: WorkflowMemoryAuthority;
  }) => TRuntime
): Promise<ClientSurface<TRuntime>> {
  const config = loadClientConfig(input.config);
  const runtime = createRuntime({
    model: config.models.primary,
    skillRootPaths: config.skills.rootPaths,
    hooks: input.hooks,
    workspaceSkillsPrompt: input.workspaceSkillsPrompt,
    workflowMemoryAuthority: input.workflowMemoryAuthority
  });
  const connectedTransport = await connectStdioMimirTransport(
    config.mimir,
    input.mimirStdio
  );
  const adapter = new MimirCommandAdapter(connectedTransport.transport);
  const mimir = createCachedMimirCommandSurface(adapter);

  return {
    runtime,
    mimir,
    classifyTaskRoute,
    close: () => connectedTransport.close()
  };
}
