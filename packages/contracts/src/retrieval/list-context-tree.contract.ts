import type {
  ContextAuthorityState,
  ContextOwnerScope
} from "@multi-agent-brain/domain";
import type { ActorContext } from "../common/actor-context.js";
import type { ContextNodeDescriptor } from "../common/context-node-descriptor.js";

export interface ListContextTreeRequest {
  actor: ActorContext;
  ownerScope?: ContextOwnerScope;
  authorityStates?: ContextAuthorityState[];
  parentUri?: string;
}

export interface ListContextTreeResponse {
  nodes: ContextNodeDescriptor[];
}
