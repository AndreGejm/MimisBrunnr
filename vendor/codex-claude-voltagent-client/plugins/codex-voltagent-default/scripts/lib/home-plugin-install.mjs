import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  getPluginRoot,
  requireBuiltClientRoot
} from "./plugin-runtime-paths.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function parseInstallArgs(argv, options = {}) {
  const parsed = {
    homeRoot: homedir()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--home-root") {
      parsed.homeRoot = argv[index + 1];
      index += 1;
      continue;
    }

    if (options.allowUnknown) {
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  assert(parsed.homeRoot, "--home-root must be a non-blank string");

  return {
    homeRoot: resolve(parsed.homeRoot)
  };
}

export function createHomeInstallLayout(options = {}) {
  const pluginRoot =
    options.pluginRoot ?? getPluginRoot(options.fromImportMetaUrl ?? import.meta.url);
  const clientRoot =
    options.clientRoot ??
    requireBuiltClientRoot({
      fromImportMetaUrl: options.fromImportMetaUrl ?? import.meta.url
    });
  const homeRoot = resolve(options.homeRoot ?? homedir());
  const pluginPath = join(homeRoot, "plugins", "codex-voltagent-default");
  const marketplacePath = join(homeRoot, ".agents", "plugins", "marketplace.json");

  return {
    homeRoot,
    clientRoot,
    pluginRoot,
    pluginPath,
    marketplacePath
  };
}

export function syncInstalledPlugin(layout) {
  rmSync(layout.pluginPath, { recursive: true, force: true });
  mkdirSync(dirname(layout.pluginPath), { recursive: true });
  cpSync(layout.pluginRoot, layout.pluginPath, {
    recursive: true,
    force: true
  });
  writeFileSync(
    join(layout.pluginPath, "client-root.json"),
    `${JSON.stringify({ clientRoot: layout.clientRoot }, null, 2)}\n`,
    "utf8"
  );
}

export function updateMarketplace(layout) {
  mkdirSync(dirname(layout.marketplacePath), { recursive: true });

  const existing = readJsonIfExists(layout.marketplacePath);
  const marketplace =
    existing ??
    {
      name: "local-codex-plugins",
      interface: {
        displayName: "Local Codex Plugins"
      },
      plugins: []
    };
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const entry = {
    name: "codex-voltagent-default",
    source: {
      source: "local",
      path: "./plugins/codex-voltagent-default"
    },
    policy: {
      installation: "INSTALLED_BY_DEFAULT",
      authentication: "ON_INSTALL"
    },
    category: "Developer Tools"
  };
  const existingIndex = plugins.findIndex(
    (plugin) => plugin?.name === "codex-voltagent-default"
  );

  if (existingIndex >= 0) {
    plugins[existingIndex] = entry;
  } else {
    plugins.push(entry);
  }

  marketplace.plugins = plugins;

  writeFileSync(
    layout.marketplacePath,
    `${JSON.stringify(marketplace, null, 2)}\n`,
    "utf8"
  );
}
