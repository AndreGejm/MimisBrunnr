export type WorkflowMemoryAuthority =
  | "client-operational"
  | "durable-governed";

export interface AssertWorkflowMemoryBoundaryInput {
  workflowMemoryAuthority: WorkflowMemoryAuthority;
}

export function assertWorkflowMemoryBoundary(
  input: AssertWorkflowMemoryBoundaryInput
): void {
  if (input.workflowMemoryAuthority === "client-operational") {
    return;
  }

  throw new Error(
    "Workflow memory boundary violation: VoltAgent workflow memory must remain client-operational and cannot be treated as durable-governed memory."
  );
}
