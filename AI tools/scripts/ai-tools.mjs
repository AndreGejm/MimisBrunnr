#!/usr/bin/env node
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
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
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
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

async function readBoundedTextFile(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }
  if (fileStat.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(`File is larger than the ${MAX_TEXT_FILE_BYTES} byte AI tools read limit: ${filePath}`);
  }

  const buffer = await readFile(filePath);
  if (!isProbablyText(buffer)) {
    throw new Error(`File does not look like text: ${filePath}`);
  }
  return buffer.toString("utf8");
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

function lineRange(startLine, endLine) {
  return `${startLine}-${endLine}`;
}

async function chunkFile(flags, positional) {
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

async function logSummary(flags, positional) {
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

function categorizePath(filePath) {
  const normalized = filePath.replace(/\\/gu, "/");
  if (/^(docs|documentation)\//u.test(normalized) || /\.(md|mdx|txt)$/iu.test(normalized)) {
    return "docs";
  }
  if (/^(tests?|__tests__)\//u.test(normalized) || /\.(test|spec)\.[cm]?[jt]sx?$/iu.test(normalized)) {
    return "tests";
  }
  if (/(^|\/)(package\.json|pnpm-lock\.yaml|tsconfig.*\.json|\.github\/|Dockerfile|docker-compose)/iu.test(normalized)) {
    return "config";
  }
  return "source";
}

async function getDiffText(flags, root) {
  if (flags.input) {
    return readBoundedTextFile(path.resolve(String(flags.input)));
  }
  const gitArgs = flags.staged ? ["diff", "--staged"] : ["diff"];
  const { stdout } = await execFileAsync("git", gitArgs, { cwd: root, maxBuffer: MAX_TEXT_FILE_BYTES });
  return stdout;
}

async function diffSummary(flags) {
  const root = resolveRoot(flags);
  const diffText = await getDiffText(flags, root);
  const categories = {
    docs: [],
    tests: [],
    source: [],
    config: []
  };
  const changedFiles = [];
  let addedLines = 0;
  let removedLines = 0;

  for (const line of diffText.split(/\r?\n/u)) {
    const fileMatch = /^diff --git a\/(.+?) b\/(.+)$/u.exec(line);
    if (fileMatch) {
      changedFiles.push(fileMatch[2]);
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      addedLines += 1;
    } else if (line.startsWith("-")) {
      removedLines += 1;
    }
  }

  for (const filePath of changedFiles) {
    categories[categorizePath(filePath)].push(filePath);
  }
  for (const category of Object.keys(categories)) {
    categories[category].sort();
  }

  return baseEnvelope("diff-summary", root, {
    source: flags.input ? path.resolve(String(flags.input)) : flags.staged ? "git diff --staged" : "git diff",
    files_changed: new Set(changedFiles).size,
    added_lines: addedLines,
    removed_lines: removedLines,
    categories,
    risky_changes: changedFiles.filter((filePath) => /(^|\/)(package\.json|pnpm-lock\.yaml|\.github\/workflows\/)/u.test(filePath)).sort()
  });
}

function commandMutatesFiles(script) {
  return /\b(build|compile|generate|gen|write|update|fix|format|prettier|tsc)\b/iu.test(script);
}

function commandRequiresNetwork(name, script) {
  return /\b(deploy|publish|push|curl|wget|fetch|install|docker\s+pull|npm\s+publish|pnpm\s+publish)\b/iu.test(`${name} ${script}`);
}

async function commandIndex(flags) {
  const root = resolveRoot(flags);
  await assertReadableDirectory(root);
  const packagePath = path.join(root, "package.json");
  const commands = [];

  try {
    const parsed = JSON.parse(await readFile(packagePath, "utf8"));
    const scripts = parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
    for (const [name, command] of Object.entries(scripts).sort(([left], [right]) => left.localeCompare(right))) {
      if (typeof command !== "string") {
        continue;
      }
      commands.push({
        name,
        command,
        source: "package.json",
        mutates_files: commandMutatesFiles(command),
        requires_network: commandRequiresNetwork(name, command)
      });
    }
  } catch (error) {
    return baseEnvelope("command-index", root, { commands: [] }, [], [`Could not read package.json: ${error instanceof Error ? error.message : String(error)}`]);
  }

  return baseEnvelope("command-index", root, { commands });
}

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

async function configMap(flags) {
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
  } else if (Array.isArray(payload.data.chunks)) {
    for (const chunk of payload.data.chunks) {
      lines.push(`- ${chunk.id} ${chunk.lines} ${chunk.heading ?? "untitled"}: ${chunk.preview}`);
    }
  } else if (Array.isArray(payload.data.commands)) {
    for (const command of payload.data.commands) {
      lines.push(`- ${command.name}: ${command.command}`);
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
      commands: ["list-tools", "file-inventory", "tree-lite", "smart-search", "chunk-file", "log-summary", "diff-summary", "command-index", "config-map"]
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
  if (command === "chunk-file") {
    return chunkFile(flags, positional);
  }
  if (command === "log-summary") {
    return logSummary(flags, positional);
  }
  if (command === "diff-summary") {
    return diffSummary(flags);
  }
  if (command === "command-index") {
    return commandIndex(flags);
  }
  if (command === "config-map") {
    return configMap(flags);
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
