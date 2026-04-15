import type {
  ContextAuthorityState,
  ContextOwnerScope
} from "@mimir/domain";
import type { ActorContext } from "../common/actor-context.js";
import type { ContextNodeDescriptor } from "../common/context-node-descriptor.js";

export interface GlobContextRequest {
  actor: ActorContext;
  pattern: string;
  ownerScope?: ContextOwnerScope;
  authorityStates?: ContextAuthorityState[];
}

export interface GlobContextResponse {
  nodes: ContextNodeDescriptor[];
}
