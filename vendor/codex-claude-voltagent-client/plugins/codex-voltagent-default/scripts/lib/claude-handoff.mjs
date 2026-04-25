import { readFileSync } from "node:fs";
import { loadClientModule } from "./plugin-runtime-paths.mjs";

export function parseClaudeHandoffArgs(argv, options = {}) {
  const parsed = {
    configPath: undefined,
    profileId: undefined,
    reason: undefined,
    taskSummary: undefined,
    repoContext: undefined,
    relevantFiles: [],
    escalationDepth: 1
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--config") {
      parsed.configPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--profile") {
      parsed.profileId = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--reason") {
      parsed.reason = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--task-summary") {
      parsed.taskSummary = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--repo-context") {
      parsed.repoContext = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--relevant-file") {
      parsed.relevantFiles.push(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--escalation-depth") {
      parsed.escalationDepth = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  const missing = [
    !parsed.configPath && "--config",
    options.requireProfile !== false && !parsed.profileId && "--profile",
    !parsed.reason && "--reason",
    !parsed.taskSummary && "--task-summary",
    !parsed.repoContext && "--repo-context"
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required`);
  }

  return parsed;
}

export async function loadClaudeRuntimeContext(configPath) {
  const { loadClientConfig } = await loadClientModule(
    "dist/config/load-client-config.js",
    { fromImportMetaUrl: import.meta.url }
  );
  const { createClaudeProfileRegistry } = await loadClientModule(
    "dist/escalation/claude-profile-registry.js",
    { fromImportMetaUrl: import.meta.url }
  );
  const rawConfig = JSON.parse(readFileSync(configPath, "utf8"));
  const config = loadClientConfig(rawConfig);

  if (!config.claude.enabled) {
    throw new Error("Claude escalation is disabled in the client config");
  }

  if (
    config.runtime.mode !== "voltagent+claude-manual" &&
    config.runtime.mode !== "voltagent+claude-auto"
  ) {
    throw new Error(
      `Runtime mode ${config.runtime.mode} does not permit Claude escalation`
    );
  }

  const registry = createClaudeProfileRegistry(config.claude);

  return {
    config,
    registry
  };
}

export function assertEscalationDepth(escalationDepth) {
  if (escalationDepth !== 1) {
    throw new Error("Claude escalation depth must be 1");
  }
}

export function resolveExplicitProfile(registry, profileId, reason) {
  const resolved = registry.getProfile(profileId);

  if (!resolved.profile.escalationReasons.includes(reason)) {
    throw new Error(
      `Escalation reason ${reason} is not allowed for profile ${profileId}`
    );
  }

  return resolved;
}

export function resolveAutoProfile(registry, reason) {
  const matches = registry.findProfilesForReason(reason);

  if (matches.length === 0) {
    throw new Error(`No Claude profile allows escalation reason ${reason}`);
  }

  if (matches.length > 1) {
    throw new Error(
      `Multiple Claude profiles allow escalation reason ${reason}; choose one explicitly`
    );
  }

  return matches[0];
}

export function createExpectedOutputSchema(profile) {
  return profile.outputMode === "structured"
    ? "claude_profile_structured_response_v1"
    : "claude_profile_text_response_v1";
}

export function createClaudeHandoffEnvelope(resolved, args) {
  return {
    schemaVersion: 1,
    escalationReason: args.reason,
    profileId: resolved.profile.profileId,
    roleId: resolved.profile.roleId,
    skillPackId: resolved.skillPack.skillPackId,
    skillPack: {
      skills: resolved.skillPack.skills
    },
    model: {
      primary: resolved.profile.model,
      fallback: resolved.profile.fallback
    },
    expectedOutputSchema: createExpectedOutputSchema(resolved.profile),
    recursion: {
      currentDepth: args.escalationDepth,
      maxDepth: 1,
      allowFurtherClaudeEscalation: false
    },
    execution: {
      outputMode: resolved.profile.outputMode,
      retries: resolved.profile.retries,
      timeouts: resolved.profile.timeouts
    },
    input: {
      taskSummary: args.taskSummary,
      repoContext: args.repoContext,
      relevantFiles: args.relevantFiles
    }
  };
}
