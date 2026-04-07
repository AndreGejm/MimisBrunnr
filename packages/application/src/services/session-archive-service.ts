import { randomUUID } from "node:crypto";
import type {
  CreateSessionArchiveRequest,
  CreateSessionArchiveResponse,
  ServiceResult
} from "@multi-agent-brain/contracts";
import {
  SESSION_ARCHIVE_MESSAGE_ROLES,
  type SessionArchive,
  type SessionArchiveMessage
} from "@multi-agent-brain/domain";
import type {
  SessionArchiveStore,
  StoredSessionArchive
} from "../ports/session-archive-store.js";

type SessionArchiveErrorCode =
  | "not_found"
  | "validation_failed"
  | "write_failed";

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
      uri: `mab://sessions/session_archive/${archiveId}`,
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

function cloneMessages(messages: SessionArchiveMessage[]): SessionArchiveMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
}
