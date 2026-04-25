import type { CreateCodexRuntimeInput } from "./create-codex-runtime.js";
import { createCodexRuntime } from "./create-codex-runtime.js";
import {
  createClientSurface,
  type ClientSurface,
  type CreateClientSurfaceInput
} from "./create-client-surface.js";

export interface CreateCodexClientInput
  extends Omit<CreateClientSurfaceInput, keyof CreateCodexRuntimeInput>,
    Pick<
      CreateCodexRuntimeInput,
      "hooks" | "workspaceSkillsPrompt" | "workflowMemoryAuthority"
    > {}

export type CodexClient = ClientSurface<
  ReturnType<typeof createCodexRuntime>
>;

export function createCodexClient(
  input: CreateCodexClientInput
): Promise<CodexClient> {
  return createClientSurface(input, createCodexRuntime);
}
