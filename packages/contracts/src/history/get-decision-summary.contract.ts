import type { ContextPacket } from "@multi-agent-brain/domain";
import type { ActorContext } from "../common/actor-context.js";
import type { ContextBudget } from "../common/context-budget.js";

export interface GetDecisionSummaryRequest {
  actor: ActorContext;
  topic: string;
  budget: ContextBudget;
}

export interface GetDecisionSummaryResponse {
  decisionPacket: ContextPacket;
}
