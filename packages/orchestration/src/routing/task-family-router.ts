export type BrainCommand =
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

export type OrchestratorCommand = BrainCommand | CodingCommand;

export type TaskFamily =
  | "brain_retrieval"
  | "brain_context_packet"
  | "brain_memory_update"
  | "brain_validation"
  | "brain_history"
  | "coding";

export interface RoutedTask {
  command: OrchestratorCommand;
  domain: "brain" | "coding";
  family: TaskFamily;
}

const ROUTE_TABLE: Record<OrchestratorCommand, RoutedTask> = {
  search_context: {
    command: "search_context",
    domain: "brain",
    family: "brain_retrieval"
  },
  search_session_archives: {
    command: "search_session_archives",
    domain: "brain",
    family: "brain_retrieval"
  },
  assemble_agent_context: {
    command: "assemble_agent_context",
    domain: "brain",
    family: "brain_context_packet"
  },
  get_context_packet: {
    command: "get_context_packet",
    domain: "brain",
    family: "brain_context_packet"
  },
  fetch_decision_summary: {
    command: "fetch_decision_summary",
    domain: "brain",
    family: "brain_context_packet"
  },
  draft_note: {
    command: "draft_note",
    domain: "brain",
    family: "brain_memory_update"
  },
  create_session_archive: {
    command: "create_session_archive",
    domain: "brain",
    family: "brain_memory_update"
  },
  create_refresh_draft: {
    command: "create_refresh_draft",
    domain: "brain",
    family: "brain_memory_update"
  },
  create_refresh_drafts: {
    command: "create_refresh_drafts",
    domain: "brain",
    family: "brain_memory_update"
  },
  import_resource: {
    command: "import_resource",
    domain: "brain",
    family: "brain_memory_update"
  },
  validate_note: {
    command: "validate_note",
    domain: "brain",
    family: "brain_validation"
  },
  promote_note: {
    command: "promote_note",
    domain: "brain",
    family: "brain_memory_update"
  },
  query_history: {
    command: "query_history",
    domain: "brain",
    family: "brain_history"
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
