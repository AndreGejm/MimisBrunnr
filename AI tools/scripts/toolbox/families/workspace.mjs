import { stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MAX_ITEMS, numberFlag, resolveRoot } from "../shared/args.mjs";
import { assertReadableDirectory, walk } from "../shared/filesystem.mjs";
import { baseEnvelope } from "../shared/output.mjs";

export async function fileInventory(flags) {
  const root = resolveRoot(flags);
  await assertReadableDirectory(root);
  const maxItems = numberFlag(flags, "max-items", DEFAULT_MAX_ITEMS);
  const extensions = new Map();
  const files = [];
  let totalSizeBytes = 0;

  const ignoredDirs = await walk(root, flags, async ({ fullPath, relativePath, entry }) => {
    if (!entry.isFile()) {
      return;
    }

    const fileStat = await stat(fullPath);
    totalSizeBytes += fileStat.size;
    const extension = path.extname(entry.name).toLowerCase() || "[none]";
    extensions.set(extension, (extensions.get(extension) ?? 0) + 1);
    files.push({
      path: relativePath,
      size_bytes: fileStat.size,
      modified_at: fileStat.mtime.toISOString()
    });
  });

  const topExtensions = Object.fromEntries(
    Array.from(extensions.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  );

  return baseEnvelope("file-inventory", root, {
    total_files: files.length,
    total_size_bytes: totalSizeBytes,
    total_size_mb: Number((totalSizeBytes / 1024 / 1024).toFixed(3)),
    top_extensions: topExtensions,
    largest_files: [...files].sort((left, right) => right.size_bytes - left.size_bytes || left.path.localeCompare(right.path)).slice(0, maxItems),
    recently_modified: [...files].sort((left, right) => right.modified_at.localeCompare(left.modified_at) || left.path.localeCompare(right.path)).slice(0, maxItems),
    ignored_dirs: ignoredDirs
  });
}

export async function treeLite(flags) {
  const root = resolveRoot(flags);
  await assertReadableDirectory(root);
  const maxItems = numberFlag(flags, "max-items", DEFAULT_MAX_ITEMS);
  const entries = [];

  const ignoredDirs = await walk(root, flags, async ({ fullPath, relativePath, entry, depth }) => {
    if (entries.length >= maxItems) {
      return;
    }

    const item = {
      path: relativePath,
      type: entry.isDirectory() ? "directory" : "file",
      depth
    };
    if (entry.isFile()) {
      item.size_bytes = (await stat(fullPath)).size;
    }
    entries.push(item);
  });

  return baseEnvelope("tree-lite", root, {
    entries,
    truncated: entries.length >= maxItems,
    ignored_dirs: ignoredDirs
  });
}

export const workspaceCommands = {
  "file-inventory": fileInventory,
  "tree-lite": treeLite
};
