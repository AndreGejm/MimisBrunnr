export const IMPORT_ARTIFACT_STATES = ["imported"] as const;

export type ImportArtifactState = (typeof IMPORT_ARTIFACT_STATES)[number];
