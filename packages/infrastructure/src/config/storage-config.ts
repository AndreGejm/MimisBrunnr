import path from "node:path";
import type { AppEnvironment } from "./app-environment.js";
import { parseBoolean, resolveDataRoot } from "./config-helpers.js";

export type StorageConfig = Pick<
  AppEnvironment,
  | "vaultRoot"
  | "stagingRoot"
  | "importAllowedRoots"
  | "sqlitePath"
  | "qdrantUrl"
  | "qdrantCollection"
  | "qdrantSoftFail"
>;

export function loadStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const dataRoot = resolveDataRoot(env);
  return {
    vaultRoot: env.MAB_VAULT_ROOT ?? path.join(dataRoot, "vault", "canonical"),
    stagingRoot: env.MAB_STAGING_ROOT ?? path.join(dataRoot, "vault", "staging"),
    importAllowedRoots: parseOptionalPathList(
      env.MAB_IMPORT_ALLOWED_ROOTS,
      env.MAB_IMPORT_ALLOWED_ROOTS_JSON
    ),
    sqlitePath:
      env.MAB_SQLITE_PATH ?? path.join(dataRoot, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: env.MAB_QDRANT_URL ?? "http://127.0.0.1:6333",
    qdrantCollection: env.MAB_QDRANT_COLLECTION ?? "mimisbrunnr_chunks",
    qdrantSoftFail: parseBoolean(env.MAB_QDRANT_SOFT_FAIL, true)
  };
}

export function normalizeStorageConfig(
  input: Partial<AppEnvironment>,
  env: NodeJS.ProcessEnv = process.env
): StorageConfig {
  const dataRoot = resolveDataRoot(env);
  return {
    vaultRoot: input.vaultRoot ?? path.join(dataRoot, "vault", "canonical"),
    stagingRoot: input.stagingRoot ?? path.join(dataRoot, "vault", "staging"),
    importAllowedRoots: normalizeOptionalPathList(input.importAllowedRoots),
    sqlitePath:
      input.sqlitePath ?? path.join(dataRoot, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: input.qdrantUrl ?? "http://127.0.0.1:6333",
    qdrantCollection: input.qdrantCollection ?? "mimisbrunnr_chunks",
    qdrantSoftFail: input.qdrantSoftFail ?? true
  };
}

function parseOptionalPathList(
  delimitedValue: string | undefined,
  jsonValue: string | undefined
): string[] | undefined {
  if (jsonValue?.trim()) {
    const parsed = JSON.parse(jsonValue) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("MAB_IMPORT_ALLOWED_ROOTS_JSON must be a JSON array of strings.");
    }
    return normalizeOptionalPathList(parsed);
  }

  if (!delimitedValue?.trim()) {
    return undefined;
  }

  return normalizeOptionalPathList(delimitedValue.split(/[;\r\n]+/));
}

function normalizeOptionalPathList(value: string[] | undefined): string[] | undefined {
  const normalized = value
    ?.map((item) => item.trim())
    .filter((item) => item.length > 0);
  return normalized && normalized.length > 0 ? normalized : undefined;
}
