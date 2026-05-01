#!/usr/bin/env node
import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_ROOT = path.join(TOOL_ROOT, "index");
const DEFAULT_IGNORES = [
  ".git",
  ".pnpm-store",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
  "target"
];
const DEFAULT_MAX_ITEMS = 50;
const DEFAULT_MAX_CHARS = 240;
const DEFAULT_MAX_DEPTH = 4;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const SECRET_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".npmrc",
  ".pypirc",
  "id_ed25519",
  "id_rsa"
]);
const SECRET_FILE_EXTENSIONS = new Set([".key", ".pem", ".p12", ".pfx"]);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {
    json: true,
    markdown: false,
    ignore: [],
    include: []
  };
  const positional = [];

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }

    const flag = value.slice(2);
    if (["json", "markdown", "dry-run"].includes(flag)) {
      flags[flag.replace("-", "")] = true;
      if (flag === "markdown") {
        flags.json = false;
      }
      continue;
    }

    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[flag] = true;
      continue;
    }

    index += 1;
    if (flag === "ignore" || flag === "include") {
      flags[flag].push(next);
    } else {
      flags[flag] = next;
    }
  }

  return { command, flags, positional };
}

function numberFlag(flags, name, fallback) {
  const value = Number(flags[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function resolveRoot(flags) {
  return path.resolve(flags.root ? String(flags.root) : process.cwd());
}

function toRelative(root, fullPath) {
  const relativePath = path.relative(root, fullPath);
  return relativePath === "" ? "." : relativePath.split(path.sep).join("/");
}

function truncate(value, maxChars) {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, Math.max(0, maxChars - 1)) + "…";
}

function baseEnvelope(tool, root, data = {}, warnings = [], errors = []) {
  return {
    tool,
    schema_version: "1.0",
    root,
    generated_at: new Date().toISOString(),
    data,
    warnings,
    errors
  };
}

async function assertReadableDirectory(root) {
  await access(root, constants.R_OK);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`Root is not a directory: ${root}`);
  }
}

function buildIgnoreSet(flags) {
  return new Set([...DEFAULT_IGNORES, ...flags.ignore].filter(Boolean));
}

async function walk(root, flags, visitor) {
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

async function readToolIndex() {
  const entries = await readdir(INDEX_ROOT, { withFileTypes: true });
  const tools = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "tool-template.json") {
      continue;
    }

    const fullPath = path.join(INDEX_ROOT, entry.name);
    const parsed = JSON.parse(await readFile(fullPath, "utf8"));
    tools.push({
      name: parsed.name,
      purpose: parsed.purpose,
      safe: parsed.safe,
      mutates_files: parsed.mutates_files,
      requires_network: parsed.requires_network,
      reads_secrets: parsed.reads_secrets,
      example: parsed.example,
      status: parsed.status
    });
  }
  return tools;
}

async function listTools(flags) {
  const root = resolveRoot(flags);
  return baseEnvelope("list-tools", root, {
    tools: await readToolIndex()
  });
}

async function fileInventory(flags) {
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

async function treeLite(flags) {
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

function isProbablyText(buffer) {
  return !buffer.subarray(0, 2048).includes(0);
}

function isSecretLikeFile(relativePath) {
  const fileName = path.basename(relativePath).toLowerCase();
  if (SECRET_FILE_NAMES.has(fileName)) {
    return true;
  }
  if (fileName.startsWith(".env.")) {
    return true;
  }
  return SECRET_FILE_EXTENSIONS.has(path.extname(fileName));
}

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

async function smartSearch(flags, positional) {
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

function toMarkdown(payload) {
  const lines = [`# ${payload.tool}`, "", `Root: ${payload.root}`, ""];
  if (Array.isArray(payload.data.tools)) {
    for (const tool of payload.data.tools) {
      lines.push(`- ${tool.name}: ${tool.purpose}`);
    }
  } else if (Array.isArray(payload.data.entries)) {
    for (const entry of payload.data.entries) {
      lines.push(`- ${entry.type}: ${entry.path}`);
    }
  } else if (Array.isArray(payload.data.matches)) {
    for (const match of payload.data.matches) {
      lines.push(`- ${match.path}:${match.line} (${match.score}) ${match.context}`);
    }
  } else {
    lines.push("```json");
    lines.push(JSON.stringify(payload.data, null, 2));
    lines.push("```");
  }
  return `${lines.join("\n")}\n`;
}

async function run() {
  const { command, flags, positional } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || command === "--help") {
    return baseEnvelope("help", process.cwd(), {
      usage: "node \"AI tools/scripts/ai-tools.mjs\" <command> [args] [--json]",
      commands: ["list-tools", "file-inventory", "tree-lite", "smart-search"]
    });
  }

  if (command === "list-tools") {
    return listTools(flags);
  }
  if (command === "file-inventory") {
    return fileInventory(flags);
  }
  if (command === "tree-lite") {
    return treeLite(flags);
  }
  if (command === "smart-search") {
    return smartSearch(flags, positional);
  }

  return baseEnvelope(command, resolveRoot(flags), {}, [], [`Unknown command: ${command}`]);
}

try {
  const payload = await run();
  process.stdout.write((payload.data && payload.data.markdown) || (parseArgs(process.argv.slice(2)).flags.markdown ? toMarkdown(payload) : `${JSON.stringify(payload, null, 2)}\n`));
  process.exit(payload.errors.length > 0 ? 1 : 0);
} catch (error) {
  const root = process.cwd();
  process.stdout.write(`${JSON.stringify(baseEnvelope("ai-tools", root, {}, [], [error instanceof Error ? error.message : String(error)]), null, 2)}\n`);
  process.exit(1);
}
