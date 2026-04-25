import type { WorkspaceSkillsPromptOptions } from "@voltagent/core";

export interface WorkspaceSkillPolicyInput {
  hasCustomOnPrepareMessages: boolean;
  workspaceSkillsPrompt?: WorkspaceSkillsPromptOptions | boolean;
}

export interface WorkspaceSkillPolicy {
  workspaceSkillsPrompt?: WorkspaceSkillsPromptOptions | boolean;
  explicitWorkspaceSkillsPromptHook?: WorkspaceSkillsPromptOptions | true;
}

export function buildWorkspaceSkillPolicy(
  input: WorkspaceSkillPolicyInput
): WorkspaceSkillPolicy {
  if (!input.hasCustomOnPrepareMessages) {
    return {
      workspaceSkillsPrompt: input.workspaceSkillsPrompt
    };
  }

  if (input.workspaceSkillsPrompt === false) {
    return {
      workspaceSkillsPrompt: false
    };
  }

  return {
    workspaceSkillsPrompt: false,
    explicitWorkspaceSkillsPromptHook: input.workspaceSkillsPrompt ?? true
  };
}
