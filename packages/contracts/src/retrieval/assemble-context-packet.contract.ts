import type {
  ContextPacket,
  ControlledTag,
  NoteType,
  QueryIntent
} from "@multi-agent-brain/domain";
import type { ActorContext } from "../common/actor-context.js";
import type { ContextBudget } from "../common/context-budget.js";
import type { ProvenanceRef } from "../common/provenance-ref.js";

export interface ContextCandidate {
  noteType: NoteType;
  score: number;
  summary: string;
  rawText?: string;
  scope: string;
  qualifiers: string[];
  tags: ControlledTag[];
  stalenessClass: "current" | "stale" | "superseded";
  validFrom?: string;
  validUntil?: string;
  provenance: ProvenanceRef;
}

export interface AssembleContextPacketRequest {
  actor: ActorContext;
  intent: QueryIntent;
  budget: ContextBudget;
  candidates: ContextCandidate[];
  includeRawExcerpts: boolean;
}

export interface AssembleContextPacketResponse {
  packet: ContextPacket;
}
