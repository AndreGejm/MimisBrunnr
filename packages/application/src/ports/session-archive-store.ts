import type { SearchSessionArchivesResponse } from "@mimir/contracts";
import type {
  SessionArchive,
  SessionArchiveMessage
} from "@mimir/domain";

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
