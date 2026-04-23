import { randomUUID } from "node:crypto";
import type {
  AuditHistoryService,
  ToolOutputBudgetService
} from "@mimir/application";
import { buildPaidExecutionAuditDetail } from "@mimir/application";
import type {
  CodingValidationResult,
  ExecuteCodingTaskRequest,
  ExecuteCodingTaskResponse
} from "@mimir/contracts";
import type {
  LocalAgentTraceRecord,
  LocalAgentTraceStore
} from "@mimir/domain";
import type { CodingControllerBridge } from "./coding-controller-bridge.js";
import {
  CodingAdvisoryService,
  type CodingAdvisoryInvocation
} from "./coding-advisory-service.js";

export interface CodingTraceModelDefaults {
  modelRole?: string;
  modelId?: string;
}

export class CodingDomainController {
  constructor(
    private readonly bridge: CodingControllerBridge,
    private readonly auditHistoryService?: AuditHistoryService,
    private readonly localAgentTraceStore?: LocalAgentTraceStore,
    private readonly traceModelDefaults: CodingTraceModelDefaults = {},
    private readonly toolOutputBudgetService?: ToolOutputBudgetService,
    private readonly codingAdvisoryService?: CodingAdvisoryService
  ) {}

  async executeTask(
    request: ExecuteCodingTaskRequest
  ): Promise<ExecuteCodingTaskResponse> {
    await this.appendTrace(request, {
      status: "started"
    });

    let result: ExecuteCodingTaskResponse;
    try {
      result = await this.bridge.executeTask(request);
    } catch (error) {
      await this.appendTrace(request, {
        status: "failed",
        reason: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    result = await this.prepareToolOutputs(request, result);
    const advisoryInvocation =
      (await this.codingAdvisoryService?.adviseOnEscalation({
        request,
        localResponse: result
      })) ?? {
        invoked: false,
        advisoryReturned: false
      };
    if (advisoryInvocation.advisory) {
      result = {
        ...result,
        codingAdvisory: advisoryInvocation.advisory
      };
    }

    await this.appendTrace(request, {
      status: result.status === "success" ? "succeeded" : "failed",
      reason: result.reason,
      toolUsed: result.toolUsed,
      providerErrorKind: readStringMetadata(result.escalationMetadata, "providerErrorKind"),
      retryCount: readNumberMetadata(result.escalationMetadata, "retryCount"),
      seedApplied: readBooleanMetadata(result.escalationMetadata, "seedApplied"),
      advisoryInvoked: advisoryInvocation.invoked || undefined,
      advisoryProviderId:
        advisoryInvocation.telemetry?.providerId ??
        advisoryInvocation.advisory?.providerId,
      advisoryModelId:
        advisoryInvocation.telemetry?.modelId ?? advisoryInvocation.advisory?.modelId,
      advisoryOutcomeClass: advisoryInvocation.telemetry?.outcomeClass,
      advisoryErrorCode: advisoryInvocation.telemetry?.errorCode,
      advisoryRecommendedAction: advisoryInvocation.advisory?.recommendedAction
    });

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
        escalationMetadata: result.escalationMetadata,
        memoryContextRequested: request.memoryContextStatus?.requested ?? false,
        memoryContextIncluded: request.memoryContextStatus?.included ?? false,
        memoryContextRetrievalHealth: request.memoryContextStatus?.retrievalHealth?.status,
        memoryContextTraceIncluded: request.memoryContextStatus?.traceIncluded,
        memoryContextTokenEstimate: request.memoryContextStatus?.tokenEstimate,
        memoryContextTruncated: request.memoryContextStatus?.truncated,
        memoryContextErrorMessage: request.memoryContextStatus?.errorMessage,
        ...(buildCodingAdvisoryAuditDetail(advisoryInvocation)
          ? { codingAdvisory: buildCodingAdvisoryAuditDetail(advisoryInvocation) }
          : {})
      }
    });

    return result;
  }

  async listTraces(requestId: string): Promise<LocalAgentTraceRecord[]> {
    return this.localAgentTraceStore?.listByRequest(requestId) ?? [];
  }

  async showToolOutput(
    outputId: string
  ): Promise<Awaited<ReturnType<ToolOutputBudgetService["showOutput"]>>> {
    return this.toolOutputBudgetService?.showOutput(outputId);
  }

  private async appendTrace(
    request: ExecuteCodingTaskRequest,
    fields: Pick<LocalAgentTraceRecord, "status"> &
      Partial<
        Pick<
          LocalAgentTraceRecord,
          | "reason"
          | "toolUsed"
          | "providerErrorKind"
          | "retryCount"
          | "seedApplied"
          | "advisoryInvoked"
          | "advisoryProviderId"
          | "advisoryModelId"
          | "advisoryOutcomeClass"
          | "advisoryErrorCode"
          | "advisoryRecommendedAction"
        >
      >
  ): Promise<void> {
    if (!this.localAgentTraceStore) {
      return;
    }

    await this.localAgentTraceStore.append({
      traceId: randomUUID(),
      requestId: request.actor.requestId,
      actorId: request.actor.actorId,
      taskType: request.taskType,
      modelRole: this.traceModelDefaults.modelRole ?? "coding_primary",
      modelId: this.traceModelDefaults.modelId,
      memoryContextIncluded: request.memoryContextStatus?.included ?? false,
      retrievalTraceIncluded: request.memoryContextStatus?.traceIncluded ?? false,
      status: fields.status,
      reason: fields.reason,
      toolUsed: fields.toolUsed,
      providerErrorKind: fields.providerErrorKind,
      retryCount: fields.retryCount,
      seedApplied: fields.seedApplied,
      advisoryInvoked: fields.advisoryInvoked,
      advisoryProviderId: fields.advisoryProviderId,
      advisoryModelId: fields.advisoryModelId,
      advisoryOutcomeClass: fields.advisoryOutcomeClass,
      advisoryErrorCode: fields.advisoryErrorCode,
      advisoryRecommendedAction: fields.advisoryRecommendedAction,
      createdAt: new Date().toISOString()
    });
  }

