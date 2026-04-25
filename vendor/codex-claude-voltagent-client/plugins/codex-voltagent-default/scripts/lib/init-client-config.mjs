import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadClientModule } from "./plugin-runtime-paths.mjs";

const allowedModes = new Set([
  "local-only",
  "voltagent-default",
  "voltagent+claude-manual",
  "voltagent+claude-auto"
]);

const defaultPrimaryModel = "openai/gpt-5-mini";
const defaultFallbackModels = ["anthropic/claude-sonnet-4-20250514"];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function defaultCodexConfigPath(homeRoot = homedir()) {
  return join(homeRoot, ".codex", "config.toml");
}

function parseTomlString(value, path) {
  const trimmed = value.trim();

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed);
  }

  throw new Error(`${path} must be a TOML string`);
}

function parseTomlStringArray(value, path) {
  const trimmed = value.trim();

  if (trimmed === "[]") {
    return [];
  }

  assert(
    trimmed.startsWith("[") && trimmed.endsWith("]"),
    `${path} must be a TOML array`
  );

  const matches = trimmed.match(/'(?:[^']|'')*'|"(?:[^"\\]|\\.)*"/g) ?? [];

  return matches.map((entry, index) =>
    parseTomlString(entry, `${path}[${index}]`)
  );
}

function readCodexMimirConfig(homeRoot = homedir()) {
  const codexConfigPath = defaultCodexConfigPath(homeRoot);

  if (!existsSync(codexConfigPath)) {
    return null;
  }

  const lines = readFileSync(codexConfigPath, "utf8").split(/\r?\n/u);
  let currentTable = "";
  let command;
  let args = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      currentTable = line.slice(1, -1).trim();
      continue;
    }

    if (currentTable !== "mcp_servers.mimir") {
      continue;
    }

    const equalsIndex = line.indexOf("=");

    if (equalsIndex < 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();

    if (key === "command") {
      command = parseTomlString(value, "mcp_servers.mimir.command");
      continue;
    }

    if (key === "args") {
      args = parseTomlStringArray(value, "mcp_servers.mimir.args");
    }
  }

  if (!command) {
    return null;
  }

  return {
    command,
    args
  };
}

