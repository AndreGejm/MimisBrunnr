import type { StoredToolOutput } from "@multi-agent-brain/domain";
import type { ActorContext } from "../common/actor-context.js";

export interface ShowToolOutputRequest {
  actor: ActorContext;
  outputId: string;
}

export interface ShowToolOutputResponse {
  found: boolean;
  output?: StoredToolOutput;
}
