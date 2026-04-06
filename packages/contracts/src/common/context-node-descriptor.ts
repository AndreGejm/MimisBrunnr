import type { ContextNode } from "@multi-agent-brain/domain";
import type { ContextRepresentationRef } from "./context-representation-ref.js";

export interface ContextNodeDescriptor extends ContextNode {
  representations?: ContextRepresentationRef[];
}

export function createContextNodeDescriptor(
  descriptor: ContextNodeDescriptor
): ContextNodeDescriptor {
  return descriptor;
}
