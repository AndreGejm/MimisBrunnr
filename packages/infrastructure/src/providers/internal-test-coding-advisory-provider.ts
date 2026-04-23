import type { CodingAdvisoryProvider } from "@mimir/application";
import type {
  CodingAdvisoryRecommendedAction,
  CodingAdvisoryResult,
  PaidExecutionTelemetry
} from "@mimir/contracts";

export interface InternalTestCodingAdvisoryProviderOptions {
  modelId?: string;
  timeoutMs: number;
}

const DEFAULT_RECOMMENDED_ACTION: CodingAdvisoryRecommendedAction = "manual_followup";
const DEFAULT_SUMMARY =
  "Internal test advisory: inspect the escalation details and continue with a targeted manual follow-up.";
const DEFAULT_SUGGESTED_CHECKS = [
  "Review the local escalation reason before retrying.",
  "Narrow the target file or symbol before the next attempt."
];

export class InternalTestCodingAdvisoryProvider implements CodingAdvisoryProvider {
  readonly providerId = "internal_test_stub";

  private lastTelemetry?: PaidExecutionTelemetry;

  constructor(private readonly options: InternalTestCodingAdvisoryProviderOptions) {}

  consumePaidExecutionTelemetry(): PaidExecutionTelemetry | undefined {
    const telemetry = this.lastTelemetry;
    this.lastTelemetry = undefined;
    return telemetry;
  }

  async adviseOnEscalation(): Promise<CodingAdvisoryResult> {
    const telemetry: PaidExecutionTelemetry = {
      providerId: this.providerId,
      modelId: this.options.modelId,
      timeoutMs: this.options.timeoutMs,
      outcomeClass: "success",
      fallbackApplied: false,
      retryCount: 0
    };
    this.lastTelemetry = telemetry;

    return {
      invoked: true,
      modelRole: "coding_advisory",
      providerId: this.providerId,
      modelId: this.options.modelId,
      recommendedAction: DEFAULT_RECOMMENDED_ACTION,
      summary: DEFAULT_SUMMARY,
      suggestedChecks: [...DEFAULT_SUGGESTED_CHECKS],
      telemetry
    };
  }
}
