export const ADMINISTRATIVE_ACTIONS = [
  "view_auth_status",
  "view_issued_tokens",
  "issue_auth_token",
  "inspect_auth_token",
  "revoke_auth_token",
  "view_freshness_status"
] as const;

export type AdministrativeAction = (typeof ADMINISTRATIVE_ACTIONS)[number];
