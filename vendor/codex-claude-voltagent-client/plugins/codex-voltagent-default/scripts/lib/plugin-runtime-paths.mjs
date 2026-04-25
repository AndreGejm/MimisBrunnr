import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function getPluginRoot(fromImportMetaUrl = import.meta.url) {
  const currentFilePath = fileURLToPath(fromImportMetaUrl);
  let currentDirPath = dirname(currentFilePath);

  while (true) {
    if (existsSync(join(currentDirPath, ".codex-plugin", "plugin.json"))) {
      return currentDirPath;
    }

    const parentDirPath = dirname(currentDirPath);

    assert(
      parentDirPath !== currentDirPath,
      `Could not locate plugin root for ${currentFilePath}`
    );

    currentDirPath = parentDirPath;
  }
}

export function getRepoLocalClientRoot(fromImportMetaUrl = import.meta.url) {
  return resolve(getPluginRoot(fromImportMetaUrl), "..", "..");
}

export function resolveClientRoot(options = {}) {
  const fromImportMetaUrl = options.fromImportMetaUrl ?? import.meta.url;
  const envClientRoot = process.env.CODEX_VOLTAGENT_CLIENT_ROOT;

  if (isNonBlankString(envClientRoot)) {
    return resolve(envClientRoot);
  }

  const pluginRoot = getPluginRoot(fromImportMetaUrl);
  const pointerPath = join(pluginRoot, "client-root.json");

  if (existsSync(pointerPath)) {
    const pointer = JSON.parse(readFileSync(pointerPath, "utf8"));

    assert(
      isNonBlankString(pointer.clientRoot),
      "client-root.json must contain a non-blank clientRoot"
    );

    return resolve(pointer.clientRoot);
  }

  return getRepoLocalClientRoot(fromImportMetaUrl);
}

export function requireBuiltClientRoot(options = {}) {
  const clientRoot = resolveClientRoot(options);
  const distRoot = join(clientRoot, "dist");

  assert(
    existsSync(distRoot),
    `Built client output is missing at ${distRoot}; run pnpm build in the client repo first`
  );

  return clientRoot;
}

export async function loadClientModule(modulePath, options = {}) {
  const clientRoot = requireBuiltClientRoot(options);
  const moduleUrl = pathToFileURL(join(clientRoot, modulePath)).href;

  return import(moduleUrl);
}
