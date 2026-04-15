import { randomUUID } from "node:crypto";
import type {
  CreateSessionArchiveRequest,
  CreateSessionArchiveResponse,
  SearchSessionArchivesRequest,
  SearchSessionArchivesResponse,
  ServiceResult
} from "@mimir/contracts";
import {
  SESSION_ARCHIVE_MESSAGE_ROLES,
  type SessionArchive,
  type SessionArchiveMessage
} from "@mimir/domain";
import type {
  SessionArchiveStore,
  StoredSessionArchive
} from "../ports/session-archive-store.js";

type SessionArchiveErrorCode =
  | "not_found"
  | "validation_failed"
  | "read_failed"
  | "write_failed";

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_SEARCH_MAX_TOKENS = 4000;
const MAX_SEARCH_LIMIT = 20;
const MAX_SEARCH_TOKENS = 12000;

export class SessionArchiveService {
  constructor(private readonly archiveStore: SessionArchiveStore) {}

  async createArchive(
    request: CreateSessionArchiveRequest
  ): Promise<ServiceResult<CreateSessionArchiveResponse, SessionArchiveErrorCode>> {
    const validationError = validateCreateArchiveRequest(request);
    if (validationError) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: validationError
        }
      };
    }

    const sessionId = request.sessionId.trim();
    const messages = cloneMessages(request.messages);
    const archiveId = randomUUID();
    const archive: SessionArchive = {
      archiveId,
      sessionId,
      uri: `mimir://sessions/session_archive/${archiveId}`,
      authorityState: "session",
      promotionStatus: "not_applicable",
      messageCount: messages.length,
      createdAt: new Date().toISOString()
    };

    try {
      await this.archiveStore.createArchive({
        archive,
        messages
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: "Failed to persist session archive state.",
          details: {
            reason: error instanceof Error ? error.message : String(error)
          }
        }
      };
    }

    return {
      ok: true,
      data: {
        archive
      }
    };
  }

  async getArchive(
    archiveId: string
  ): Promise<ServiceResult<StoredSessionArchive, SessionArchiveErrorCode>> {
    const record = await this.archiveStore.getArchiveById(archiveId);
    if (!record) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `Session archive '${archiveId}' was not found.`
        }
      };
    }

    return {
      ok: true,
      data: record
    };
  }

  async searchArchives(
    request: SearchSessionArchivesRequest
  ): Promise<ServiceResult<SearchSessionArchivesResponse, SessionArchiveErrorCode>> {
    const validationError = validateSearchArchivesRequest(request);
    if (validationError) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: validationError
        }
      };
    }

    try {
      const limit = clampInteger(
        request.limit,
        DEFAULT_SEARCH_LIMIT,
        1,
        MAX_SEARCH_LIMIT
      );
      const maxTokens = clampInteger(
        request.maxTokens,
        DEFAULT_SEARCH_MAX_TOKENS,
        1,
        MAX_SEARCH_TOKENS
      );
      const result = await this.archiveStore.searchArchives({
        query: request.query.trim(),
        sessionId: request.sessionId?.trim() || undefined,
        limit,
        maxTokens
      });

      return {
        ok: true,
        data: result
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "read_failed",
          message: "Failed to search session archives.",
          details: {
            reason: error instanceof Error ? error.message : String(error)
          }
        }
      };
    }
  }
}

function validateCreateArchiveRequest(
  request: CreateSessionArchiveRequest
): string | undefined {
  if (request.sessionId.trim().length === 0) {
    return "Session archives require a non-empty sessionId.";
  }

  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    return "Session archives require at least one message.";
  }

  for (const [index, message] of request.messages.entries()) {
    if (!SESSION_ARCHIVE_MESSAGE_ROLES.includes(message.role)) {
      return `Session archive message '${index}' must use a supported role.`;
    }

    if (message.content.trim().length === 0) {
      return `Session archive message '${index}' must have non-empty content.`;
    }
  }

  return undefined;
}

function validateSearchArchivesRequest(
  request: SearchSessionArchivesRequest
): string | undefined {
  if (request.query.trim().length === 0) {
    return "Session archive search requires a non-empty query.";
  }

  if (request.sessionId !== undefined && request.sessionId.trim().length === 0) {
    return "Session archive search sessionId must be non-empty when provided.";
  }

  return undefined;
}

function cloneMessages(messages: SessionArchiveMessage[]): SessionArchiveMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
}

function clampInteger(
  value: number | undefined,
  defaultValue: number,
  min: number,
  max: number
): number {
  if (value === undefined) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}
