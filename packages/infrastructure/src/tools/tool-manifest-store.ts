import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AiToolCheckResult } from "@mimir/contracts";
import {
  isNonEmptyString,
  manifestCandidateIds,
  type ToolManifest,
  validateToolManifest
} from "./tool-manifest.js";

export function loadToolRegistryFromDirectory(directory: string): ToolManifest[] {
  return listToolManifestFiles(directory).map((entry) => {
    const manifest = JSON.parse(readFileSync(join(directory, entry), "utf8")) as unknown;
    return validateToolManifest(manifest, entry);
  });
}

export function loadToolRegistryChecksFromDirectory(
  directory: string,
  requestedIds: ReadonlySet<string> = new Set()
): {
  checks: AiToolCheckResult[];
  warnings: string[];
} {
  const checks = listToolManifestFiles(directory)
    .map((fileName) => checkManifestFile(join(directory, fileName), fileName))
    .filter((check) => shouldIncludeCheck(check, requestedIds));
  const foundIds = new Set(checks.flatMap((check) => manifestCandidateIds(check)));

  return {
    checks,
    warnings: [...requestedIds]
      .filter((id) => !foundIds.has(id))
      .map((id) => `Tool manifest '${id}' was not found.`)
  };
}

function listToolManifestFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));
}

function checkManifestFile(filePath: string, fileName: string): AiToolCheckResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      fileName,
      status: "invalid",
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: []
    };
  }

  try {
    const manifest = validateToolManifest(parsed, fileName);
    return {
      fileName,
      toolId: manifest.id,
      dockerProfile: manifest.dockerProfile,
      status: "valid",
      errors: [],
      warnings: []
    };
  } catch (error) {
    const raw =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return {
      fileName,
      toolId: typeof raw.id === "string" ? raw.id : undefined,
      dockerProfile: typeof raw.dockerProfile === "string" ? raw.dockerProfile : undefined,
      status: "invalid",
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: []
    };
  }
}

function shouldIncludeCheck(
  check: AiToolCheckResult,
  requestedIds: ReadonlySet<string>
): boolean {
  if (requestedIds.size === 0) {
    return true;
  }

  return manifestCandidateIds(check).some((id) => requestedIds.has(id));
}