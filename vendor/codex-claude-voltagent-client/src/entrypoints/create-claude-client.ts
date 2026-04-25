import type { CreateClaudeRuntimeInput } from "./create-claude-runtime.js";
import { createClaudeRuntime } from "./create-claude-runtime.js";
import {
  createClientSurface,
  type ClientSurface,
  type CreateClientSurfaceInput
} from "./create-client-surface.js";

export interface CreateClaudeClientInput
  extends Omit<CreateClientSurfaceInput, keyof CreateClaudeRuntimeInput>,
    Pick<
      CreateClaudeRuntimeInput,
      "hooks" | "workspaceSkillsPrompt" | "workflowMemoryAuthority"
    > {}

export type ClaudeClient = ClientSurface<
  ReturnType<typeof createClaudeRuntime>
>;

export function createClaudeClient(
  input: CreateClaudeClientInput
): Promise<ClaudeClient> {
  return createClientSurface(input, createClaudeRuntime);
}
