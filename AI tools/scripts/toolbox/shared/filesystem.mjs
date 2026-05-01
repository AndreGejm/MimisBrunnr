import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MAX_DEPTH, numberFlag } from "./args.mjs";

export const DEFAULT_IGNORES = [
  ".git",
  ".pnpm-store",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
  "target"
];

export function toRelative(root, fullPath) {
  const relativePath = path.relative(root, fullPath);
  return relativePath === "" ? "." : relativePath.split(path.sep).join("/");
}

export async function assertReadableDirectory(root) {
  await access(root, constants.R_OK);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Root is not a directory: ${root}`);
  }
}

export function buildIgnoreSet(flags) {
  return new Set([...DEFAULT_IGNORES, ...flags.ignore].filter(Boolean));
}

export async function walk(root, flags, visitor) {
  const ignoreSet = buildIgnoreSet(flags);
  const ignoredDirs = new Set();
  const maxDepth = numberFlag(flags, "max-depth", DEFAULT_MAX_DEPTH);

  async function visitDirectory(currentPath, depth) {
    if (depth > maxDepth) {
      return;
    }

    const entries = await readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = toRelative(root, fullPath);
      if (entry.isDirectory() && ignoreSet.has(entry.name)) {
        ignoredDirs.add(entry.name);
        continue;
      }

      await visitor({
        fullPath,
        relativePath,
        entry,
        depth
      });

      if (entry.isDirectory()) {
        await visitDirectory(fullPath, depth + 1);
      }
    }
  }

  await visitDirectory(root, 0);
  return Array.from(ignoredDirs).sort();
}
