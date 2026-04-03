import type {
  ExecuteCodingTaskRequest,
  ExecuteCodingTaskResponse
} from "@multi-agent-brain/contracts";

export interface CodingControllerBridge {
  executeTask(request: ExecuteCodingTaskRequest): Promise<ExecuteCodingTaskResponse>;
}

export class UnavailableCodingControllerBridge implements CodingControllerBridge {
  constructor(
    private readonly reason = "Coding controller bridge is not configured in this runtime."
  ) {}

  async executeTask(
    request: ExecuteCodingTaskRequest
  ): Promise<ExecuteCodingTaskResponse> {
    return {
      status: "escalate",
      reason: this.reason,
      attempts: 0,
      escalationMetadata: {
        taskType: request.taskType
      }
    };
  }
}
