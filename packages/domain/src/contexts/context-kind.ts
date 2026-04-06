export const CONTEXT_KINDS = [
  "directory",
  "note",
  "resource",
  "instruction",
  "skill_artifact",
  "session_archive",
  "extraction_draft"
] as const;

export type ContextKind = (typeof CONTEXT_KINDS)[number];
