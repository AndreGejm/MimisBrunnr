export type MimisbrunnrCommand =
  | "search_context"
  | "search_session_archives"
  | "assemble_agent_context"
  | "get_context_packet"
  | "fetch_decision_summary"
  | "draft_note"
  | "create_session_archive"
  | "create_refresh_draft"
  | "create_refresh_drafts"
  | "import_resource"
  | "validate_note"
  | "promote_note"
  | "query_history";

export type CodingCommand =
  | "execute_coding_task"
  | "list_agent_traces"
  | "show_tool_output";

export type OrchestratorCommand = MimisbrunnrCommand | CodingCommand;

export type TaskFamily =
  | "mimisbrunnr_retrieval"
  | "mimisbrunnr_context_packet"
  | "mimisbrunnr_memory_update"
  | "mimisbrunnr_validation"
  | "mimisbrunnr_history"
  | "coding";

export interface RoutedTask {
  command: OrchestratorCommand;
  domain: "mimisbrunnr" | "coding";
  family: TaskFamily;
}

const ROUTE_TABLE: Record<OrchestratorCommand, RoutedTask> = {
  search_context: {
    command: "search_context",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_retrieval"
  },
  search_session_archives: {
    command: "search_session_archives",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_retrieval"
  },
  assemble_agent_context: {
    command: "assemble_agent_context",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_context_packet"
  },
  get_context_packet: {
    command: "get_context_packet",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_context_packet"
  },
  fetch_decision_summary: {
    command: "fetch_decision_summary",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_context_packet"
  },
  draft_note: {
    command: "draft_note",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_memory_update"
  },
  create_session_archive: {
    command: "create_session_archive",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_memory_update"
  },
  create_refresh_draft: {
    command: "create_refresh_draft",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_memory_update"
  },
  create_refresh_drafts: {
    command: "create_refresh_drafts",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_memory_update"
  },
  import_resource: {
    command: "import_resource",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_memory_update"
  },
  validate_note: {
    command: "validate_note",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_validation"
  },
  promote_note: {
    command: "promote_note",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_memory_update"
  },
  query_history: {
    command: "query_history",
    domain: "mimisbrunnr",
    family: "mimisbrunnr_history"
  },
  execute_coding_task: {
    command: "execute_coding_task",
    domain: "coding",
    family: "coding"
  },
  list_agent_traces: {
    command: "list_agent_traces",
    domain: "coding",
    family: "coding"
  },
  show_tool_output: {
    command: "show_tool_output",
    domain: "coding",
    family: "coding"
  }
};

export class TaskFamilyRouter {
  route(command: OrchestratorCommand): RoutedTask {
    return ROUTE_TABLE[command];
  }
}
