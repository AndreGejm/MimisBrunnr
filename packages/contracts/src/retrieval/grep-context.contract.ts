import type {
  ContextAuthorityState,
  ContextOwnerScope
} from "@multi-agent-brain/domain";
import type { ActorContext } from "../common/actor-context.js";
import type { ContextNodeDescriptor } from "../common/context-node-descriptor.js";

export interface GrepContextRequest {
  actor: ActorContext;
  pattern: string;
  ownerScope?: ContextOwnerScope;
  authorityStates?: ContextAuthorityState[];
}

export interface GrepContextResponse {
  nodes: ContextNodeDescriptor[];
}
