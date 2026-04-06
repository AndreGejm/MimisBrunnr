import type { ServiceResult } from "@multi-agent-brain/contracts";
import type {
  ContextAuthorityState,
  ContextNode,
  ContextOwnerScope
} from "@multi-agent-brain/domain";
import type { ContextNamespaceStore } from "../ports/context-namespace-store.js";

export interface ListContextTreeRequest {
  ownerScope?: ContextOwnerScope;
  authorityStates?: ContextAuthorityState[];
  parentUri?: string;
}

export interface ListContextTreeResponse {
  nodes: ContextNode[];
}

export class ContextNamespaceService {
  constructor(private readonly namespaceStore: ContextNamespaceStore) {}

  async listTree(
    input: ListContextTreeRequest
  ): Promise<ServiceResult<ListContextTreeResponse, "forbidden">> {
    const nodes = await this.namespaceStore.listNodes({
      ownerScope: input.ownerScope,
      authorityStates: input.authorityStates,
      parentUri: input.parentUri
    });

    return {
      ok: true,
      data: {
        nodes
      }
    };
  }
}
