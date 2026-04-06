export const CONTEXT_OWNER_SCOPES = [
  "context_brain",
  "general_notes",
  "imports",
  "sessions",
  "system"
] as const;

export type ContextOwnerScope = (typeof CONTEXT_OWNER_SCOPES)[number];
