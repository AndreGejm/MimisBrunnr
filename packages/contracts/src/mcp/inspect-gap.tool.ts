import type { ContextPacket } from "@mimir/domain";
import type { ActorContext } from "../common/actor-context.js";
import type { ContextBudget } from "../common/context-budget.js";

export interface InspectGapToolRequest {
  actor: ActorContext;
  gapId?: string;
  topic?: string;
  budget: ContextBudget;
  includeRawExcerpts?: boolean;
  maxRelatedNotes?: number;
}

export interface InspectGapToolResponse {
  gapPacket: ContextPacket;
  gapType?: "missing" | "partial" | "conflicting_design";
  severity?: "low" | "medium" | "high" | "critical";
  relatedNotePaths: string[];
}
