import type {
  PaidExecutionTelemetry,
  CodingAdvisoryResult,
  ExecuteCodingTaskRequest,
  ExecuteCodingTaskResponse
} from "@mimir/contracts";

export interface CodingAdvisoryProvider {
  readonly providerId: string;
  adviseOnEscalation(input: {
    request: ExecuteCodingTaskRequest;
    localResponse: ExecuteCodingTaskResponse;
  }): Promise<CodingAdvisoryResult>;
  consumePaidExecutionTelemetry?(): PaidExecutionTelemetry | undefined;
}
