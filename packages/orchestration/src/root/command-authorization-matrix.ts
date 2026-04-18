import type { ActorRole } from "@mimir/contracts";
import type { OrchestratorCommand } from "../routing/task-family-router.js";
import type { AdministrativeAction } from "./administrative-action.js";

export const COMMAND_ROLE_POLICY: Record<OrchestratorCommand, ReadonlySet<ActorRole>> = {
  execute_coding_task: new Set(["operator", "system"]),
  list_agent_traces: new Set(["operator", "orchestrator", "system"]),
  show_tool_output: new Set(["operator", "system"]),
  list_ai_tools: new Set(["operator", "system"]),
  check_ai_tools: new Set(["operator", "system"]),
  tools_package_plan: new Set(["operator", "system"]),
  search_context: new Set(["retrieval", "operator", "orchestrator", "system"]),
  search_session_archives: new Set(["retrieval", "operator", "orchestrator", "system"]),
  assemble_agent_context: new Set(["retrieval", "operator", "orchestrator", "system"]),
  list_context_tree: new Set(["retrieval", "operator", "orchestrator", "system"]),
  read_context_node: new Set(["retrieval", "operator", "orchestrator", "system"]),
  get_context_packet: new Set(["retrieval", "operator", "orchestrator", "system"]),
  fetch_decision_summary: new Set(["retrieval", "operator", "orchestrator", "system"]),
  draft_note: new Set(["writer", "operator", "orchestrator", "system"]),
  list_review_queue: new Set(["operator", "orchestrator", "system"]),
  read_review_note: new Set(["operator", "orchestrator", "system"]),
  accept_note: new Set(["operator", "orchestrator", "system"]),
  reject_note: new Set(["operator", "orchestrator", "system"]),
  create_session_archive: new Set(["operator", "system"]),
  create_refresh_draft: new Set(["operator", "orchestrator", "system"]),
  create_refresh_drafts: new Set(["operator", "orchestrator", "system"]),
  import_resource: new Set(["operator", "orchestrator", "system"]),
  validate_note: new Set(["operator", "orchestrator", "system"]),
  promote_note: new Set(["operator", "orchestrator", "system"]),
  query_history: new Set(["operator", "orchestrator", "system"])
};

export const ADMIN_ACTION_ROLE_POLICY: Record<AdministrativeAction, ReadonlySet<ActorRole>> = {
  view_auth_status: new Set(["operator", "system"]),
  view_auth_issuers: new Set(["operator", "system"]),
  view_issued_tokens: new Set(["operator", "system"]),
  manage_auth_issuers: new Set(["operator", "system"]),
  issue_auth_token: new Set(["operator", "system"]),
  inspect_auth_token: new Set(["operator", "system"]),
  revoke_auth_token: new Set(["operator", "system"]),
  revoke_auth_tokens: new Set(["operator", "system"]),
  view_freshness_status: new Set(["operator", "orchestrator", "system"])
};

export function getCommandAuthorizationRoles(command: OrchestratorCommand): ActorRole[] {
  return [...COMMAND_ROLE_POLICY[command]];
}

export function getAdministrativeActionAuthorizationRoles(
  administrativeAction: AdministrativeAction
): ActorRole[] {
  return [...ADMIN_ACTION_ROLE_POLICY[administrativeAction]];
}

export function isCommandRoleAuthorized(
  command: OrchestratorCommand,
  actorRole: ActorRole
): boolean {
  return COMMAND_ROLE_POLICY[command].has(actorRole);
}

export function isAdministrativeActionRoleAuthorized(
  administrativeAction: AdministrativeAction,
  actorRole: ActorRole
): boolean {
  return ADMIN_ACTION_ROLE_POLICY[administrativeAction].has(actorRole);
}
