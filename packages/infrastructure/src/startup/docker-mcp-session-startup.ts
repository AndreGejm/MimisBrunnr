import { spawn } from "node:child_process";
import { access, constants, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadEnvironment } from "../config/env.js";

type FetchImplementation = typeof fetch;

export interface DockerMcpSessionStartupCheck {
  name: string;
  status: "pass" | "fail";
  message: string;
  details?: Record<string, unknown>;
}

export interface DockerMcpSessionStartupReport {
  ok: boolean;
  checkedAt: string;
  checks: DockerMcpSessionStartupCheck[];
}

export interface DockerMcpSessionStartupValidationOptions {
  fetchImplementation?: FetchImplementation;
  isPathMounted?: (
    candidatePath: string
  ) => boolean | Promise<boolean>;
  checkPythonExecutable?: (
    executable: string
  ) => Promise<{ ok: boolean; detail: string }>;
}

interface ParsedEnvironment {
  MAB_AUTH_ACTOR_REGISTRY_PATH: string;
  MAB_CODING_RUNTIME_MODULE: string;
  MAB_CODING_RUNTIME_PYTHONPATH: string;
  MAB_MCP_DEFAULT_ACTOR_AUTH_TOKEN: string;
  MAB_MCP_DEFAULT_ACTOR_ID: string;
  MAB_MCP_DEFAULT_ACTOR_ROLE: string;
  MAB_MCP_DEFAULT_SOURCE?: string;
  MAB_QDRANT_COLLECTION: string;
  MAB_QDRANT_URL: string;
  MAB_SQLITE_PATH: string;
  MAB_STAGING_ROOT: string;
  MAB_VAULT_ROOT: string;
  MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL: string;
  MAB_CODING_RUNTIME_PYTHON_EXECUTABLE: string;
}

const REQUIRED_ENV_KEYS = [
  "MAB_NODE_ENV",
  "MAB_AUTH_MODE",
  "MAB_AUTH_ALLOW_ANONYMOUS_INTERNAL",
  "MAB_AUTH_ACTOR_REGISTRY_PATH",
  "MAB_VAULT_ROOT",
  "MAB_STAGING_ROOT",
  "MAB_SQLITE_PATH",
  "MAB_QDRANT_URL",
  "MAB_QDRANT_COLLECTION",
  "MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL",
  "MAB_ROLE_CODING_PRIMARY_PROVIDER",
  "MAB_ROLE_CODING_PRIMARY_MODEL",
  "MAB_ROLE_MIMISBRUNNR_PRIMARY_PROVIDER",
  "MAB_ROLE_MIMISBRUNNR_PRIMARY_MODEL",
  "MAB_ROLE_EMBEDDING_PRIMARY_PROVIDER",
  "MAB_ROLE_EMBEDDING_PRIMARY_MODEL",
  "MAB_ROLE_RERANKER_PRIMARY_PROVIDER",
  "MAB_ROLE_RERANKER_PRIMARY_MODEL",
  "MAB_CODING_RUNTIME_PYTHON_EXECUTABLE",
  "MAB_CODING_RUNTIME_PYTHONPATH",
  "MAB_CODING_RUNTIME_MODULE",
  "MAB_DISABLE_PROVIDER_FALLBACKS",
  "MAB_QDRANT_SOFT_FAIL",
  "MAB_MCP_DEFAULT_ACTOR_ID",
  "MAB_MCP_DEFAULT_ACTOR_ROLE",
  "MAB_MCP_DEFAULT_ACTOR_AUTH_TOKEN"
] as const;

const SUPPORTED_DOCKER_MODEL_ROLE_KEYS = [
  "MAB_ROLE_CODING_PRIMARY_PROVIDER",
  "MAB_ROLE_MIMISBRUNNR_PRIMARY_PROVIDER",
  "MAB_ROLE_EMBEDDING_PRIMARY_PROVIDER",
  "MAB_ROLE_RERANKER_PRIMARY_PROVIDER"
] as const;

