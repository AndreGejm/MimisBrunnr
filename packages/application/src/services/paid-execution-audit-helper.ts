import type { PaidExecutionTelemetry } from "@mimir/contracts";

export function buildPaidExecutionAuditDetail(
  telemetry: PaidExecutionTelemetry | undefined
): Record<string, unknown> | undefined {
  if (!telemetry) {
    return undefined;
  }

  return {
    providerId: telemetry.providerId,
    modelId: telemetry.modelId,
    timeoutMs: telemetry.timeoutMs,
    outcomeClass: telemetry.outcomeClass,
    fallbackApplied: telemetry.fallbackApplied,
    retryCount: telemetry.retryCount,
    errorCode: telemetry.errorCode
  };
}
