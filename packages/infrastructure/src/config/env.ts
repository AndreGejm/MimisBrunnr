import type { AppEnvironment } from "./app-environment.js";
import { loadAuthConfig, normalizeAuthConfig } from "./auth-config.js";
import {
  loadCodingRuntimeConfig,
  normalizeCodingRuntimeConfig
} from "./coding-runtime-config.js";
import { loadCoreConfig, normalizeCoreConfig } from "./core-config.js";
import { loadProviderConfig, normalizeProviderConfig } from "./provider-config.js";
import { loadStorageConfig, normalizeStorageConfig } from "./storage-config.js";
import { loadToolConfig, normalizeToolConfig } from "./tool-config.js";

export type { AppEnvironment } from "./app-environment.js";

export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  const core = loadCoreConfig(env);
  return normalizeEnvironment({
    ...core,
    ...loadStorageConfig(env),
    ...loadProviderConfig(env),
    ...loadToolConfig(env),
    ...loadCodingRuntimeConfig(env),
    auth: loadAuthConfig(env, core.nodeEnv)
  });
}

export function normalizeEnvironment(input: Partial<AppEnvironment>): AppEnvironment {
  const core = normalizeCoreConfig(input);
  return {
    ...core,
    ...normalizeStorageConfig(input),
    ...normalizeProviderConfig(input),
    ...normalizeToolConfig(input),
    ...normalizeCodingRuntimeConfig(input),
    auth: normalizeAuthConfig(input.auth, core.nodeEnv)
  };
}