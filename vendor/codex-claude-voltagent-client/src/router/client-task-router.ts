export interface ClientTaskRouteInput {
  needsDurableMemory?: boolean;
  needsLocalExecution?: boolean;
  needsWorkspaceSkill?: boolean;
  needsGovernedWrite?: boolean;
}

export type ClientTaskRoute =
  | "mimir-memory-write"
  | "mimir-local-execution"
  | "mimir-retrieval"
  | "client-skill"
  | "client-paid-runtime";

export function classifyTaskRoute(input: ClientTaskRouteInput): ClientTaskRoute {
  if (input.needsGovernedWrite) {
    return "mimir-memory-write";
  }

  if (input.needsLocalExecution) {
    return "mimir-local-execution";
  }

  if (input.needsDurableMemory) {
    return "mimir-retrieval";
  }

  if (input.needsWorkspaceSkill) {
    return "client-skill";
  }

  return "client-paid-runtime";
}
