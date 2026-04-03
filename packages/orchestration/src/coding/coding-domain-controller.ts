import type { AuditHistoryService } from "@multi-agent-brain/application";
import type {
  ExecuteCodingTaskRequest,
  ExecuteCodingTaskResponse
} from "@multi-agent-brain/contracts";
import type { CodingControllerBridge } from "./coding-controller-bridge.js";

export class CodingDomainController {
  constructor(
    private readonly bridge: CodingControllerBridge,
    private readonly auditHistoryService?: AuditHistoryService
  ) {}

  async executeTask(
    request: ExecuteCodingTaskRequest
  ): Promise<ExecuteCodingTaskResponse> {
    const result = await this.bridge.executeTask(request);

    await this.auditHistoryService?.recordAction({
      actionType: "execute_coding_task",
      actorId: request.actor.actorId,
      actorRole: request.actor.actorRole,
      source: request.actor.source,
      toolName: request.actor.toolName,
      occurredAt: new Date().toISOString(),
      outcome:
        result.status === "success"
          ? "accepted"
          : result.status === "fail"
            ? "rejected"
            : "partial",
      affectedNoteIds: [],
      affectedChunkIds: [],
      detail: {
        taskType: request.taskType,
        reason: result.reason,
        toolUsed: result.toolUsed,
        attempts: result.attempts,
        escalationMetadata: result.escalationMetadata
      }
    });

    return result;
  }
}
