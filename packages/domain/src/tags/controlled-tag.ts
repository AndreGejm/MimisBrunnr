export type TagNamespace =
  | "domain"
  | "artifact"
  | "risk"
  | "project"
  | "topic"
  | "status";

export type ControlledTag = `${TagNamespace}/${string}`;
