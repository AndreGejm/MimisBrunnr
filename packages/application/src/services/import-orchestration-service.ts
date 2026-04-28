import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path, { basename, resolve } from "node:path";
import type { ServiceResult } from "@mimir/contracts";
import type { ImportJob } from "@mimir/domain";
import type {
  ImportResourceRequest,
  ImportResourceResponse
} from "@mimir/contracts";
import type { ImportJobStore } from "../ports/import-job-store.js";

type ImportResourceErrorCode = "forbidden" | "not_found" | "write_failed";

export interface ImportOrchestrationServiceOptions {
  allowedSourceRoots?: string[];
}

export class ImportOrchestrationService {
  private readonly allowedSourceRoots: string[];

  constructor(
    private readonly importJobStore: ImportJobStore,
    options: ImportOrchestrationServiceOptions = {}
  ) {
    this.allowedSourceRoots = (options.allowedSourceRoots ?? [])
      .map((root) => resolve(root))
      .filter((root) => root.trim().length > 0);
  }

  async importResource(
    request: ImportResourceRequest
  ): Promise<ServiceResult<ImportResourceResponse, ImportResourceErrorCode>> {
    const sourcePath = resolve(request.sourcePath);
    if (!this.isAllowedSourcePath(sourcePath)) {
      return {
        ok: false,
        error: {
          code: "forbidden",
          message: `Import source '${sourcePath}' is outside configured import roots.`
        }
      };
    }

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

  private isAllowedSourcePath(sourcePath: string): boolean {
    if (this.allowedSourceRoots.length === 0) {
      return true;
    }

    const normalizedSourcePath = normalizeForPathComparison(sourcePath);
    return this.allowedSourceRoots.some((root) => {
      const normalizedRoot = normalizeForPathComparison(root);
      const relativePath = path.relative(normalizedRoot, normalizedSourcePath);
      return (
        relativePath === "" ||
        (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
      );
    });
  }
}

function normalizeSourcePreview(sourceText: string): string {
  return sourceText
    .replace(/\uFEFF/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, 240);
}

function normalizeForPathComparison(value: string): string {
  const resolved = resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
