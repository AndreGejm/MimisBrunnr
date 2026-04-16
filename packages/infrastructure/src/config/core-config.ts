import type { AppEnvironment } from "./app-environment.js";
import { parsePort, resolveNodeEnv } from "./config-helpers.js";
import { loadReleaseMetadata } from "./release-metadata.js";

export type CoreConfig = Pick<
  AppEnvironment,
  "nodeEnv" | "release" | "apiHost" | "apiPort" | "logLevel"
>;

export function loadCoreConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  return {
    nodeEnv: resolveNodeEnv(env.MAB_NODE_ENV),
    release: loadReleaseMetadata(env),
    apiHost: env.MAB_API_HOST ?? "127.0.0.1",
    apiPort: parsePort(env.MAB_API_PORT, 8080),
    logLevel: (env.MAB_LOG_LEVEL as AppEnvironment["logLevel"]) ?? "info"
  };
}

export function normalizeCoreConfig(input: Partial<AppEnvironment>): CoreConfig {
  return {
    nodeEnv: input.nodeEnv ?? "development",
    release: input.release ?? loadReleaseMetadata(),
    apiHost: input.apiHost ?? "127.0.0.1",
    apiPort: input.apiPort ?? 8080,
    logLevel: input.logLevel ?? "info"
  };
}