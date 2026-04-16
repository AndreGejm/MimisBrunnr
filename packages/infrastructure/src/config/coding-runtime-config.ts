import path from "node:path";
import type { AppEnvironment } from "./app-environment.js";
import { DEFAULT_WORKSPACE_ROOT, parsePort } from "./config-helpers.js";

export type CodingRuntimeConfig = Pick<
  AppEnvironment,
  | "codingRuntimePythonExecutable"
  | "codingRuntimePythonPath"
  | "codingRuntimeModule"
  | "codingRuntimeTimeoutMs"
>;

export function loadCodingRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): CodingRuntimeConfig {
  return {
    codingRuntimePythonExecutable:
      env.MAB_CODING_RUNTIME_PYTHON_EXECUTABLE ??
      (process.platform === "win32" ? "py" : "python3"),
    codingRuntimePythonPath:
      env.MAB_CODING_RUNTIME_PYTHONPATH ??
      path.join(DEFAULT_WORKSPACE_ROOT, "runtimes"),
    codingRuntimeModule:
      env.MAB_CODING_RUNTIME_MODULE ?? "local_experts.bridge",
    codingRuntimeTimeoutMs: parsePort(env.MAB_CODING_RUNTIME_TIMEOUT_MS, 120000)
  };
}

export function normalizeCodingRuntimeConfig(
  input: Partial<AppEnvironment>
): CodingRuntimeConfig {
  return {
    codingRuntimePythonExecutable:
      input.codingRuntimePythonExecutable ??
      (process.platform === "win32" ? "py" : "python3"),
    codingRuntimePythonPath:
      input.codingRuntimePythonPath ??
      path.join(DEFAULT_WORKSPACE_ROOT, "runtimes"),
    codingRuntimeModule:
      input.codingRuntimeModule ?? "local_experts.bridge",
    codingRuntimeTimeoutMs: input.codingRuntimeTimeoutMs ?? 120_000
  };
}