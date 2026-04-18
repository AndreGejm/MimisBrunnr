export const ADMINISTRATIVE_ACTIONS = [
  "view_auth_status",
  "view_auth_issuers",
  "view_issued_tokens",
  "manage_auth_issuers",
  "issue_auth_token",
  "inspect_auth_token",
  "revoke_auth_token",
  "revoke_auth_tokens",
  "view_freshness_status"
] as const;

export type AdministrativeAction = (typeof ADMINISTRATIVE_ACTIONS)[number];