export async function validateDockerMcpSessionStartup(
  rawEnv: NodeJS.ProcessEnv = process.env,
  options: DockerMcpSessionStartupValidationOptions = {}
): Promise<DockerMcpSessionStartupReport> {
  const checks: DockerMcpSessionStartupCheck[] = [];
  const requiredEnvCheck = buildRequiredExplicitEnvCheck(rawEnv);
  checks.push(requiredEnvCheck);
  if (requiredEnvCheck.status === "fail") {
    return finalizeReport(checks);
  }

  const parsedEnv = parseRawEnvironment(rawEnv);

  checks.push(buildStrictSessionContractCheck(rawEnv));
  checks.push(await buildStorageLayoutCheck(parsedEnv));
  checks.push(
    await buildStorageMountCheck(
      parsedEnv,
      options.isPathMounted ?? isPathMountedInsideContainer
    )
  );
  checks.push(await buildAuthRegistryCheck(rawEnv, parsedEnv));
  checks.push(
    await buildQdrantDependencyCheck(
      parsedEnv,
      options.fetchImplementation ?? fetch
    )
  );
  checks.push(
    await buildModelEndpointDependencyCheck(
      rawEnv,
      parsedEnv,
      options.fetchImplementation ?? fetch
    )
  );
  checks.push(
    await buildCodingRuntimeDependencyCheck(
      parsedEnv,
      options.checkPythonExecutable ?? checkPythonExecutable
    )
  );

  return finalizeReport(checks);
}

function buildRequiredExplicitEnvCheck(
  env: NodeJS.ProcessEnv
): DockerMcpSessionStartupCheck {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !env[key]?.trim());
  if (missing.length === 0) {
    return {
      name: "required_explicit_env",
      status: "pass",
      message: "All Docker MCP session environment variables are explicitly set."
    };
  }

  return {
    name: "required_explicit_env",
    status: "fail",
    message: `Missing required Docker MCP session environment variables: ${missing.join(", ")}.`,
    details: {
      missing
    }
  };
}

function buildStrictSessionContractCheck(
  env: NodeJS.ProcessEnv
): DockerMcpSessionStartupCheck {
  const failures: string[] = [];

  if (env.MAB_AUTH_MODE !== "enforced") {
    failures.push("MAB_AUTH_MODE must be 'enforced'.");
  }

  if (parseBooleanStrict(env.MAB_AUTH_ALLOW_ANONYMOUS_INTERNAL) !== false) {
    failures.push("MAB_AUTH_ALLOW_ANONYMOUS_INTERNAL must be 'false'.");
  }

  if (parseBooleanStrict(env.MAB_DISABLE_PROVIDER_FALLBACKS) !== true) {
    failures.push("MAB_DISABLE_PROVIDER_FALLBACKS must be 'true'.");
  }

  if (parseBooleanStrict(env.MAB_QDRANT_SOFT_FAIL) !== false) {
    failures.push("MAB_QDRANT_SOFT_FAIL must be 'false'.");
  }

  for (const key of SUPPORTED_DOCKER_MODEL_ROLE_KEYS) {
    if (env[key] !== "docker_ollama") {
      failures.push(`${key} must be 'docker_ollama'.`);
    }
  }

  if (failures.length === 0) {
    return {
      name: "strict_session_contract",
      status: "pass",
      message:
        "Docker MCP session mode is configured to enforce auth and disallow silent provider or vector fallbacks."
    };
  }

  return {
    name: "strict_session_contract",
    status: "fail",
    message: failures.join(" "),
    details: {
      failures
    }
  };
}

