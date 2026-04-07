import type { ActorContext } from "../common/actor-context.js";
import type { ContextNodeDescriptor } from "../common/context-node-descriptor.js";

export interface ReadContextNodeRequest {
  actor: ActorContext;
  uri: string;
}

export interface ReadContextNodeResponse {
  node: ContextNodeDescriptor;
}
