export type PaidExecutionOutcomeClass =
  | "success"
  | "disabled"
  | "unavailable"
  | "timeout"
  | "unsupported_model"
  | "invalid_configuration"
  | "provider_error"
  | "degraded_fallback";

export interface PaidExecutionTelemetry {
  providerId: string;
  modelId?: string;
  timeoutMs: number;
  outcomeClass: PaidExecutionOutcomeClass;
  fallbackApplied: boolean;
  retryCount: number;
  errorCode?: string;
}