  private async prepareToolOutputs(
    request: ExecuteCodingTaskRequest,
    result: ExecuteCodingTaskResponse
  ): Promise<ExecuteCodingTaskResponse> {
    if (!this.toolOutputBudgetService) {
      return result;
    }

    const spillovers: string[] = [];
    const localResult = result.localResult
      ? await this.prepareOutputishObject(
          result.localResult,
          request,
          result.toolUsed ?? "local_coding",
          "localResult",
          spillovers
        )
      : undefined;
    const validations = result.validations
      ? await Promise.all(
          result.validations.map((validation, index) =>
            this.prepareValidationOutput(
              validation,
              request,
              `${result.toolUsed ?? "local_coding"}.validation.${index}`,
              spillovers
            )
          )
        )
      : undefined;

    if (spillovers.length === 0) {
      return result;
    }

    return {
      ...result,
      localResult,
      validations,
      escalationMetadata: {
        ...result.escalationMetadata,
        toolOutputSpilloverCount: spillovers.length,
        toolOutputSpilloverIds: spillovers
      }
    };
  }

  private async prepareValidationOutput(
    validation: CodingValidationResult,
    request: ExecuteCodingTaskRequest,
    toolNamePrefix: string,
    spillovers: string[]
  ): Promise<CodingValidationResult> {
    const prepared = { ...validation };
    if (prepared.stdout) {
      prepared.stdout = await this.prepareSingleOutput(
        prepared.stdout,
        request,
        `${toolNamePrefix}.stdout`,
        spillovers
      );
    }
    if (prepared.stderr) {
      prepared.stderr = await this.prepareSingleOutput(
        prepared.stderr,
        request,
        `${toolNamePrefix}.stderr`,
        spillovers
      );
    }

    return prepared;
  }

  private async prepareOutputishObject(
    value: Record<string, unknown>,
    request: ExecuteCodingTaskRequest,
    toolNamePrefix: string,
    path: string,
    spillovers: string[]
  ): Promise<Record<string, unknown>> {
    const prepared: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${path}.${key}`;
      if (typeof item === "string" && isOutputishKey(key)) {
        prepared[key] = await this.prepareSingleOutput(
          item,
          request,
          `${toolNamePrefix}.${itemPath}`,
          spillovers
        );
      } else if (Array.isArray(item)) {
        prepared[key] = await Promise.all(
          item.map((entry, index) =>
            isPlainRecord(entry)
              ? this.prepareOutputishObject(
                  entry,
                  request,
                  toolNamePrefix,
                  `${itemPath}.${index}`,
                  spillovers
                )
              : entry
          )
        );
      } else if (isPlainRecord(item)) {
        prepared[key] = await this.prepareOutputishObject(
          item,
          request,
          toolNamePrefix,
          itemPath,
          spillovers
        );
      } else {
        prepared[key] = item;
      }
    }

    return prepared;
  }

  private async prepareSingleOutput(
    text: string,
    request: ExecuteCodingTaskRequest,
    toolName: string,
    spillovers: string[]
  ): Promise<string> {
    const prepared = await this.toolOutputBudgetService?.prepareOutput({
      requestId: request.actor.requestId,
      actorId: request.actor.actorId,
      toolName,
      text
    });
    if (!prepared) {
      return text;
    }

    if (prepared.record) {
      spillovers.push(prepared.record.outputId);
    }

    return prepared.text;
  }
}

function readStringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumberMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" ? value : undefined;
}

function readBooleanMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string
): boolean | undefined {
  const value = metadata?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function isOutputishKey(key: string): boolean {
  return [
    "output",
    "stdout",
    "stderr",
    "patch_output",
    "decision_output",
    "raw_output"
  ].includes(key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildCodingAdvisoryAuditDetail(
  advisoryInvocation: CodingAdvisoryInvocation
): Record<string, unknown> | undefined {
  if (!advisoryInvocation.invoked) {
    return undefined;
  }

  return {
    invoked: true,
    advisoryReturned: advisoryInvocation.advisoryReturned,
    ...(advisoryInvocation.advisory
      ? {
          recommendedAction: advisoryInvocation.advisory.recommendedAction,
          summary: advisoryInvocation.advisory.summary,
          suggestedChecks: advisoryInvocation.advisory.suggestedChecks
        }
      : {}),
    telemetry: buildPaidExecutionAuditDetail(advisoryInvocation.telemetry)
  };
}
