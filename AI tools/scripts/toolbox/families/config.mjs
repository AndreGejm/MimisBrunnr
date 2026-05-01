import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveRoot } from "../shared/args.mjs";
import { assertReadableDirectory, walk } from "../shared/filesystem.mjs";
import { baseEnvelope } from "../shared/output.mjs";
import { isProbablyText, isSecretLikeFile, MAX_TEXT_FILE_BYTES } from "../shared/text.mjs";

function isConfigLikeFile(relativePath) {
  const fileName = path.basename(relativePath).toLowerCase();
  return (
    fileName.startsWith(".env") ||
    [
      "package.json",
      "pnpm-workspace.yaml",
      "tsconfig.json",
      "docker-compose.yml",
      "compose.yml",
      ".npmrc"
    ].includes(fileName) ||
    /\.(json|ya?ml|toml|ini|conf|config)$/iu.test(fileName)
  );
}

function extractEnvDefinitions(text) {
  const definitions = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line);
    if (match) {
      definitions.push(match[1]);
    }
  }
  return definitions;
}

function collectProcessEnvReferences(line) {
  const references = [];
  for (const match of line.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/gu)) {
    const tail = line.slice((match.index ?? 0) + match[0].length);
    references.push({ name: match[1], hasDefault: /^\s*(\?\?|\|\|)/u.test(tail) });
  }
  for (const match of line.matchAll(/process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/gu)) {
    const tail = line.slice((match.index ?? 0) + match[0].length);
    references.push({ name: match[1], hasDefault: /^\s*(\?\?|\|\|)/u.test(tail) });
  }
  return references;
}

export async function configMap(flags) {
  const root = resolveRoot(flags);
  await assertReadableDirectory(root);
  const configFiles = new Set();
  const definitions = new Map();
  const references = new Map();

  await walk(root, flags, async ({ fullPath, relativePath, entry }) => {
    if (!entry.isFile()) {
      return;
    }

    if (isConfigLikeFile(relativePath)) {
      configFiles.add(relativePath);
    }

    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_TEXT_FILE_BYTES) {
      return;
    }

    if (isSecretLikeFile(relativePath)) {
      const text = await readFile(fullPath, "utf8");
      for (const name of extractEnvDefinitions(text)) {
        const files = definitions.get(name) ?? new Set();
        files.add(relativePath);
        definitions.set(name, files);
      }
      return;
    }

    const buffer = await readFile(fullPath);
    if (!isProbablyText(buffer)) {
      return;
    }

    const text = buffer.toString("utf8");
    for (const line of text.split(/\r?\n/u)) {
      for (const reference of collectProcessEnvReferences(line)) {
        const current = references.get(reference.name) ?? {
          name: reference.name,
          files: new Set(),
          has_default: false
        };
        current.files.add(relativePath);
        current.has_default = current.has_default || reference.hasDefault;
        references.set(reference.name, current);
      }
    }
  });

  const envVars = Array.from(new Set([...references.keys(), ...definitions.keys()])).sort().map((name) => {
    const reference = references.get(name);
    const definedIn = definitions.get(name);
    return {
      name,
      files: reference ? Array.from(reference.files).sort() : [],
      defined_in_files: definedIn ? Array.from(definedIn).sort() : [],
      has_default: reference?.has_default ?? false,
      required: reference ? !reference.has_default : false
    };
  });

  return baseEnvelope("config-map", root, {
    config_files: Array.from(configFiles).sort(),
    env_vars_referenced: envVars
  });
}

export const configCommands = {
  "config-map": configMap
};
