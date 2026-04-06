export const CONTEXT_REPRESENTATION_LAYERS = ["L0", "L1", "L2"] as const;

export type ContextRepresentationLayer =
  (typeof CONTEXT_REPRESENTATION_LAYERS)[number];
