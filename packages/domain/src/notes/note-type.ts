export type NoteType =
  | "decision"
  | "constraint"
  | "bug"
  | "investigation"
  | "runbook"
  | "architecture"
  | "glossary"
  | "handoff"
  | "reference"
  | "policy";

export const CANONICAL_NOTE_TYPE_PRIORITY: readonly NoteType[] = [
  "decision",
  "constraint",
  "architecture",
  "runbook",
  "bug",
  "investigation",
  "handoff",
  "reference",
  "glossary",
  "policy"
];
