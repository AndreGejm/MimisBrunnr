import type { LocalAgentTraceRecord } from "@multi-agent-brain/domain";
import type { ActorContext } from "../common/actor-context.js";

export interface ListAgentTracesRequest {
  actor: ActorContext;
  requestId: string;
}

export interface ListAgentTracesResponse {
  traces: LocalAgentTraceRecord[];
}
