import type { CodingAdvisoryProvider } from "@mimir/application";
import type {
  CodingAdvisoryResult,
  ExecuteCodingTaskRequest,
  ExecuteCodingTaskResponse,
  PaidExecutionTelemetry
} from "@mimir/contracts";

export interface CodingAdvisoryInvocation {
  invoked: boolean;
  advisoryReturned: boolean;
  advisory?: CodingAdvisoryResult;
  telemetry?: PaidExecutionTelemetry;
}

export class CodingAdvisoryService {
  constructor(private readonly provider?: CodingAdvisoryProvider) {}

  async adviseOnEscalation(input: {
    request: ExecuteCodingTaskRequest;
    localResponse: ExecuteCodingTaskResponse;
  }): Promise<CodingAdvisoryInvocation> {
    if (!this.provider || input.localResponse.status !== "escalate") {
      return {
        invoked: false,
        advisoryReturned: false
      };
    }

    try {
      const advisory = await this.provider.adviseOnEscalation(input);
      const telemetry =
        advisory.telemetry ?? this.provider.consumePaidExecutionTelemetry?.();
      return {
        invoked: true,
        advisoryReturned: true,
        advisory: telemetry ? { ...advisory, telemetry } : advisory,
        telemetry: telemetry ?? advisory.telemetry
      };
    } catch (error) {
      const telemetry = this.provider.consumePaidExecutionTelemetry?.();
      if (!telemetry) {
        throw error;
      }

      return {
        invoked: true,
        advisoryReturned: false,
        telemetry
      };
    }
  }
}
