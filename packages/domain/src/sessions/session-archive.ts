export const SESSION_ARCHIVE_MESSAGE_ROLES = [
  "system",
  "user",
  "assistant",
  "tool"
] as const;

export type SessionArchiveMessageRole =
  (typeof SESSION_ARCHIVE_MESSAGE_ROLES)[number];

export interface SessionArchiveMessage {
  role: SessionArchiveMessageRole;
  content: string;
}

export interface SessionArchive {
  archiveId: string;
  sessionId: string;
  uri: string;
  authorityState: "session";
  promotionStatus: "not_applicable";
  messageCount: number;
  createdAt: string;
}
