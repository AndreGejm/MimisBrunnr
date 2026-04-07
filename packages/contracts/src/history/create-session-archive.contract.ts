import type {
  SessionArchive,
  SessionArchiveMessage
} from "@multi-agent-brain/domain";
import type { ActorContext } from "../common/actor-context.js";

export interface CreateSessionArchiveRequest {
  actor: ActorContext;
  sessionId: string;
  messages: SessionArchiveMessage[];
}

export interface CreateSessionArchiveResponse {
  archive: SessionArchive;
}
