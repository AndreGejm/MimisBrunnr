import type {
  ContextAuthorityState,
  ContextNode,
  ContextOwnerScope
} from "@mimir/domain";

export interface ContextNamespaceStore {
  listNodes(input: {
    ownerScope?: ContextOwnerScope;
    authorityStates?: ContextAuthorityState[];
  }): Promise<ContextNode[]>;

  getNodeByUri(uri: string): Promise<ContextNode | undefined>;
}
