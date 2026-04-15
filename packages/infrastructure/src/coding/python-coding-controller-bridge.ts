import { spawn } from "node:child_process";
import path from "node:path";
import { classifyProviderError } from "@mimir/application";
import type {
  ExecuteCodingTaskRequest,
  ExecuteCodingTaskResponse
} from "@mimir/contracts";
import { QWEN3_CODER_LOCAL_PROFILE } from "@mimir/domain";
import type {
  CodingControllerBridge,
  ModelRoleBinding
} from "@mimir/orchestration";

export interface PythonCodingControllerBridgeOptions {
  pythonExecutable: string;
  pythonPath: string;
  moduleName: string;
  timeoutMs: number;
  ollamaBaseUrl: string;
  codingBinding: ModelRoleBinding;
}

export interface PythonCodingEnvironmentOptions {
  pythonPath: string;
  ollamaBaseUrl: string;
  codingBinding: ModelRoleBinding;
}

export class PythonCodingControllerBridge implements CodingControllerBridge {
  constructor(private readonly options: PythonCodingControllerBridgeOptions) {}

  async executeTask(
    request: ExecuteCodingTaskRequest
  ): Promise<ExecuteCodingTaskResponse> {
    const command = buildPythonCommand(
      this.options.pythonExecutable,
      this.options.moduleName
    );
    const bridgePayload = {
      taskType: request.taskType,
      task: request.task,
      context: request.context ?? "",
      repoRoot: request.repoRoot,
      filePath: request.filePath,
      symbolName: request.symbolName,
      diffText: request.diffText,
      pytestTarget: request.pytestTarget,
      lintTarget: request.lintTarget,
      metadata: {
        actorId: request.actor.actorId,
        actorRole: request.actor.actorRole,
        source: request.actor.source,
        transport: request.actor.transport,
        requestId: request.actor.requestId
      }
    };

    return new Promise<ExecuteCodingTaskResponse>((resolve) => {
      const child = spawn(command.executable, command.args, {
        cwd: process.cwd(),
        env: buildBridgeEnvironment(this.options),
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timeout = setTimeout(() => {
        child.kill();
        if (!settled) {
          settled = true;
          resolve({
            status: "escalate",
            reason: `Vendored coding runtime timed out after ${this.options.timeoutMs} ms.`,
            attempts: 0,
            escalationMetadata: withProviderErrorMetadata(
              `Vendored coding runtime timed out after ${this.options.timeoutMs} ms.`,
              {
              bridge: "python",
              timeoutMs: this.options.timeoutMs
              }
            )
          });
        }
      }, this.options.timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.once("error", (error) => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          resolve({
            status: "escalate",
            reason: `Failed to start vendored coding runtime: ${error.message}`,
            attempts: 0,
            escalationMetadata: withProviderErrorMetadata(error, {
              bridge: "python",
              stderr: stderr || undefined
            })
          });
        }
      });

      child.once("close", (exitCode) => {
        clearTimeout(timeout);
        if (settled) {
          return;
        }
        settled = true;
        resolve(normalizeBridgeResponse(stdout, stderr, exitCode));
      });

      child.stdin.write(JSON.stringify(bridgePayload));
      child.stdin.end();
    });
  }
}

function buildPythonCommand(
  pythonExecutable: string,
  moduleName: string
): { executable: string; args: string[] } {
  if (path.basename(pythonExecutable).toLowerCase() === "py") {
    return {
      executable: pythonExecutable,
      args: ["-3", "-m", moduleName]
    };
  }

  return {
    executable: pythonExecutable,
    args: ["-m", moduleName]
  };
}

function buildBridgeEnvironment(
  options: PythonCodingControllerBridgeOptions
): NodeJS.ProcessEnv {
  return buildPythonCodingEnvironment(options);
}

export function buildPythonCodingEnvironment(
  options: PythonCodingEnvironmentOptions
): NodeJS.ProcessEnv {
  const pythonPath = process.env.PYTHONPATH
    ? `${options.pythonPath}${path.delimiter}${process.env.PYTHONPATH}`
    : options.pythonPath;

  return {
    ...process.env,
    PYTHONPATH: pythonPath,
    OLLAMA_API_URL: toGenerateUrl(options.ollamaBaseUrl),
    CODING_MODEL: options.codingBinding.modelId ?? "qwen3-coder:30B",
    CODING_MODEL_CONTEXT_TOKENS: String(QWEN3_CODER_LOCAL_PROFILE.contextWindowTokens),
    CODING_MODEL_TEMPERATURE: String(
      options.codingBinding.temperature ?? QWEN3_CODER_LOCAL_PROFILE.recommendedTemperature
    ),
    CODING_MODEL_SEED: String(
      options.codingBinding.seed ?? QWEN3_CODER_LOCAL_PROFILE.recommendedSeed ?? 42
    ),
    CODING_MODEL_PHASE_BUDGETS_JSON: JSON.stringify(
      QWEN3_CODER_LOCAL_PROFILE.phaseBudgets ?? {}
    )
  };
}

function toGenerateUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return normalized.endsWith("/api/generate")
    ? normalized
    : `${normalized}/api/generate`;
}

function normalizeBridgeResponse(
  stdout: string,
  stderr: string,
  exitCode: number | null
): ExecuteCodingTaskResponse {
  try {
    const parsed = JSON.parse(stdout.trim()) as Partial<ExecuteCodingTaskResponse>;
    if (
      parsed &&
      (parsed.status === "success" || parsed.status === "fail" || parsed.status === "escalate") &&
      typeof parsed.reason === "string"
    ) {
      return {
        status: parsed.status,
        reason: parsed.reason,
        attempts: typeof parsed.attempts === "number" ? parsed.attempts : 0,
        toolUsed: parsed.toolUsed,
        localResult: parsed.localResult,
        validations: parsed.validations,
        escalationMetadata:
          parsed.status === "success"
            ? parsed.escalationMetadata
            : withProviderErrorMetadata(parsed.reason, parsed.escalationMetadata)
      };
    }
  } catch {
    // fall through to bridge failure response
  }

  return {
    status: "escalate",
    reason:
      stderr.trim() ||
      `Vendored coding runtime returned invalid JSON output (exit code ${exitCode ?? "unknown"}).`,
    attempts: 0,
    escalationMetadata: withProviderErrorMetadata(
      stderr.trim() ||
        `Vendored coding runtime returned invalid JSON output (exit code ${exitCode ?? "unknown"}).`,
      {
      bridge: "python",
      exitCode: exitCode ?? undefined,
      stdout: stdout.trim() || undefined,
      stderr: stderr.trim() || undefined
      }
    )
  };
}

function withProviderErrorMetadata(
  error: unknown,
  metadata: Record<string, unknown> | undefined = {}
): Record<string, unknown> {
  if (typeof metadata.providerErrorKind === "string") {
    return metadata;
  }

  const classified = classifyProviderError(error);
  return {
    ...metadata,
    providerErrorKind: classified.kind,
    providerRetryable: classified.retryable,
    providerOperatorAction: classified.operatorAction,
    retryCount: typeof metadata.retryCount === "number" ? metadata.retryCount : 0
  };
}
