import type { ContextRepresentationLayer } from "@multi-agent-brain/domain";

export interface ContextRepresentationRef {
  nodeUri: string;
  representationLayer: ContextRepresentationLayer;
  representationUri: string;
  available: boolean;
  selected: boolean;
}