async function buildStorageLayoutCheck(
  env: ParsedEnvironment
): Promise<DockerMcpSessionStartupCheck> {
  const canonicalRoot = path.resolve(env.MAB_VAULT_ROOT);
  const stagingRoot = path.resolve(env.MAB_STAGING_ROOT);
  const stateDirectory = path.resolve(path.dirname(env.MAB_SQLITE_PATH));
  const configDirectory = path.resolve(path.dirname(env.MAB_AUTH_ACTOR_REGISTRY_PATH));
  const pythonPath = path.resolve(env.MAB_CODING_RUNTIME_PYTHONPATH);
  const failures: string[] = [];

  if (!path.isAbsolute(env.MAB_VAULT_ROOT)) {
    failures.push("MAB_VAULT_ROOT must be an absolute container path.");
  }

  if (!path.isAbsolute(env.MAB_STAGING_ROOT)) {
    failures.push("MAB_STAGING_ROOT must be an absolute container path.");
  }

  if (!path.isAbsolute(env.MAB_SQLITE_PATH)) {
    failures.push("MAB_SQLITE_PATH must be an absolute container path.");
  }

  if (!path.isAbsolute(env.MAB_AUTH_ACTOR_REGISTRY_PATH)) {
    failures.push("MAB_AUTH_ACTOR_REGISTRY_PATH must be an absolute container path.");
  }

  if (!path.isAbsolute(env.MAB_CODING_RUNTIME_PYTHONPATH)) {
    failures.push("MAB_CODING_RUNTIME_PYTHONPATH must be an absolute container path.");
  }

  const namedDirectories = [
    ["canonical", canonicalRoot],
    ["staging", stagingRoot],
    ["state", stateDirectory],
    ["config", configDirectory]
  ] as const;
  const uniqueDirectories = new Set(namedDirectories.map(([, value]) => value));
  if (uniqueDirectories.size !== namedDirectories.length) {
    failures.push(
      "Canonical, staging, state, and config directories must be distinct mounts."
    );
  }

  const overlappingPairs = [
    ["canonical", canonicalRoot, "staging", stagingRoot],
    ["canonical", canonicalRoot, "state", stateDirectory],
    ["canonical", canonicalRoot, "config", configDirectory],
    ["staging", stagingRoot, "state", stateDirectory],
    ["staging", stagingRoot, "config", configDirectory],
    ["state", stateDirectory, "config", configDirectory]
  ] as const;

  for (const [leftLabel, leftPath, rightLabel, rightPath] of overlappingPairs) {
    if (pathsOverlap(leftPath, rightPath)) {
      failures.push(
        `${leftLabel} path '${leftPath}' must not contain ${rightLabel} path '${rightPath}', or vice versa.`
      );
    }
  }

  failures.push(
    ...(await ensureDirectoryExists(canonicalRoot, "Canonical root")),
    ...(await ensureDirectoryExists(stagingRoot, "Staging root")),
    ...(await ensureDirectoryExists(stateDirectory, "State directory")),
    ...(await ensureDirectoryExists(configDirectory, "Config directory")),
    ...(await ensureDirectoryExists(pythonPath, "Coding runtime PYTHONPATH"))
  );

  failures.push(
    ...(await ensureFileExists(
      path.resolve(env.MAB_AUTH_ACTOR_REGISTRY_PATH),
      "Actor registry file"
    )),
    ...(await ensurePythonModuleExists(
      pythonPath,
      env.MAB_CODING_RUNTIME_MODULE
    ))
  );

  if (failures.length === 0) {
    return {
      name: "storage_layout",
      status: "pass",
      message:
        "Canonical, staging, state, config, and coding runtime paths are explicit, distinct, and present."
    };
  }

  return {
    name: "storage_layout",
    status: "fail",
    message: failures.join(" "),
    details: {
      canonicalRoot,
      stagingRoot,
      stateDirectory,
      configDirectory,
      pythonPath
    }
  };
}