export function parseInitArgs(argv, options = {}) {
  const homeRoot = resolve(options.homeRoot ?? homedir());
  const parsed = {
    configPath: undefined,
    workspaceRoot: resolve(process.cwd()),
    mode: "voltagent-default",
    mimirCommand: undefined,
    mimirArgs: [],
    skillRoots: [],
    primaryModel: defaultPrimaryModel,
    fallbackModels: [...defaultFallbackModels],
    force: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--") {
      continue;
    }

    if (token === "--config") {
      parsed.configPath = resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--workspace") {
      parsed.workspaceRoot = resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--mode") {
      parsed.mode = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--mimir-command") {
      parsed.mimirCommand = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--mimir-arg") {
      parsed.mimirArgs.push(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--skill-root") {
      parsed.skillRoots.push(resolve(argv[index + 1]));
      index += 1;
      continue;
    }

    if (token === "--primary-model") {
      parsed.primaryModel = argv[index + 1];
      index += 1;
      continue;
    }

    if (token === "--fallback-model") {
      parsed.fallbackModels.push(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === "--force") {
      parsed.force = true;
      continue;
    }

    if (options.allowUnknown) {
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!parsed.mimirCommand) {
    const codexMimir = readCodexMimirConfig(homeRoot);

    if (codexMimir) {
      parsed.mimirCommand = codexMimir.command;

      if (parsed.mimirArgs.length === 0) {
        parsed.mimirArgs = codexMimir.args;
      }
    }
  }

  assert(
    parsed.mimirCommand,
    "--mimir-command is required unless ~/.codex/config.toml defines mcp_servers.mimir"
  );
  assert(allowedModes.has(parsed.mode), `Unsupported runtime mode: ${parsed.mode}`);

  if (parsed.skillRoots.length === 0) {
    parsed.skillRoots.push(join(homeRoot, ".codex", "skills"));
  }

  if (parsed.mode === "local-only") {
    parsed.workspaceRoot = undefined;
  }

  if (!parsed.configPath) {
    parsed.configPath = resolve(
      parsed.workspaceRoot ?? process.cwd(),
      "client-config.json"
    );
  }

  return parsed;
}

function createDefaultClaudeSkillPacks() {
  return [
    {
      skillPackId: "design-core",
      skills: [
        "superpowers:brainstorming",
        "superpowers:writing-plans"
      ]
    },
    {
      skillPackId: "review-core",
      skills: [
        "superpowers:requesting-code-review",
        "superpowers:verification-before-completion"
      ]
    },
    {
      skillPackId: "debug-core",
      skills: [
        "superpowers:systematic-debugging",
        "superpowers:test-driven-development"
      ]
    },
    {
      skillPackId: "release-core",
      skills: [
        "superpowers:verification-before-completion",
        "superpowers:requesting-code-review"
      ]
    }
  ];
}

function createDefaultClaudeProfiles(primaryModel) {
  return [
    {
      profileId: "design-advisor",
      roleId: "design_advisor",
      skillPackId: "design-core",
      model: "anthropic/claude-sonnet-4-20250514",
      fallback: [primaryModel],
      escalationReasons: ["design-ambiguity", "planning-needed"],
      outputMode: "structured",
      timeouts: {
        totalMs: 30000,
        modelMs: 20000
      },
      retries: 1
    },
    {
      profileId: "implementation-reviewer",
      roleId: "implementation_reviewer",
      skillPackId: "review-core",
      model: "anthropic/claude-sonnet-4-20250514",
      fallback: [primaryModel],
      escalationReasons: ["implementation-review", "risky-multifile-change"],
      outputMode: "structured",
      timeouts: {
        totalMs: 30000,
        modelMs: 20000
      },
      retries: 1
    },
    {
      profileId: "debug-specialist",
      roleId: "debug_specialist",
      skillPackId: "debug-core",
      model: "anthropic/claude-sonnet-4-20250514",
      fallback: [primaryModel],
      escalationReasons: ["test-failure", "runtime-regression"],
      outputMode: "structured",
      timeouts: {
        totalMs: 30000,
        modelMs: 20000
      },
      retries: 1
    },
    {
      profileId: "release-reviewer",
      roleId: "release_reviewer",
      skillPackId: "release-core",
      model: "anthropic/claude-sonnet-4-20250514",
      fallback: [primaryModel],
      escalationReasons: ["pre-release-review", "merge-readiness"],
      outputMode: "structured",
      timeouts: {
        totalMs: 30000,
        modelMs: 20000
      },
      retries: 1
    }
  ];
}

function buildClaudeConfig(mode, primaryModel) {
  if (
    mode !== "voltagent+claude-manual" &&
    mode !== "voltagent+claude-auto"
  ) {
    return {
      enabled: false,
      skillPacks: [],
      profiles: []
    };
  }

  return {
    enabled: true,
    skillPacks: createDefaultClaudeSkillPacks(),
    profiles: createDefaultClaudeProfiles(primaryModel)
  };
}

export async function createValidatedClientConfig(args) {
  const { loadClientConfig } = await loadClientModule(
    "dist/config/load-client-config.js",
    { fromImportMetaUrl: import.meta.url }
  );
  const config = {
    configVersion: 1,
    mimir: {
      serverCommand: [args.mimirCommand],
      serverArgs: args.mimirArgs,
      transport: "stdio"
    },
    skills: {
      rootPaths: args.skillRoots
    },
    models: {
      primary: args.primaryModel,
      fallback: args.fallbackModels
    },
    runtime: {
      mode: args.mode,
      trustedWorkspaceRoots: args.workspaceRoot ? [args.workspaceRoot] : []
    },
    claude: buildClaudeConfig(args.mode, args.primaryModel)
  };

  return loadClientConfig(config);
}

export function writeClientConfigFile(configPath, config, force) {
  if (existsSync(configPath) && !force) {
    throw new Error(`${configPath} already exists; rerun with --force to overwrite`);
  }

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
