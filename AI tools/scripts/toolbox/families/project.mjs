import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveRoot } from "../shared/args.mjs";
import { assertReadableDirectory } from "../shared/filesystem.mjs";
import { baseEnvelope } from "../shared/output.mjs";
import { MAX_TEXT_FILE_BYTES, readBoundedTextFile } from "../shared/text.mjs";

const execFileAsync = promisify(execFile);

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

export async function diffSummary(flags) {
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

export async function commandIndex(flags) {
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

export const projectCommands = {
  "command-index": commandIndex,
  "diff-summary": diffSummary
};
