import {
  Agent,
  type AgentHooks,
  type WorkspaceSkillsPromptOptions
} from "@voltagent/core";
import { createClientWorkspace } from "./create-client-workspace.js";
import { buildWorkspaceSkillPolicy } from "./workspace-skill-policy.js";

export interface CreateClientVoltAgentRuntimeInput {
  model: string;
  skillRootPaths: string[];
  hooks?: AgentHooks;
  workspaceSkillsPrompt?: WorkspaceSkillsPromptOptions | boolean;
}

function composePrepareMessagesHooks(
  hooks: Array<AgentHooks["onPrepareMessages"] | undefined>
): AgentHooks["onPrepareMessages"] | undefined {
  const sequence = hooks.filter(
    (hook): hook is NonNullable<AgentHooks["onPrepareMessages"]> => Boolean(hook)
  );

  if (sequence.length === 0) {
    return undefined;
  }

  return async (args) => {
    let currentMessages = args.messages;

    for (const hook of sequence) {
      const result = await hook({
        ...args,
        messages: currentMessages
      });

      if (result?.messages) {
        currentMessages = result.messages;
      }
    }

    return {
      messages: currentMessages
    };
  };
}

export function createClientVoltAgentRuntime(
  input: CreateClientVoltAgentRuntimeInput
) {
  const workspace = createClientWorkspace(input.skillRootPaths);
  const {
    explicitWorkspaceSkillsPromptHook,
    workspaceSkillsPrompt
  } = buildWorkspaceSkillPolicy({
    hasCustomOnPrepareMessages: Boolean(input.hooks?.onPrepareMessages),
    workspaceSkillsPrompt: input.workspaceSkillsPrompt
  });
  const workspaceSkillsPromptHook =
    explicitWorkspaceSkillsPromptHook === undefined
      ? undefined
      : explicitWorkspaceSkillsPromptHook === true
        ? workspace.createSkillsPromptHook().onPrepareMessages
        : workspace.createSkillsPromptHook(
            explicitWorkspaceSkillsPromptHook
          ).onPrepareMessages;

  const agent = new Agent({
    name: "client-primary",
    instructions: "Use local workspace skills when they help complete the task.",
    model: input.model,
    workspace,
    hooks: {
      ...input.hooks,
      onPrepareMessages: composePrepareMessagesHooks([
        input.hooks?.onPrepareMessages,
        workspaceSkillsPromptHook
      ])
    },
    workspaceSkillsPrompt
  });

  return {
    workspace,
    agent
  };
}
