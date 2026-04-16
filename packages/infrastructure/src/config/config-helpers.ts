import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppEnvironment } from "./app-environment.js";

export const DEFAULT_WORKSPACE_ROOT = fileURLToPath(
  new URL("../../../../", import.meta.url)
);
export const DEFAULT_DATA_ROOT_NAME = ".mimir";

export function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function coalesceString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()));
}

export function resolveNodeEnv(value: string | undefined): AppEnvironment["nodeEnv"] {
  return (value as AppEnvironment["nodeEnv"]) ?? "development";
}

export function resolveDataRoot(env: NodeJS.ProcessEnv): string {
  const configured = env.MAB_DATA_ROOT?.trim();
  if (configured) {
    return configured;
  }

  const home = env.USERPROFILE?.trim() || env.HOME?.trim() || os.homedir();
  return path.join(home, DEFAULT_DATA_ROOT_NAME);
}