async function buildStorageMountCheck(
  env: ParsedEnvironment,
  isPathMounted: (candidatePath: string) => boolean | Promise<boolean>
): Promise<DockerMcpSessionStartupCheck> {
  const mountTargets = [
    path.resolve(env.MAB_VAULT_ROOT),
    path.resolve(env.MAB_STAGING_ROOT),
    path.resolve(path.dirname(env.MAB_SQLITE_PATH)),
    path.resolve(path.dirname(env.MAB_AUTH_ACTOR_REGISTRY_PATH))
  ];
  const missingMounts: string[] = [];

  for (const mountTarget of mountTargets) {
    if (!(await isPathMounted(mountTarget))) {
      missingMounts.push(mountTarget);
    }
  }

  if (missingMounts.length === 0) {
    return {
      name: "storage_mounts",
      status: "pass",
      message:
        "Canonical, staging, state, and config paths are mount-backed inside the container."
    };
  }

  return {
    name: "storage_mounts",
    status: "fail",
    message: `Docker MCP session mode requires mount-backed canonical, staging, state, and config paths. Missing mount coverage: ${missingMounts.join(", ")}.`,
    details: {
      missingMounts
    }
  };
}

async function buildAuthRegistryCheck(
  rawEnv: NodeJS.ProcessEnv,
  parsedEnv: ParsedEnvironment
): Promise<DockerMcpSessionStartupCheck> {
  try {
    const env = loadEnvironment(rawEnv);
    const matchingEntry = env.auth.actorRegistry.find(
      (entry) => entry.actorId === parsedEnv.MAB_MCP_DEFAULT_ACTOR_ID
    );
    if (!matchingEntry) {
      return {
        name: "session_actor_binding",
        status: "fail",
        message: `Default MCP session actor '${parsedEnv.MAB_MCP_DEFAULT_ACTOR_ID}' is not present in the actor registry.`,
        details: {
          actorRegistryPath: parsedEnv.MAB_AUTH_ACTOR_REGISTRY_PATH
        }
      };
    }

    if (matchingEntry.actorRole !== parsedEnv.MAB_MCP_DEFAULT_ACTOR_ROLE) {
      return {
        name: "session_actor_binding",
        status: "fail",
        message: `Default MCP session actor role '${parsedEnv.MAB_MCP_DEFAULT_ACTOR_ROLE}' does not match registry role '${matchingEntry.actorRole}'.`,
        details: {
          actorId: parsedEnv.MAB_MCP_DEFAULT_ACTOR_ID
        }
      };
    }

    const validTokens = new Set<string>();
    if (matchingEntry.authToken) {
      validTokens.add(matchingEntry.authToken);
    }
    for (const credential of matchingEntry.authTokens ?? []) {
      validTokens.add(
        typeof credential === "string" ? credential : credential.token
      );
    }

    if (!validTokens.has(parsedEnv.MAB_MCP_DEFAULT_ACTOR_AUTH_TOKEN)) {
      return {
        name: "session_actor_binding",
        status: "fail",
        message:
          "Default MCP session actor token does not match a token in the actor registry entry.",
        details: {
          actorId: parsedEnv.MAB_MCP_DEFAULT_ACTOR_ID,
          actorRegistryPath: parsedEnv.MAB_AUTH_ACTOR_REGISTRY_PATH
        }
      };
    }

    return {
      name: "session_actor_binding",
      status: "pass",
      message:
        "Default MCP session actor identity and token match the file-backed actor registry."
    };
  } catch (error) {
    return {
      name: "session_actor_binding",
      status: "fail",
      message: "Actor registry could not be loaded for Docker MCP session startup.",
      details: {
        reason: error instanceof Error ? error.message : String(error),
        actorRegistryPath: parsedEnv.MAB_AUTH_ACTOR_REGISTRY_PATH
      }
    };
  }
}

async function buildQdrantDependencyCheck(
  env: ParsedEnvironment,
  fetchImplementation: FetchImplementation
): Promise<DockerMcpSessionStartupCheck> {
  try {
    const response = await fetchImplementation(
      new URL(
        `/collections/${env.MAB_QDRANT_COLLECTION}`,
        ensureTrailingSlash(env.MAB_QDRANT_URL)
      ),
      {
        method: "GET",
        headers: {
          accept: "application/json"
        },
        signal: AbortSignal.timeout(2_500)
      }
    );

    if (response.ok || response.status === 404) {
      return {
        name: "qdrant_dependency",
        status: "pass",
        message: `Qdrant at '${env.MAB_QDRANT_URL}' is reachable for collection '${env.MAB_QDRANT_COLLECTION}'.`
      };
    }

    return {
      name: "qdrant_dependency",
      status: "fail",
      message: `Qdrant dependency responded with status ${response.status}.`,
      details: {
        qdrantUrl: env.MAB_QDRANT_URL,
        collection: env.MAB_QDRANT_COLLECTION
      }
    };
  } catch (error) {
    return {
      name: "qdrant_dependency",
      status: "fail",
      message: `Qdrant dependency at '${env.MAB_QDRANT_URL}' is unreachable.`,
      details: {
        reason: error instanceof Error ? error.message : String(error),
        collection: env.MAB_QDRANT_COLLECTION
      }
    };
  }
}

