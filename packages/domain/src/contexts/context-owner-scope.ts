export const CONTEXT_OWNER_SCOPES = [
  "mimisbrunnr",
  "general_notes",
  "imports",
  "sessions",
  "system"
] as const;

export type ContextOwnerScope = (typeof CONTEXT_OWNER_SCOPES)[number];
