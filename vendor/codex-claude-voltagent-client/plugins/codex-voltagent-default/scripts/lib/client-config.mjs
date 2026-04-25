import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireBuiltClientRoot } from "./plugin-runtime-paths.mjs";

const allowedModes = new Set([
  "local-only",
  "voltagent-default",
  "voltagent+claude-manual",
  "voltagent+claude-auto"
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function expectNonBlankString(value, path) {
  assert(isNonBlankString(value), `${path} must be a non-blank string`);
  return value;
}

function expectStringArray(value, path) {
  assert(Array.isArray(value), `${path} must be an array`);
  for (const [index, entry] of value.entries()) {
    expectNonBlankString(entry, `${path}[${index}]`);
  }
  return value;
}

function expectObject(value, path) {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${path} must be an object`
  );
  return value;
}

function normalizePathForComparison(pathValue) {
  return resolve(pathValue).replace(/\\/g, "/").toLowerCase();
}

function nativeCodexSkillsRoot(homeRoot = homedir()) {
  return join(homeRoot, ".codex", "skills");
}

function codexConfigPath(homeRoot = homedir()) {
  return join(homeRoot, ".codex", "config.toml");
}

export function defaultHomeGlobalConfigPath(homeRoot = homedir()) {
  return join(homeRoot, ".codex", "voltagent", "client-config.json");
}

function nativeCodexInstallPath(homeRoot = homedir()) {
  return join(nativeCodexSkillsRoot(homeRoot), "voltagent-default");
}

let lastResolvedConfigContext = null;

function rememberResolvedConfigContext(context) {
  lastResolvedConfigContext = {
    configPath: resolve(context.configPath),
    configSource: context.configSource,
    workspaceRoot: context.workspaceRoot ? resolve(context.workspaceRoot) : null,
    homeRoot: resolve(context.homeRoot ?? homedir())
  };

  return lastResolvedConfigContext;
}

function currentResolvedConfigContext() {
  return lastResolvedConfigContext;
}

function inferResolvedConfigContext(configPath, options = {}) {
  const resolvedHomeRoot = resolve(options.homeRoot ?? homedir());
  const resolvedConfigPath = resolve(configPath);
  const homeGlobalConfigPath = resolve(
    defaultHomeGlobalConfigPath(resolvedHomeRoot)
  );

  return {
    configPath: resolvedConfigPath,
    configSource:
      normalizePathForComparison(resolvedConfigPath) ===
      normalizePathForComparison(homeGlobalConfigPath)
        ? "home-global-default"
        : "workspace-override",
    workspaceRoot: options.workspaceRoot
      ? resolve(options.workspaceRoot)
      : dirname(resolvedConfigPath),
    homeRoot: resolvedHomeRoot
  };
}

function usesNativeCodexSkills(skillRoots, homeRoot = homedir()) {
  const expectedRoot = normalizePathForComparison(nativeCodexSkillsRoot(homeRoot));

  return skillRoots.some(
    (skillRoot) => normalizePathForComparison(skillRoot) === expectedRoot
  );
}

function createActivationStatus(config, options = {}) {
  const homeRoot = options.homeRoot ?? homedir();
  const nativeCodexSkillsConfigured = usesNativeCodexSkills(
    config.skills.rootPaths,
    homeRoot
  );
  const nativeCodexInstallPresent =
    options.nativeCodexInstallPresent ?? nativeCodexSkillsConfigured;
  const pluginShellPresent = options.pluginShellPresent ?? true;

  let surface = "unconfigured";

  if (nativeCodexSkillsConfigured && nativeCodexInstallPresent && pluginShellPresent) {
    surface = "both";
  } else if (nativeCodexSkillsConfigured && nativeCodexInstallPresent) {
    surface = "native-skills-only";
  } else if (nativeCodexSkillsConfigured) {
    surface = pluginShellPresent
      ? "plugin-shell-plus-configured-native"
      : "native-skills-configured";
  } else if (pluginShellPresent) {
    surface = "plugin-shell-only";
  }

  return {
    nativeCodexSkillsConfigured,
    nativeCodexInstallPresent,
    pluginShellPresent,
    surface
  };
}

function providerEnvVarForModel(modelId) {
  const providerId = modelId.split("/", 1)[0];

  switch (providerId) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "google":
      return "GOOGLE_GENERATIVE_AI_API_KEY";
    case "groq":
      return "GROQ_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "xai":
      return "XAI_API_KEY";
    case "perplexity":
      return "PERPLEXITY_API_KEY";
    default:
      return null;
  }
}

function collectActiveProviderRequirements(config) {
  if (config.runtime.mode === "local-only") {
    return [];
  }

  const activeModels = new Set([
    config.models.primary,
    ...config.models.fallback
  ]);

  if (config.claude.enabled) {
    for (const profile of config.claude.profiles) {
      activeModels.add(profile.model);
      for (const fallbackModel of profile.fallback) {
        activeModels.add(fallbackModel);
      }
    }
  }

  const requirements = new Map();

  for (const modelId of activeModels) {
    const envVar = providerEnvVarForModel(modelId);

    if (!envVar) {
      continue;
    }

    if (!requirements.has(envVar)) {
      requirements.set(envVar, []);
    }

    requirements.get(envVar).push(modelId);
  }

  return Array.from(requirements, ([envVar, models]) => ({
    envVar,
    models
  }));
}

function findMissingProfileSkillIds(config) {
  const missing = [];

  for (const skillPack of config.claude.skillPacks) {
    for (const skillId of skillPack.skills) {
      const [namespace, name] = skillId.includes(":")
        ? skillId.split(":", 2)
        : [null, skillId];
      const found = config.skills.rootPaths.some((rootPath) => {
        const candidate = namespace
          ? join(rootPath, namespace, name, "SKILL.md")
          : join(rootPath, name, "SKILL.md");

        return existsSync(candidate);
      });

      if (!found) {
        missing.push(skillId);
      }
    }
  }

  return missing;
}

function isResolvableCommand(command) {
  if (!command || command.trim().length === 0) {
    return false;
  }

  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command);
  }

  return true;
}

export function parseCliArgs(argv) {
  const parsed = {
    configPath: undefined,
    homeRoot: resolve(homedir()),
    workspaceRoot: resolve(process.cwd()),
    probeRuntime: false,
    stateRoot: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--config") {
      parsed.configPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--workspace") {
      parsed.workspaceRoot = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--home-root") {
      parsed.homeRoot = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--probe-runtime") {
      parsed.probeRuntime = true;
      continue;
    }

    if (token === "--state-root") {
      parsed.stateRoot = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return {
    ...parsed,
    ...rememberResolvedConfigContext(
      resolveClientConfigPath({
      explicitConfigPath: parsed.configPath,
      workspaceRoot: parsed.workspaceRoot,
      homeRoot: parsed.homeRoot
      })
    )
  };
}

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = dirname(currentFilePath);
const probeHelperPath = join(currentDirPath, "client-composition-probe.mjs");

export function readClientConfig(configPath) {
  const resolvedConfigPath = resolve(configPath);
  const priorContext = currentResolvedConfigContext();
  const matchingPriorContext =
    priorContext &&
    normalizePathForComparison(priorContext.configPath) ===
      normalizePathForComparison(resolvedConfigPath)
      ? priorContext
      : null;

  let resolvedContext = matchingPriorContext;

  if (!existsSync(resolvedConfigPath)) {
    if (matchingPriorContext?.configSource === "explicit") {
      throw new Error(`Config file does not exist: ${resolvedConfigPath}`);
    }

    resolvedContext = resolveClientConfigPath({
      workspaceRoot: dirname(resolvedConfigPath),
      homeRoot: matchingPriorContext?.homeRoot ?? homedir()
    });
  } else if (!resolvedContext) {
    resolvedContext = inferResolvedConfigContext(resolvedConfigPath, {
      homeRoot: matchingPriorContext?.homeRoot
    });
  }

  resolvedContext = rememberResolvedConfigContext(
    resolvedContext ?? inferResolvedConfigContext(resolvedConfigPath)
  );

  const rawConfig = JSON.parse(
    readFileSync(resolvedContext.configPath, "utf8")
  );
  const config = expectObject(rawConfig, "config");
  const runtime = expectObject(config.runtime ?? {}, "runtime");
  const mimir = expectObject(config.mimir, "mimir");
  const skills = expectObject(config.skills, "skills");
  const models = expectObject(config.models, "models");
  const claude = expectObject(config.claude ?? {}, "claude");

  const mode = runtime.mode ?? "local-only";
  const workspaceTrustMode = runtime.workspaceTrustMode ?? "explicit-roots";

  assert(mode && allowedModes.has(mode), "runtime.mode must be a supported mode");
  assert(
    workspaceTrustMode === "all-workspaces" ||
      workspaceTrustMode === "explicit-roots",
    "runtime.workspaceTrustMode must be all-workspaces or explicit-roots"
  );

  const parsed = {
    configVersion: config.configVersion ?? 1,
    mimir: {
      serverCommand: expectStringArray(mimir.serverCommand, "mimir.serverCommand"),
      serverArgs: expectStringArray(mimir.serverArgs ?? [], "mimir.serverArgs"),
      transport: mimir.transport ?? "stdio"
    },
    skills: {
      rootPaths: expectStringArray(skills.rootPaths, "skills.rootPaths")
    },
    models: {
      primary: expectNonBlankString(models.primary, "models.primary"),
      fallback: expectStringArray(models.fallback ?? [], "models.fallback")
    },
    runtime: {
      mode,
      workspaceTrustMode,
      trustedWorkspaceRoots: expectStringArray(
        runtime.trustedWorkspaceRoots ?? [],
        "runtime.trustedWorkspaceRoots"
      )
    },
    claude: {
      enabled: Boolean(claude.enabled),
      skillPacks: Array.isArray(claude.skillPacks) ? claude.skillPacks : [],
      profiles: Array.isArray(claude.profiles) ? claude.profiles : []
    }
  };

  assert(parsed.configVersion === 1, "configVersion must be 1");
  assert(parsed.mimir.transport === "stdio", "mimir.transport must be stdio");

  if (
    parsed.runtime.mode !== "local-only" &&
    parsed.runtime.workspaceTrustMode === "explicit-roots" &&
    parsed.runtime.trustedWorkspaceRoots.length === 0
  ) {
    throw new Error(
      "runtime.trustedWorkspaceRoots must contain at least one workspace root when runtime.workspaceTrustMode is explicit-roots"
    );
  }

  if (
    (parsed.runtime.mode === "voltagent+claude-manual" ||
      parsed.runtime.mode === "voltagent+claude-auto") &&
    !parsed.claude.enabled
  ) {
    throw new Error(
      "claude.enabled must be true when runtime mode uses Claude escalation"
    );
  }

  return parsed;
}

export function resolveClientConfigPath({
  explicitConfigPath,
  workspaceRoot,
  homeRoot = homedir()
}) {
  const resolvedHomeRoot = resolve(homeRoot);
  const resolvedWorkspaceRoot = resolve(workspaceRoot ?? process.cwd());

  if (explicitConfigPath) {
    return {
      configPath: resolve(explicitConfigPath),
      configSource: "explicit",
      workspaceRoot: resolvedWorkspaceRoot,
      homeRoot: resolvedHomeRoot
    };
  }

  const workspaceConfigPath = resolve(resolvedWorkspaceRoot, "client-config.json");

  if (existsSync(workspaceConfigPath)) {
    return {
      configPath: workspaceConfigPath,
      configSource: "workspace-override",
      workspaceRoot: resolvedWorkspaceRoot,
      homeRoot: resolvedHomeRoot
    };
  }

  return {
    configPath: resolve(defaultHomeGlobalConfigPath(resolvedHomeRoot)),
    configSource: "home-global-default",
    workspaceRoot: resolvedWorkspaceRoot,
    homeRoot: resolvedHomeRoot
  };
}

export function isTrustedWorkspace(runtime, workspaceRoot) {
  if (runtime.workspaceTrustMode === "all-workspaces") {
    return Boolean(workspaceRoot);
  }

  if (!workspaceRoot) {
    return false;
  }

  const normalizedWorkspaceRoot = normalizePathForComparison(workspaceRoot);

  return runtime.trustedWorkspaceRoots.some((trustedRoot) => {
    const normalizedTrustedRoot = normalizePathForComparison(trustedRoot);

    return (
      normalizedWorkspaceRoot === normalizedTrustedRoot ||
      normalizedWorkspaceRoot.startsWith(`${normalizedTrustedRoot}/`)
    );
  });
}

export function createStatus(config, input = {}) {
  const resolvedContext = input.configPath
    ? inferResolvedConfigContext(input.configPath, input)
    : currentResolvedConfigContext();

  return {
    configVersion: config.configVersion,
    configPath: resolvedContext?.configPath ?? null,
    configSource: input.configSource ?? resolvedContext?.configSource ?? null,
    mode: config.runtime.mode,
    workspaceTrustMode: config.runtime.workspaceTrustMode,
    workspaceTrusted: isTrustedWorkspace(config.runtime, input.workspaceRoot),
    workspaceOverrideActive:
      (input.configSource ?? resolvedContext?.configSource) ===
      "workspace-override",
    trustedWorkspaceRoots: config.runtime.trustedWorkspaceRoots,
    runtimeHealth: input.runtimeHealth ?? "stopped",
    mimirConnection: input.mimirConnection ?? "disconnected",
    activation: createActivationStatus(config, {
      ...input,
      homeRoot: input.homeRoot ?? resolvedContext?.homeRoot
    }),
    models: {
      primary: config.models.primary,
      fallback: config.models.fallback
    },
    claude: {
      enabled: config.claude.enabled,
      profileIds: config.claude.profiles.map((profile) => profile.profileId),
      skillPackIds: config.claude.skillPacks.map(
        (skillPack) => skillPack.skillPackId
      )
    }
  };
}

export function createDoctor(config, input = {}) {
  const missingSkillIds = config.claude.enabled
    ? findMissingProfileSkillIds(config)
    : [];
  const providerRequirements = collectActiveProviderRequirements(config);
  const missingProviderEnvVars = providerRequirements.filter(
    ({ envVar }) => !process.env[envVar]
  );
  const status = createStatus(config, input);
  const checks = [
    {
      code: "config_version",
      status: "ok",
      message: "Client config version is supported."
    },
    {
      code: "mimir_stdio",
      status: isResolvableCommand(config.mimir.serverCommand[0]) ? "ok" : "error",
      message: isResolvableCommand(config.mimir.serverCommand[0])
        ? "Mimir stdio command is configured."
        : "Mimir stdio command cannot be resolved."
    },
    {
      code: "skill_roots",
      status:
        config.skills.rootPaths.length > 0 &&
        config.skills.rootPaths.every((rootPath) => existsSync(rootPath))
          ? "ok"
          : "error",
      message:
        config.skills.rootPaths.length > 0 &&
        config.skills.rootPaths.every((rootPath) => existsSync(rootPath))
          ? "At least one existing skill root is configured."
          : "At least one existing skill root is required."
    },
    {
      code: "codex_config",
      status: existsSync(codexConfigPath(input.homeRoot)) ? "ok" : "warning",
      message: existsSync(codexConfigPath(input.homeRoot))
        ? "Codex config file is present."
        : "Codex config file is not present at the default location."
    }
  ];

  if (status.activation.nativeCodexSkillsConfigured) {
    checks.push({
      code: "native_skill_install",
      status: status.activation.nativeCodexInstallPresent ? "ok" : "warning",
      message: status.activation.nativeCodexInstallPresent
        ? "Native Codex VoltAgent skill install is present."
        : `Native Codex VoltAgent skill install is missing at ${nativeCodexInstallPath(
            input.homeRoot
          )}.`
    });
  }

  if (config.runtime.mode === "local-only") {
    checks.push({
      code: "workspace_trust",
      status: "ok",
      message: "Local-only mode does not require a trusted workspace."
    });
  } else if (config.runtime.workspaceTrustMode === "all-workspaces") {
    checks.push({
      code: "workspace_trust",
      status: "ok",
      message: "Global all-workspaces trust mode is active."
    });
  } else if (!input.workspaceRoot) {
    checks.push({
      code: "workspace_trust",
      status: "error",
      message:
        "A workspace root is required to evaluate trust for non-local-only modes."
    });
  } else if (status.workspaceTrusted) {
    checks.push({
      code: "workspace_trust",
      status: "ok",
      message: "Workspace root is trusted for the selected runtime mode."
    });
  } else {
    checks.push({
      code: "workspace_trust",
      status: "error",
      message: "Workspace root is not trusted for the selected runtime mode."
    });
  }

  if (!config.claude.enabled) {
    checks.push({
      code: "claude_profiles",
      status: "ok",
      message: "Claude escalation is disabled."
    });
  } else if (config.claude.profiles.length === 0) {
    checks.push({
      code: "claude_profiles",
      status: "warning",
      message: "Claude escalation is enabled but no profiles are configured."
    });
  } else {
    checks.push({
      code: "claude_profiles",
      status: "ok",
      message: "Claude escalation profiles are configured."
    });

    checks.push({
      code: "claude_skill_ids",
      status: missingSkillIds.length === 0 ? "ok" : "warning",
      message:
        missingSkillIds.length === 0
          ? "Claude profile skill ids resolve against the configured skill roots."
          : `Some Claude profile skill ids are missing from the configured skill roots: ${missingSkillIds.join(", ")}`
    });
  }

  checks.push({
    code: "provider_credentials",
    status: missingProviderEnvVars.length === 0 ? "ok" : "warning",
    message:
      missingProviderEnvVars.length === 0
        ? "Provider credentials appear to be present for the active runtime mode."
        : `Missing provider credentials for the active runtime mode: ${missingProviderEnvVars
            .map(({ envVar }) => envVar)
            .join(", ")}`
  });

  return {
    ok: checks.every((check) => check.status !== "error"),
    mode: config.runtime.mode,
    workspaceRoot: input.workspaceRoot ?? null,
    status,
    checks
  };
}

export function writeClientConfig(configPath, config) {
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function enableDefaultMode(config, workspaceRoot) {
  if (config.runtime.workspaceTrustMode === "all-workspaces") {
    return {
      ...config,
      runtime: {
        ...config.runtime,
        mode: "voltagent-default"
      }
    };
  }

  assert(workspaceRoot, "--workspace is required when enabling default mode");

  const trustedWorkspaceRoots = new Set(config.runtime.trustedWorkspaceRoots);
  trustedWorkspaceRoots.add(workspaceRoot);

  return {
    ...config,
    runtime: {
      ...config.runtime,
      mode: "voltagent-default",
      trustedWorkspaceRoots: Array.from(trustedWorkspaceRoots)
    }
  };
}

export function disableDefaultMode(config) {
  return {
    ...config,
    runtime: {
      ...config.runtime,
      mode: "local-only"
    }
  };
}

export function listProfiles(config) {
  const skillPacksById = new Map(
    config.claude.skillPacks.map((skillPack) => [skillPack.skillPackId, skillPack])
  );

  return config.claude.profiles.map((profile) => ({
    profileId: profile.profileId,
    roleId: profile.roleId,
    skillPackId: profile.skillPackId,
    skills: skillPacksById.get(profile.skillPackId)?.skills ?? [],
    model: profile.model,
    fallback: profile.fallback,
    escalationReasons: profile.escalationReasons,
    outputMode: profile.outputMode
  }));
}

export function parseRouteFlags(argv) {
  const input = {
    needsDurableMemory: false,
    needsLocalExecution: false,
    needsWorkspaceSkill: false,
    needsGovernedWrite: false
  };

  for (const token of argv) {
    switch (token) {
      case "--needs-durable-memory":
        input.needsDurableMemory = true;
        break;
      case "--needs-local-execution":
        input.needsLocalExecution = true;
        break;
      case "--needs-workspace-skill":
        input.needsWorkspaceSkill = true;
        break;
      case "--needs-governed-write":
        input.needsGovernedWrite = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return input;
}

export function classifyRoute(input) {
  if (input.needsGovernedWrite) {
    return "mimir-memory-write";
  }

  if (input.needsLocalExecution) {
    return "mimir-local-execution";
  }

  if (input.needsDurableMemory) {
    return "mimir-retrieval";
  }

  if (input.needsWorkspaceSkill) {
    return "client-skill";
  }

  return "client-paid-runtime";
}

export function runRuntimeProbe({ configPath, workspaceRoot, stateRoot }) {
  assert(workspaceRoot, "--workspace is required when probing the runtime");
  const clientRoot = requireBuiltClientRoot({ fromImportMetaUrl: import.meta.url });

  const stdout = execFileSync(
    process.execPath,
    [
      probeHelperPath,
      "--config",
      resolve(configPath),
      "--workspace",
      resolve(workspaceRoot),
      "--state-root",
      resolve(stateRoot ?? join(tmpdir(), "codex-voltagent-default-state"))
    ],
    {
      cwd: clientRoot,
      encoding: "utf8"
    }
  );

  return JSON.parse(stdout);
}