async function buildModelEndpointDependencyCheck(
  rawEnv: NodeJS.ProcessEnv,
  env: ParsedEnvironment,
  fetchImplementation: FetchImplementation
): Promise<DockerMcpSessionStartupCheck> {
  const requiredModels = [
    rawEnv.MAB_ROLE_CODING_PRIMARY_MODEL?.trim(),
    rawEnv.MAB_ROLE_MIMISBRUNNR_PRIMARY_MODEL?.trim(),
    rawEnv.MAB_ROLE_EMBEDDING_PRIMARY_MODEL?.trim(),
    rawEnv.MAB_ROLE_RERANKER_PRIMARY_MODEL?.trim()
  ].filter((value): value is string => Boolean(value));

  try {
    const discoveredModels = await discoverModels(
      env.MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL,
      fetchImplementation
    );
    const missingModels = requiredModels.filter(
      (modelId) => !discoveredModels.has(modelId)
    );

    if (missingModels.length === 0) {
      return {
        name: "model_endpoint_dependency",
        status: "pass",
        message:
          "Docker/Ollama-compatible model endpoint is reachable and exposes every required model binding."
      };
    }

    return {
      name: "model_endpoint_dependency",
      status: "fail",
      message: `Model endpoint is reachable but missing required models: ${missingModels.join(", ")}.`,
      details: {
        requiredModels,
        discoveredModels: [...discoveredModels]
      }
    };
  } catch (error) {
    return {
      name: "model_endpoint_dependency",
      status: "fail",
      message:
        "Docker/Ollama-compatible model endpoint could not be validated through a supported model-list API.",
      details: {
        reason: error instanceof Error ? error.message : String(error),
        baseUrl: env.MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL,
        requiredModels
      }
    };
  }
}

async function buildCodingRuntimeDependencyCheck(
  env: ParsedEnvironment,
  checkExecutable: (
    executable: string
  ) => Promise<{ ok: boolean; detail: string }>
): Promise<DockerMcpSessionStartupCheck> {
  const executableCheck = await checkExecutable(
    env.MAB_CODING_RUNTIME_PYTHON_EXECUTABLE
  );
  if (!executableCheck.ok) {
    return {
      name: "coding_runtime_dependency",
      status: "fail",
      message: `Coding runtime Python executable '${env.MAB_CODING_RUNTIME_PYTHON_EXECUTABLE}' is unavailable.`,
      details: {
        reason: executableCheck.detail
      }
    };
  }

  return {
    name: "coding_runtime_dependency",
    status: "pass",
    message: `Coding runtime Python executable is available (${executableCheck.detail}).`
  };
}

