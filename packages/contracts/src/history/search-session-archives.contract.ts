import type { SessionArchiveMessageRole } from "@mimir/domain";
import type { ActorContext } from "../common/actor-context.js";

export interface SearchSessionArchivesRequest {
  actor: ActorContext;
  query: string;
  sessionId?: string;
  limit?: number;
  maxTokens?: number;
}

export interface SessionArchiveSearchHit {
  archiveId: string;
  sessionId: string;
  messageIndex: number;
  role: SessionArchiveMessageRole;
  content: string;
  score: number;
  createdAt: string;
  source: "session_archive";
  authority: "non_authoritative";
  promotionStatus: "not_applicable";
}

export interface SearchSessionArchivesResponse {
  hits: SessionArchiveSearchHit[];
  totalMatches: number;
  truncated: boolean;
  budget: {
    limit: number;
    maxTokens: number;
  };
}
