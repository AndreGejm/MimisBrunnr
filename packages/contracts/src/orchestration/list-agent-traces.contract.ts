import type { LocalAgentTraceRecord } from "@mimir/domain";
import type { ActorContext } from "../common/actor-context.js";

export interface ListAgentTracesRequest {
  actor: ActorContext;
  requestId: string;
}

export interface ListAgentTracesResponse {
  traces: LocalAgentTraceRecord[];
}
