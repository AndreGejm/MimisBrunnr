import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { ServiceResult } from "@multi-agent-brain/contracts";
import type { ImportJob } from "@multi-agent-brain/domain";
import type {
  ImportResourceRequest,
  ImportResourceResponse
} from "@multi-agent-brain/contracts";
import type { ImportJobStore } from "../ports/import-job-store.js";

type ImportResourceErrorCode = "not_found" | "write_failed";

export class ImportOrchestrationService {
  constructor(private readonly importJobStore: ImportJobStore) {}

  async importResource(
    request: ImportResourceRequest
  ): Promise<ServiceResult<ImportResourceResponse, ImportResourceErrorCode>> {
    const sourcePath = resolve(request.sourcePath);
    let sourceText: string;

    try {
      sourceText = await readFile(sourcePath, "utf8");
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "not_found",
          message: `Import source '${sourcePath}' was not found or could not be read.`,
          details: {
            reason: error instanceof Error ? error.message : String(error)
          }
        }
      };
    }

    const now = new Date().toISOString();
    const importJob: ImportJob = {
      importJobId: randomUUID(),
      authorityState: "imported",
      state: "recorded",
      sourcePath,
      importKind: request.importKind,
      sourceName: basename(sourcePath),
      sourceDigest: createHash("sha256").update(sourceText, "utf8").digest("hex"),
      sourceSizeBytes: Buffer.byteLength(sourceText, "utf8"),
      sourcePreview: normalizeSourcePreview(sourceText),
      draftNoteIds: [],
      canonicalOutputs: [],
      createdAt: now,
      updatedAt: now
    };

    try {
      const persisted = await this.importJobStore.createImportJob(importJob);
      return {
        ok: true,
        data: {
          importJob: persisted,
          draftNoteIds: persisted.draftNoteIds,
          canonicalOutputs: persisted.canonicalOutputs
        }
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: "Failed to persist import job state.",
          details: {
            reason: error instanceof Error ? error.message : String(error)
          }
        }
      };
    }
  }
}

function normalizeSourcePreview(sourceText: string): string {
  return sourceText
    .replace(/\uFEFF/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, 240);
}
