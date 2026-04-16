import {
  RUNTIME_COMMAND_DEFINITIONS,
  type CodingCommandName,
  type MimisbrunnrCommandName,
  type RuntimeCommandDomain,
  type RuntimeCommandName,
  type RuntimeTaskFamily
} from "@mimir/contracts";

export type MimisbrunnrCommand = MimisbrunnrCommandName;
export type CodingCommand = CodingCommandName;
export type OrchestratorCommand = RuntimeCommandName;
export type TaskFamily = RuntimeTaskFamily;

export interface RoutedTask {
  command: OrchestratorCommand;
  domain: RuntimeCommandDomain;
  family: TaskFamily;
}

const ROUTE_TABLE = new Map<OrchestratorCommand, RoutedTask>(
  RUNTIME_COMMAND_DEFINITIONS.map((command) => [
    command.name,
    {
      command: command.name,
      domain: command.domain,
      family: command.family
    }
  ] as const)
);

export class TaskFamilyRouter {
  route(command: OrchestratorCommand): RoutedTask {
    const route = ROUTE_TABLE.get(command);
    if (!route) {
      throw new Error(`Command '${command}' is not registered in the runtime command catalog.`);
    }
    return route;
  }
}