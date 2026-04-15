import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { CorpusId } from "@mimir/domain";

export function normalizeNotePath(notePath: string, corpusId: CorpusId): string {
  const posixPath = notePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  const withExtension = posixPath.endsWith(".md") ? posixPath : `${posixPath}.md`;
  const prefixed = withExtension.startsWith(`${corpusId}/`)
    ? withExtension
    : `${corpusId}/${withExtension}`;
  const normalized = path.posix.normalize(prefixed);

  if (normalized.startsWith("../") || normalized.includes("/../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Unsafe note path '${notePath}'.`);
  }

  return normalized;
}

export function toAbsoluteNotePath(rootPath: string, notePath: string, corpusId: CorpusId): string {
  const relativePath = normalizeNotePath(notePath, corpusId);
  const absolutePath = path.resolve(rootPath, ...relativePath.split("/"));
  const resolvedRoot = path.resolve(rootPath);
  const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;

  if (absolutePath !== resolvedRoot && !absolutePath.startsWith(rootPrefix)) {
    throw new Error(`Resolved note path '${absolutePath}' escapes repository root.`);
  }

  return absolutePath;
}

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function listMarkdownFiles(rootPath: string): Promise<string[]> {
  const output: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const absolute = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        output.push(absolute);
      }
    }
  }

  await walk(path.resolve(rootPath));
  return output;
}

export function toRelativeVaultPath(rootPath: string, absolutePath: string): string {
  return path
    .relative(path.resolve(rootPath), path.resolve(absolutePath))
    .split(path.sep)
    .join("/");
}
