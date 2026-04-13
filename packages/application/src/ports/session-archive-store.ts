import type { SearchSessionArchivesResponse } from "@multi-agent-brain/contracts";
import type {
  SessionArchive,
  SessionArchiveMessage
} from "@multi-agent-brain/domain";

export interface SessionArchiveSearchQuery {
  query: string;
  sessionId?: string;
  limit: number;
  maxTokens: number;
}

export interface StoredSessionArchive {
  archive: SessionArchive;
  messages: SessionArchiveMessage[];
}

export interface SessionArchiveStore {
  createArchive(record: StoredSessionArchive): Promise<void>;

  getArchiveById(archiveId: string): Promise<StoredSessionArchive | undefined>;

  searchArchives(query: SessionArchiveSearchQuery): Promise<SearchSessionArchivesResponse>;
}