function parseRawEnvironment(env: NodeJS.ProcessEnv): ParsedEnvironment {
  return {
    MAB_AUTH_ACTOR_REGISTRY_PATH: env.MAB_AUTH_ACTOR_REGISTRY_PATH!.trim(),
    MAB_CODING_RUNTIME_MODULE: env.MAB_CODING_RUNTIME_MODULE!.trim(),
    MAB_CODING_RUNTIME_PYTHONPATH: env.MAB_CODING_RUNTIME_PYTHONPATH!.trim(),
    MAB_MCP_DEFAULT_ACTOR_AUTH_TOKEN:
      env.MAB_MCP_DEFAULT_ACTOR_AUTH_TOKEN!.trim(),
    MAB_MCP_DEFAULT_ACTOR_ID: env.MAB_MCP_DEFAULT_ACTOR_ID!.trim(),
    MAB_MCP_DEFAULT_ACTOR_ROLE: env.MAB_MCP_DEFAULT_ACTOR_ROLE!.trim(),
    MAB_MCP_DEFAULT_SOURCE: env.MAB_MCP_DEFAULT_SOURCE?.trim() || undefined,
    MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL:
      env.MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL!.trim(),
    MAB_QDRANT_COLLECTION: env.MAB_QDRANT_COLLECTION!.trim(),
    MAB_QDRANT_URL: env.MAB_QDRANT_URL!.trim(),
    MAB_SQLITE_PATH: env.MAB_SQLITE_PATH!.trim(),
    MAB_STAGING_ROOT: env.MAB_STAGING_ROOT!.trim(),
    MAB_VAULT_ROOT: env.MAB_VAULT_ROOT!.trim(),
    MAB_CODING_RUNTIME_PYTHON_EXECUTABLE:
      env.MAB_CODING_RUNTIME_PYTHON_EXECUTABLE!.trim()
  };
}

async function ensureDirectoryExists(
  directoryPath: string,
  label: string
): Promise<string[]> {
  try {
    const stats = await stat(directoryPath);
    if (!stats.isDirectory()) {
      return [`${label} '${directoryPath}' must be an existing directory.`];
    }
    await access(directoryPath, constants.R_OK | constants.W_OK);
    return [];
  } catch (error) {
    return [
      `${label} '${directoryPath}' must exist and be readable/writable (${error instanceof Error ? error.message : String(error)}).`
    ];
  }
}

async function ensureFileExists(filePath: string, label: string): Promise<string[]> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return [`${label} '${filePath}' must be an existing file.`];
    }
    await access(filePath, constants.R_OK);
    return [];
  } catch (error) {
    return [
      `${label} '${filePath}' must exist and be readable (${error instanceof Error ? error.message : String(error)}).`
    ];
  }
}

async function ensurePythonModuleExists(
  pythonPath: string,
  moduleName: string
): Promise<string[]> {
  const relativePath = moduleName.replaceAll(".", path.sep);
  const candidateFiles = [
    path.join(pythonPath, `${relativePath}.py`),
    path.join(pythonPath, relativePath, "__init__.py")
  ];

  for (const candidateFile of candidateFiles) {
    try {
      const stats = await stat(candidateFile);
      if (stats.isFile()) {
        return [];
      }
    } catch {
      // continue
    }
  }

  return [
    `Coding runtime module '${moduleName}' was not found under '${pythonPath}'.`
  ];
}

function pathsOverlap(leftPath: string, rightPath: string): boolean {
  return (
    leftPath === rightPath ||
    leftPath.startsWith(`${rightPath}${path.sep}`) ||
    rightPath.startsWith(`${leftPath}${path.sep}`)
  );
}

