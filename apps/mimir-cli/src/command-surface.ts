import {
  CLI_RUNTIME_COMMAND_NAMES,
  RUNTIME_COMMAND_DEFINITIONS,
  type ActorRole,
  type RuntimeCliCommandName
} from "@mimir/contracts";

export type SystemCommandName =
  | "version"
  | "auth-issuers"
  | "auth-status"
  | "auth-issued-tokens"
  | "auth-introspect-token"
  | "check-mcp-profiles"
  | "deactivate-toolbox"
  | "describe-toolbox"
  | "freshness-status"
  | "issue-auth-token"
  | "list-active-toolbox"
  | "list-active-tools"
  | "list-toolboxes"
  | "request-toolbox-activation"
  | "revoke-auth-token"
  | "revoke-auth-tokens"
  | "set-auth-issuer-state"
  | "sync-mcp-profiles";

export type CliCommandName = SystemCommandName | RuntimeCliCommandName;

export interface CliCommandSurfaceDefinition {
  name: CliCommandName;
  kind: "system" | "runtime";
  defaultActorRole?: ActorRole;
}

export const SYSTEM_COMMAND_NAMES = [
  "version",
  "auth-issuers",
  "auth-status",
  "auth-issued-tokens",
  "auth-introspect-token",
  "check-mcp-profiles",
  "deactivate-toolbox",
  "describe-toolbox",
  "freshness-status",
  "issue-auth-token",
  "list-active-toolbox",
  "list-active-tools",
  "list-toolboxes",
  "request-toolbox-activation",
  "revoke-auth-token",
  "revoke-auth-tokens",
  "set-auth-issuer-state",
  "sync-mcp-profiles"
] as const satisfies ReadonlyArray<SystemCommandName>;

export const CLI_COMMAND_NAMES: ReadonlyArray<CliCommandName> = [
  ...SYSTEM_COMMAND_NAMES,
  ...CLI_RUNTIME_COMMAND_NAMES
];

export const CLI_DEFAULT_RUNTIME_ACTOR_ROLE: Record<RuntimeCliCommandName, ActorRole> = (
  Object.fromEntries(
    RUNTIME_COMMAND_DEFINITIONS.map((command) => [
      command.cliName,
      command.defaultActorRole
    ])
  ) as Record<RuntimeCliCommandName, ActorRole>
);

export function getCliCommandSurfaceDefinitions(): ReadonlyArray<CliCommandSurfaceDefinition> {
  return [
    ...SYSTEM_COMMAND_NAMES.map((name) => ({
      name,
      kind: "system" as const
    })),
    ...RUNTIME_COMMAND_DEFINITIONS.map((command) => ({
      name: command.cliName,
      kind: "runtime" as const,
      defaultActorRole: command.defaultActorRole
    }))
  ];
}

export function isSystemCommandName(value: string): value is SystemCommandName {
  return (SYSTEM_COMMAND_NAMES as ReadonlyArray<string>).includes(value);
}

export function isCliCommandName(value: string): value is CliCommandName {
  return (CLI_COMMAND_NAMES as ReadonlyArray<string>).includes(value);
}
