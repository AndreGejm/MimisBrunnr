import type { ActorRole } from "../common/actor-context.js";

export type RuntimeCommandDomain = "mimisbrunnr" | "coding";

export type RuntimeTaskFamily =
  | "mimisbrunnr_retrieval"
  | "mimisbrunnr_context_packet"
  | "mimisbrunnr_memory_update"
  | "mimisbrunnr_review"
  | "mimisbrunnr_validation"
  | "mimisbrunnr_history"
  | "coding";

type RuntimeCommandDefinitionShape = {
  name: string;
  cliName: string;
  domain: RuntimeCommandDomain;
  family: RuntimeTaskFamily;
  defaultActorRole: ActorRole;
};

export const RUNTIME_COMMAND_DEFINITIONS = [
  { name: "execute_coding_task", cliName: "execute-coding-task", domain: "coding", family: "coding", defaultActorRole: "operator" },
  { name: "list_agent_traces", cliName: "list-agent-traces", domain: "coding", family: "coding", defaultActorRole: "operator" },
  { name: "show_tool_output", cliName: "show-tool-output", domain: "coding", family: "coding", defaultActorRole: "operator" },
  { name: "list_ai_tools", cliName: "list-ai-tools", domain: "coding", family: "coding", defaultActorRole: "operator" },
  { name: "check_ai_tools", cliName: "check-ai-tools", domain: "coding", family: "coding", defaultActorRole: "operator" },
  { name: "tools_package_plan", cliName: "tools-package-plan", domain: "coding", family: "coding", defaultActorRole: "operator" },
  { name: "search_context", cliName: "search-context", domain: "mimisbrunnr", family: "mimisbrunnr_retrieval", defaultActorRole: "retrieval" },
  { name: "search_session_archives", cliName: "search-session-archives", domain: "mimisbrunnr", family: "mimisbrunnr_retrieval", defaultActorRole: "retrieval" },
  { name: "assemble_agent_context", cliName: "assemble-agent-context", domain: "mimisbrunnr", family: "mimisbrunnr_context_packet", defaultActorRole: "retrieval" },
  { name: "list_context_tree", cliName: "list-context-tree", domain: "mimisbrunnr", family: "mimisbrunnr_retrieval", defaultActorRole: "retrieval" },
  { name: "read_context_node", cliName: "read-context-node", domain: "mimisbrunnr", family: "mimisbrunnr_retrieval", defaultActorRole: "retrieval" },
  { name: "get_context_packet", cliName: "get-context-packet", domain: "mimisbrunnr", family: "mimisbrunnr_context_packet", defaultActorRole: "retrieval" },
  { name: "fetch_decision_summary", cliName: "fetch-decision-summary", domain: "mimisbrunnr", family: "mimisbrunnr_context_packet", defaultActorRole: "retrieval" },
  { name: "draft_note", cliName: "draft-note", domain: "mimisbrunnr", family: "mimisbrunnr_memory_update", defaultActorRole: "writer" },
  { name: "list_review_queue", cliName: "list-review-queue", domain: "mimisbrunnr", family: "mimisbrunnr_review", defaultActorRole: "operator" },
  { name: "read_review_note", cliName: "read-review-note", domain: "mimisbrunnr", family: "mimisbrunnr_review", defaultActorRole: "operator" },
  { name: "accept_note", cliName: "accept-note", domain: "mimisbrunnr", family: "mimisbrunnr_review", defaultActorRole: "operator" },
  { name: "reject_note", cliName: "reject-note", domain: "mimisbrunnr", family: "mimisbrunnr_review", defaultActorRole: "operator" },
  { name: "create_refresh_draft", cliName: "create-refresh-draft", domain: "mimisbrunnr", family: "mimisbrunnr_memory_update", defaultActorRole: "operator" },
  { name: "create_refresh_drafts", cliName: "create-refresh-drafts", domain: "mimisbrunnr", family: "mimisbrunnr_memory_update", defaultActorRole: "operator" },
  { name: "validate_note", cliName: "validate-note", domain: "mimisbrunnr", family: "mimisbrunnr_validation", defaultActorRole: "orchestrator" },
  { name: "promote_note", cliName: "promote-note", domain: "mimisbrunnr", family: "mimisbrunnr_memory_update", defaultActorRole: "orchestrator" },
  { name: "import_resource", cliName: "import-resource", domain: "mimisbrunnr", family: "mimisbrunnr_memory_update", defaultActorRole: "operator" },
  { name: "query_history", cliName: "query-history", domain: "mimisbrunnr", family: "mimisbrunnr_history", defaultActorRole: "operator" },
  { name: "create_session_archive", cliName: "create-session-archive", domain: "mimisbrunnr", family: "mimisbrunnr_memory_update", defaultActorRole: "operator" }
] as const satisfies ReadonlyArray<RuntimeCommandDefinitionShape>;

export type RuntimeCommandDefinition = typeof RUNTIME_COMMAND_DEFINITIONS[number];
export type RuntimeCommandName = RuntimeCommandDefinition["name"];
export type RuntimeCliCommandName = RuntimeCommandDefinition["cliName"];
export type CodingCommandName = Extract<RuntimeCommandDefinition, { domain: "coding" }>["name"];
export type MimisbrunnrCommandName = Extract<RuntimeCommandDefinition, { domain: "mimisbrunnr" }>["name"];

export const RUNTIME_COMMAND_NAMES: RuntimeCommandName[] = RUNTIME_COMMAND_DEFINITIONS.map((command) => command.name);
export const CLI_RUNTIME_COMMAND_NAMES: RuntimeCliCommandName[] = RUNTIME_COMMAND_DEFINITIONS.map((command) => command.cliName);

const RUNTIME_COMMAND_BY_NAME = new Map<string, RuntimeCommandDefinition>();

for (const command of RUNTIME_COMMAND_DEFINITIONS) {
  RUNTIME_COMMAND_BY_NAME.set(command.name, command);
  RUNTIME_COMMAND_BY_NAME.set(command.cliName, command);
}

export function getRuntimeCommandDefinition(commandName: string): RuntimeCommandDefinition | undefined {
  return RUNTIME_COMMAND_BY_NAME.get(commandName);
}

export function toRuntimeCommandName(commandName: string): RuntimeCommandName | undefined {
  return getRuntimeCommandDefinition(commandName)?.name;
}

export function toCliCommandName(commandName: string): RuntimeCliCommandName | undefined {
  return getRuntimeCommandDefinition(commandName)?.cliName;
}