async function discoverModels(
  baseUrl: string,
  fetchImplementation: FetchImplementation
): Promise<Set<string>> {
  const attempts = [
    {
      path: "/api/tags",
      parse: parseOllamaTagResponse
    },
    {
      path: "/models",
      parse: parseGenericModelListResponse
    },
    {
      path: "/v1/models",
      parse: parseOpenAiModelListResponse
    }
  ] as const;
  const failures: string[] = [];

  for (const attempt of attempts) {
    try {
      const response = await fetchImplementation(
        new URL(attempt.path, ensureTrailingSlash(baseUrl)),
        {
          method: "GET",
          headers: {
            accept: "application/json"
          },
          signal: AbortSignal.timeout(2_500)
        }
      );

      if (response.status === 404) {
        failures.push(`${attempt.path} returned 404.`);
        continue;
      }

      if (!response.ok) {
        failures.push(`${attempt.path} returned ${response.status}.`);
        continue;
      }

      const payload = await response.json();
      const models = attempt.parse(payload);
      if (models.size === 0) {
        failures.push(`${attempt.path} returned no model IDs.`);
        continue;
      }

      return models;
    } catch (error) {
      failures.push(
        `${attempt.path} failed (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }

  throw new Error(failures.join(" "));
}

function parseOllamaTagResponse(payload: unknown): Set<string> {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("models" in payload) ||
    !Array.isArray((payload as { models?: unknown[] }).models)
  ) {
    return new Set();
  }

  const names = (payload as { models: Array<{ name?: unknown }> }).models
    .map((entry) => (typeof entry.name === "string" ? entry.name : undefined))
    .filter((value): value is string => Boolean(value?.trim()));
  return new Set(names.map((value) => value.trim()));
}

function parseOpenAiModelListResponse(payload: unknown): Set<string> {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("data" in payload) ||
    !Array.isArray((payload as { data?: unknown[] }).data)
  ) {
    return new Set();
  }

  const ids = (payload as { data: Array<{ id?: unknown }> }).data
    .map((entry) => (typeof entry.id === "string" ? entry.id : undefined))
    .filter((value): value is string => Boolean(value?.trim()));
  return new Set(ids.map((value) => value.trim()));
}

function parseGenericModelListResponse(payload: unknown): Set<string> {
  if (Array.isArray(payload)) {
    return new Set(
      payload
        .map((entry) => extractModelIdentifier(entry))
        .filter((value): value is string => Boolean(value?.trim()))
    );
  }

  if (!payload || typeof payload !== "object") {
    return new Set();
  }

  const objectPayload = payload as {
    models?: unknown[];
    data?: unknown[];
  };
  const candidates = [
    ...(Array.isArray(objectPayload.models) ? objectPayload.models : []),
    ...(Array.isArray(objectPayload.data) ? objectPayload.data : [])
  ];
  return new Set(
    candidates
      .map((entry) => extractModelIdentifier(entry))
      .filter((value): value is string => Boolean(value?.trim()))
  );
}

function extractModelIdentifier(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as {
    id?: unknown;
    model?: unknown;
    name?: unknown;
  };
  if (typeof candidate.id === "string" && candidate.id.trim()) {
    return candidate.id.trim();
  }
  if (typeof candidate.model === "string" && candidate.model.trim()) {
    return candidate.model.trim();
  }
  if (typeof candidate.name === "string" && candidate.name.trim()) {
    return candidate.name.trim();
  }
  return undefined;
}

async function checkPythonExecutable(
  executable: string
): Promise<{ ok: boolean; detail: string }> {
  const args =
    path.basename(executable).toLowerCase() === "py"
      ? ["-3", "--version"]
      : ["--version"];

  return await new Promise((resolve) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", (error) => {
      resolve({
        ok: false,
        detail: error.message
      });
    });
    child.once("close", (code) => {
      resolve({
        ok: code === 0,
        detail: output.trim() || `exit code ${code ?? "unknown"}`
      });
    });
  });
}

async function isPathMountedInsideContainer(
  candidatePath: string
): Promise<boolean> {
  try {
    const mountInfo = await readFile("/proc/self/mountinfo", "utf8");
    const mountPoints = mountInfo
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(" ")[4])
      .filter((value): value is string => Boolean(value))
      .map((value) => path.posix.normalize(value))
      .sort((left, right) => right.length - left.length);

    const normalizedCandidate = path.posix.normalize(
      candidatePath.replaceAll("\\", "/")
    );
    const matchingMount = mountPoints.find(
      (mountPoint) =>
        normalizedCandidate === mountPoint ||
        normalizedCandidate.startsWith(`${mountPoint}/`)
    );

    return Boolean(matchingMount && matchingMount !== "/");
  } catch {
    return false;
  }
}

function parseBooleanStrict(value: string | undefined): boolean | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function finalizeReport(
  checks: DockerMcpSessionStartupCheck[]
): DockerMcpSessionStartupReport {
  return {
    ok: checks.every((check) => check.status === "pass"),
    checkedAt: new Date().toISOString(),
    checks
  };
}
