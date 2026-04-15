import { randomUUID } from "node:crypto";
import type {
  StoredToolOutput,
  ToolOutputSpilloverRecord,
  ToolOutputStore
} from "@mimir/domain";

export const DEFAULT_TOOL_OUTPUT_INLINE_BUDGET_BYTES = 64 * 1024;
export const MAX_TOOL_OUTPUT_INLINE_BUDGET_BYTES = 256 * 1024;
export const DEFAULT_TOOL_OUTPUT_PREVIEW_BYTES = 4096;

export interface ToolOutputBudgetServiceOptions {
  inlineBudgetBytes?: number;
  previewBytes?: number;
}

export interface PrepareToolOutputRequest {
  requestId: string;
  actorId: string;
  toolName: string;
  text: string;
  inlineBudgetBytes?: number;
}

export interface PreparedToolOutput {
  text: string;
  spilled: boolean;
  record?: ToolOutputSpilloverRecord;
}

export class ToolOutputBudgetService {
  constructor(
    private readonly store: ToolOutputStore,
    private readonly options: ToolOutputBudgetServiceOptions = {}
  ) {}

  async prepareOutput(
    request: PrepareToolOutputRequest
  ): Promise<PreparedToolOutput> {
    const inlineBudget = clampInlineBudget(
      request.inlineBudgetBytes ?? this.options.inlineBudgetBytes
    );
    const byteLength = Buffer.byteLength(request.text, "utf8");
    if (byteLength <= inlineBudget) {
      return {
        text: request.text,
        spilled: false
      };
    }

    const previewBudget = Math.min(
      this.options.previewBytes ?? DEFAULT_TOOL_OUTPUT_PREVIEW_BYTES,
      inlineBudget,
      byteLength
    );
    const preview = truncateUtf8(request.text, previewBudget);
    const record = await this.store.save(
      {
        outputId: randomUUID(),
        requestId: request.requestId,
        actorId: request.actorId,
        toolName: request.toolName,
        storagePath: "",
        byteLength,
        preview,
        createdAt: new Date().toISOString()
      },
      request.text
    );

    return {
      text: renderSpilloverPreview(record),
      spilled: true,
      record
    };
  }

  async showOutput(outputId: string): Promise<StoredToolOutput | undefined> {
    return this.store.findById(outputId);
  }
}

function clampInlineBudget(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) {
    return DEFAULT_TOOL_OUTPUT_INLINE_BUDGET_BYTES;
  }

  return Math.max(1, Math.min(Math.trunc(value as number), MAX_TOOL_OUTPUT_INLINE_BUDGET_BYTES));
}

function truncateUtf8(value: string, maxBytes: number): string {
  return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
}

function renderSpilloverPreview(record: ToolOutputSpilloverRecord): string {
  const previewBytes = Buffer.byteLength(record.preview, "utf8");
  return [
    `<tool-output-spillover outputId="${escapeXmlAttribute(record.outputId)}" toolName="${escapeXmlAttribute(record.toolName)}" totalBytes="${record.byteLength}" previewBytes="${previewBytes}">`,
    record.preview,
    "</tool-output-spillover>",
    `Full output is stored outside prompt context. Use show-tool-output with outputId "${record.outputId}" to inspect it.`
  ].join("\n");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
