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

export interface ReadContextNodeRequest {
  uri: string;
}

export interface ReadContextNodeResponse {
  node: ContextNode;
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

  async readNode(
    input: ReadContextNodeRequest
  ): Promise<ServiceResult<ReadContextNodeResponse, "not_found">> {
    const node = await this.namespaceStore.getNodeByUri(input.uri);
    if (!node) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `Context node '${input.uri}' was not found.`
        }
      };
    }

    return {
      ok: true,
      data: {
        node
      }
    };
  }
}
