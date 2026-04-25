import {
  createClientVoltAgentRuntime,
  type CreateClientVoltAgentRuntimeInput
} from "../runtime/client-voltagent-runtime.js";
import {
  assertWorkflowMemoryBoundary,
  type WorkflowMemoryAuthority
} from "../runtime/workflow-policy.js";

export type CreateClaudeRuntimeInput = CreateClientVoltAgentRuntimeInput & {
  workflowMemoryAuthority?: WorkflowMemoryAuthority;
};

export function createClaudeRuntime(input: CreateClaudeRuntimeInput) {
  const {
    workflowMemoryAuthority = "client-operational",
    ...runtimeInput
  } = input;

  assertWorkflowMemoryBoundary({
    workflowMemoryAuthority
  });

  return createClientVoltAgentRuntime(runtimeInput);
}
