import type {
  SessionArchive,
  SessionArchiveMessage
} from "@multi-agent-brain/domain";

export interface StoredSessionArchive {
  archive: SessionArchive;
  messages: SessionArchiveMessage[];
}

export interface SessionArchiveStore {
  createArchive(record: StoredSessionArchive): Promise<void>;

  getArchiveById(archiveId: string): Promise<StoredSessionArchive | undefined>;
}
