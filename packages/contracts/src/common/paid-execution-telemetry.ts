export type PaidExecutionOutcomeClass =
  | "success"
  | "disabled"
  | "unavailable"
  | "timeout"
  | "unsupported_model"
  | "invalid_configuration"
  | "provider_error"
  | "degraded_fallback";

export interface PaidExecutionTelemetryDetails {
  roleProfile?: string;
  blockedByGuardrail?: "input" | "output";
  retrySources?: Array<"llm" | "middleware">;
  fallbackModelId?: string;
}

export interface PaidExecutionTelemetry {
  providerId: string;
  modelId?: string;
  timeoutMs: number;
  outcomeClass: PaidExecutionOutcomeClass;
  fallbackApplied: boolean;
  retryCount: number;
  errorCode?: string;
  details?: PaidExecutionTelemetryDetails;
}
