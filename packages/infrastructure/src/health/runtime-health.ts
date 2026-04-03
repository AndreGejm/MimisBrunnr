import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppEnvironment } from "../config/env.js";

export type HealthStatus = "pass" | "warn" | "fail";

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeHealthReport {
  mode: "live" | "ready";
  status: "pass" | "degraded" | "fail";
  checkedAt: string;
  checks: HealthCheckResult[];
}

export async function runRuntimeHealthChecks(
  env: AppEnvironment,
  mode: "live" | "ready"
): Promise<RuntimeHealthReport> {
  const checks: HealthCheckResult[] = [
    await ensureDirectoryCheck("canonical_vault", env.vaultRoot),
    await ensureDirectoryCheck("staging_vault", env.stagingRoot),
    await sqliteCheck(env.sqlitePath),
    await qdrantCheck(env.qdrantUrl, env.qdrantCollection, mode)
  ];

  return {
    mode,
    status: deriveOverallStatus(checks),
    checkedAt: new Date().toISOString(),
    checks
  };
}

async function ensureDirectoryCheck(
  name: string,
  directoryPath: string
): Promise<HealthCheckResult> {
  try {
    await mkdir(directoryPath, { recursive: true });
    const handle = await open(directoryPath, "r");
    await handle.close();

    return {
      name,
      status: "pass",
      message: `Directory '${directoryPath}' is available.`
    };
  } catch (error) {
    return {
      name,
      status: "fail",
      message: `Directory '${directoryPath}' is not accessible.`,
      details: {
        reason: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function sqliteCheck(databasePath: string): Promise<HealthCheckResult> {
  try {
    await mkdir(path.dirname(path.resolve(databasePath)), { recursive: true });
    const database = new DatabaseSync(databasePath);
    database.prepare("SELECT 1 AS ok").get();
    database.close();

    return {
      name: "sqlite_control_store",
      status: "pass",
      message: `SQLite control store '${databasePath}' is reachable.`
    };
  } catch (error) {
    return {
      name: "sqlite_control_store",
      status: "fail",
      message: `SQLite control store '${databasePath}' is not reachable.`,
      details: {
        reason: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function qdrantCheck(
  baseUrl: string,
  collectionName: string,
  mode: "live" | "ready"
): Promise<HealthCheckResult> {
  try {
    const response = await fetch(
      new URL(`/collections/${collectionName}`, ensureTrailingSlash(baseUrl)),
      {
        method: "GET",
        signal: AbortSignal.timeout(1500)
      }
    );

    if (response.ok || response.status === 404) {
      return {
        name: "qdrant_vector_store",
        status: "pass",
        message: `Qdrant at '${baseUrl}' is reachable for collection '${collectionName}'.`
      };
    }

    return {
      name: "qdrant_vector_store",
      status: mode === "ready" ? "fail" : "warn",
      message: `Qdrant responded with status ${response.status}.`,
      details: {
        baseUrl,
        collectionName
      }
    };
  } catch (error) {
    return {
      name: "qdrant_vector_store",
      status: mode === "ready" ? "fail" : "warn",
      message: `Qdrant at '${baseUrl}' is unavailable.`,
      details: {
        collectionName,
        reason: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function deriveOverallStatus(checks: HealthCheckResult[]): RuntimeHealthReport["status"] {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }

  if (checks.some((check) => check.status === "warn")) {
    return "degraded";
  }

  return "pass";
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
