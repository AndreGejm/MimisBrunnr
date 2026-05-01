import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MAX_CHARS, DEFAULT_MAX_ITEMS, numberFlag, resolveRoot } from "../shared/args.mjs";
import { assertReadableDirectory, walk } from "../shared/filesystem.mjs";
import { baseEnvelope } from "../shared/output.mjs";
import {
  isProbablyText,
  isSecretLikeFile,
  lineRange,
  MAX_TEXT_FILE_BYTES,
  readBoundedTextFile,
  truncate
} from "../shared/text.mjs";

function scoreMatch(query, relativePath, lineText) {
  const lowerPath = relativePath.toLowerCase();
  const lowerLine = lineText.toLowerCase();
  let score = 0.5;
  if (lowerPath.includes(query)) {
    score += 0.3;
  }
  if (lowerLine.trim().startsWith(query)) {
    score += 0.2;
  }
  score += Math.min(0.2, query.length / Math.max(20, lowerLine.length));
  return Number(score.toFixed(4));
}

export async function smartSearch(flags, positional) {
  const query = positional.join(" ").trim();
  const root = resolveRoot(flags);
  await assertReadableDirectory(root);
  if (query.length === 0) {
    return baseEnvelope("smart-search", root, { matches: [] }, [], ["Missing search query."]);
  }

  const maxItems = numberFlag(flags, "max-items", DEFAULT_MAX_ITEMS);
  const maxChars = numberFlag(flags, "max-chars", DEFAULT_MAX_CHARS);
  const lowerQuery = query.toLowerCase();
  const matches = [];
  let skippedSecretLikeFiles = 0;

  const ignoredDirs = await walk(root, flags, async ({ fullPath, relativePath, entry }) => {
    if (!entry.isFile() || matches.length > maxItems * 5) {
      return;
    }
    if (isSecretLikeFile(relativePath)) {
      skippedSecretLikeFiles += 1;
      return;
    }

    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_TEXT_FILE_BYTES) {
      return;
    }

    const buffer = await readFile(fullPath);
    if (!isProbablyText(buffer)) {
      return;
    }

    const lines = buffer.toString("utf8").split(/\r?\n/u);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line.toLowerCase().includes(lowerQuery)) {
        continue;
      }

      matches.push({
        path: relativePath,
        line: lineIndex + 1,
        score: scoreMatch(lowerQuery, relativePath, line),
        context: truncate(line.trim(), maxChars),
        modified_at: fileStat.mtime.toISOString()
      });
    }
  });

  matches.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.line - right.line);

  return baseEnvelope("smart-search", root, {
    query,
    matches: matches.slice(0, maxItems),
    skipped_secret_like_files: skippedSecretLikeFiles,
    ignored_dirs: ignoredDirs
  });
}

export async function chunkFile(flags, positional) {
  const filePathArg = positional[0];
  if (!filePathArg) {
    return baseEnvelope("chunk-file", process.cwd(), { chunks: [] }, [], ["Missing file path."]);
  }

  const filePath = path.resolve(filePathArg);
  const text = await readBoundedTextFile(filePath);
  const maxChars = numberFlag(flags, "max-chars", DEFAULT_MAX_CHARS);
  const lines = text.split(/\r?\n/u);
  const headingIndexes = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (/^#{1,6}\s+\S/u.test(lines[index])) {
      headingIndexes.push(index);
    }
  }

  const chunks = [];
  const addChunk = (startIndex, endIndex, heading) => {
    const chunkText = lines.slice(startIndex, endIndex + 1).join("\n").trim();
    if (chunkText.length === 0) {
      return;
    }
    chunks.push({
      id: `chunk-${String(chunks.length + 1).padStart(3, "0")}`,
      lines: lineRange(startIndex + 1, endIndex + 1),
      heading,
      char_count: chunkText.length,
      tokens_estimate: Math.ceil(chunkText.length / 4),
      preview: truncate(chunkText.replace(/\s+/gu, " "), maxChars)
    });
  };

  if (headingIndexes.length === 0) {
    const linesPerChunk = Math.max(1, Math.floor(maxChars / 80));
    for (let index = 0; index < lines.length; index += linesPerChunk) {
      addChunk(index, Math.min(lines.length - 1, index + linesPerChunk - 1), null);
    }
  } else {
    for (let headingIndex = 0; headingIndex < headingIndexes.length; headingIndex += 1) {
      const startIndex = headingIndexes[headingIndex];
      const endIndex = (headingIndexes[headingIndex + 1] ?? lines.length) - 1;
      const heading = lines[startIndex].replace(/^#{1,6}\s+/u, "").trim();
      addChunk(startIndex, endIndex, heading);
    }
  }

  return baseEnvelope("chunk-file", path.dirname(filePath), {
    source_path: filePath,
    chunking: headingIndexes.length > 0 ? "markdown-heading" : "line-window",
    chunks
  });
}

function collectReferencedFiles(line) {
  const matches = line.match(/(?:[A-Za-z]:)?[A-Za-z0-9_.-]+(?:\/|\\)[A-Za-z0-9_.\/\\-]+\.[A-Za-z0-9]+/gu) ?? [];
  return matches.map((match) => match.replace(/\\/gu, "/"));
}

export async function logSummary(flags, positional) {
  const filePathArg = positional[0];
  if (!filePathArg) {
    return baseEnvelope("log-summary", process.cwd(), {}, [], ["Missing log file path."]);
  }

  const filePath = path.resolve(filePathArg);
  const maxItems = numberFlag(flags, "max-items", DEFAULT_MAX_ITEMS);
  const maxChars = numberFlag(flags, "max-chars", DEFAULT_MAX_CHARS);
  const text = await readBoundedTextFile(filePath);
  const lines = text.split(/\r?\n/u).filter((line) => line.length > 0);
  const errors = [];
  const warnings = [];
  const repeated = new Map();
  const referencedFiles = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lower = line.toLowerCase();
    repeated.set(line, (repeated.get(line) ?? 0) + 1);
    for (const referencedFile of collectReferencedFiles(line)) {
      referencedFiles.add(referencedFile);
    }
    if (/\b(error|fatal|failed|failure)\b/u.test(lower)) {
      errors.push({ line: index + 1, text: truncate(line, maxChars) });
    }
    if (/\b(warn|warning)\b/u.test(lower)) {
      warnings.push({ line: index + 1, text: truncate(line, maxChars) });
    }
  }

  return baseEnvelope("log-summary", path.dirname(filePath), {
    source_path: filePath,
    total_lines: lines.length,
    error_count: errors.length,
    warning_count: warnings.length,
    first_error: errors[0] ?? null,
    fatal_errors: errors.slice(0, maxItems),
    warnings: warnings.slice(0, maxItems),
    repeated_lines: Array.from(repeated.entries())
      .filter(([, count]) => count > 1)
      .map(([text, count]) => ({ text: truncate(text, maxChars), count }))
      .sort((left, right) => right.count - left.count || left.text.localeCompare(right.text))
      .slice(0, maxItems),
    files_referenced: Array.from(referencedFiles).sort().slice(0, maxItems)
  });
}

export const textCommands = {
  "chunk-file": chunkFile,
  "log-summary": logSummary,
  "smart-search": smartSearch
};
