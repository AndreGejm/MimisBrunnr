import path from "node:path";
import type { AppEnvironment } from "./app-environment.js";
import { parseBoolean, resolveDataRoot } from "./config-helpers.js";

export type StorageConfig = Pick<
  AppEnvironment,
  | "vaultRoot"
  | "stagingRoot"
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
    sqlitePath:
      input.sqlitePath ?? path.join(dataRoot, "state", "mimisbrunnr.sqlite"),
    qdrantUrl: input.qdrantUrl ?? "http://127.0.0.1:6333",
    qdrantCollection: input.qdrantCollection ?? "mimisbrunnr_chunks",
    qdrantSoftFail: input.qdrantSoftFail ?? true
  };
}