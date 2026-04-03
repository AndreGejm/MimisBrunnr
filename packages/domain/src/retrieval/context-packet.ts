import type { ChunkId } from "../chunks/chunk-id.js";
import type { NoteId } from "../notes/note-id.js";

export type QueryIntent =
  | "fact_lookup"
  | "decision_lookup"
  | "implementation_guidance"
  | "status_timeline"
  | "debugging"
  | "architecture_recall";

export type AnswerConfidence = "low" | "medium" | "high";
export type PacketType =
  | "direct_answer"
  | "decision"
  | "implementation"
  | "timeline_status";
export type AnswerabilityDisposition =
  | "local_answer"
  | "partial"
  | "needs_escalation";

export interface ContextPacketSource {
  noteId: NoteId;
  chunkId?: ChunkId;
  notePath: string;
  headingPath: string[];
}

export interface ContextPacketBudgetUsage {
  tokenEstimate: number;
  sourceCount: number;
  rawExcerptCount: number;
}

export interface ContextPacket {
  packetType: PacketType;
  intent: QueryIntent;
  confidence: AnswerConfidence;
  answerability: AnswerabilityDisposition;
  summary: string;
  constraints: string[];
  evidence: ContextPacketSource[];
  rawExcerpts?: string[];
  uncertainties: string[];
  budgetUsage: ContextPacketBudgetUsage;
}
