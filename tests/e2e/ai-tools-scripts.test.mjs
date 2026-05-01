import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const launcherPath = path.join(process.cwd(), "AI tools", "scripts", "ai-tools.mjs");

function runAiTool(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [launcherPath, ...args], {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function createFixtureRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-ai-tools-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "ignored"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "# Fixture\n\nAuthentication timeout notes.\n", "utf8");
  await writeFile(path.join(root, "src", "app.js"), "export const timeoutMessage = 'timeout error';\n", "utf8");
  await writeFile(path.join(root, "docs", "guide.md"), "## Login\n\nTimeout handling lives here.\n", "utf8");
  await writeFile(path.join(root, "node_modules", "ignored", "skip.js"), "timeout should be ignored\n", "utf8");
  return root;
}

test("ai-tools list-tools returns machine-readable tool metadata", async () => {
  const result = await runAiTool(["list-tools", "--json"]);

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.tool, "list-tools");
  assert.equal(payload.schema_version, "1.0");
  assert.equal(payload.errors.length, 0);
  assert.ok(payload.data.tools.some((tool) => tool.name === "file-inventory"));
  assert.ok(payload.data.tools.some((tool) => tool.name === "smart-search"));
  assert.ok(payload.data.tools.some((tool) => tool.name === "chunk-file"));
  assert.ok(payload.data.tools.some((tool) => tool.name === "command-index"));
});

test("ai-tools file-inventory summarizes a workspace without dependency folders", async (t) => {
  const root = await createFixtureRoot(t);
  const result = await runAiTool(["file-inventory", "--root", root, "--max-items", "5", "--json"]);

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.tool, "file-inventory");
  assert.equal(payload.root, root);
  assert.equal(payload.errors.length, 0);
  assert.equal(payload.data.total_files, 3);
  assert.equal(payload.data.top_extensions[".md"], 2);
  assert.equal(payload.data.top_extensions[".js"], 1);
  assert.ok(payload.data.ignored_dirs.includes("node_modules"));
  assert.equal(
    payload.data.largest_files.some((file) => file.path.includes("node_modules")),
    false
  );
});

test("ai-tools tree-lite returns a bounded tree with ignored directories marked", async (t) => {
  const root = await createFixtureRoot(t);
  const result = await runAiTool(["tree-lite", "--root", root, "--max-items", "10", "--json"]);

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.tool, "tree-lite");
  assert.equal(payload.errors.length, 0);
  assert.ok(payload.data.entries.some((entry) => entry.path === "README.md"));
  assert.ok(payload.data.entries.some((entry) => entry.path === "src/app.js"));
  assert.ok(payload.data.ignored_dirs.includes("node_modules"));
  assert.equal(
    payload.data.entries.some((entry) => entry.path.includes("node_modules/ignored")),
    false
  );
});

test("ai-tools smart-search ranks bounded matches and ignores generated folders", async (t) => {
  const root = await createFixtureRoot(t);
  await writeFile(path.join(root, ".env"), "SECRET_TIMEOUT=timeout\n", "utf8");
  const result = await runAiTool([
    "smart-search",
    "timeout",
    "--root",
    root,
    "--max-items",
    "5",
    "--max-chars",
    "80",
    "--json"
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.tool, "smart-search");
  assert.equal(payload.errors.length, 0);
  assert.equal(payload.data.matches.length, 3);
  assert.equal(
    payload.data.matches.some((match) => match.path.includes("node_modules")),
    false
  );
  assert.ok(payload.data.matches[0].score >= payload.data.matches[1].score);
  assert.ok(payload.data.matches.every((match) => match.context.length <= 80));
});

test("ai-tools chunk-file splits markdown into bounded heading chunks", async (t) => {
  const root = await createFixtureRoot(t);
  const manualPath = path.join(root, "docs", "manual.md");
  await writeFile(
    manualPath,
    [
      "# Manual",
      "",
      "Intro text.",
      "",
      "## Install",
      "",
      "Install step one.",
      "Install step two.",
      "",
      "## Troubleshooting",
      "",
      "Timeout error details.",
      "Retry instructions."
    ].join("\n"),
    "utf8"
  );

  const result = await runAiTool([
    "chunk-file",
    manualPath,
    "--max-chars",
    "80",
    "--json"
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.tool, "chunk-file");
  assert.equal(payload.errors.length, 0);
  assert.equal(payload.data.source_path, manualPath);
  assert.ok(payload.data.chunks.length >= 3);
  assert.deepEqual(
    payload.data.chunks.map((chunk) => chunk.id),
    payload.data.chunks.map((_, index) => `chunk-${String(index + 1).padStart(3, "0")}`)
  );
  assert.ok(payload.data.chunks.every((chunk) => chunk.preview.length <= 80));
  assert.ok(payload.data.chunks.some((chunk) => chunk.heading === "Install"));
});

test("ai-tools log-summary collapses errors, warnings, repeated lines, and referenced files", async (t) => {
  const root = await createFixtureRoot(t);
  const logPath = path.join(root, "build.log");
  await writeFile(
    logPath,
    [
      "src/app.js:10: warning: unused value",
      "src/app.js:10: warning: unused value",
      "ERROR Failed to compile src/app.js: timeout",
      "Error: timeout while loading config",
      "docs/guide.md: warning: stale doc"
    ].join("\n"),
    "utf8"
  );

  const result = await runAiTool(["log-summary", logPath, "--max-items", "5", "--json"]);

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.tool, "log-summary");
  assert.equal(payload.errors.length, 0);
  assert.equal(payload.data.total_lines, 5);
  assert.equal(payload.data.error_count, 2);
  assert.equal(payload.data.warning_count, 3);
  assert.equal(payload.data.first_error.line, 3);
  assert.ok(payload.data.repeated_lines.some((line) => line.count === 2));
  assert.ok(payload.data.files_referenced.includes("src/app.js"));
});

test("ai-tools diff-summary categorizes patch content without dumping full diff", async (t) => {
  const root = await createFixtureRoot(t);
  const diffPath = path.join(root, "changes.diff");
  await writeFile(
    diffPath,
    [
      "diff --git a/src/app.js b/src/app.js",
      "index 1111111..2222222 100644",
      "--- a/src/app.js",
      "+++ b/src/app.js",
      "@@ -1 +1,2 @@",
      "-old line",
      "+new line",
      "+extra line",
      "diff --git a/docs/guide.md b/docs/guide.md",
      "--- a/docs/guide.md",
      "+++ b/docs/guide.md",
      "@@ -1 +1 @@",
      "-old docs",
      "+new docs"
    ].join("\n"),
    "utf8"
  );

  const result = await runAiTool(["diff-summary", "--input", diffPath, "--json"]);

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.tool, "diff-summary");
  assert.equal(payload.errors.length, 0);
  assert.equal(payload.data.files_changed, 2);
  assert.equal(payload.data.added_lines, 3);
  assert.equal(payload.data.removed_lines, 2);
  assert.deepEqual(payload.data.categories.source, ["src/app.js"]);
  assert.deepEqual(payload.data.categories.docs, ["docs/guide.md"]);
});

test("ai-tools command-index reports package scripts with safety metadata", async (t) => {
  const root = await createFixtureRoot(t);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        test: "node --test",
        build: "tsc -b",
        deploy: "node deploy.js --push"
      }
    }),
    "utf8"
  );

  const result = await runAiTool(["command-index", "--root", root, "--json"]);

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.tool, "command-index");
  assert.equal(payload.errors.length, 0);
  assert.ok(payload.data.commands.some((command) => command.name === "test" && command.mutates_files === false));
  assert.ok(payload.data.commands.some((command) => command.name === "build" && command.mutates_files === true));
  assert.ok(payload.data.commands.some((command) => command.name === "deploy" && command.requires_network === true));
});

test("ai-tools config-map reports env references without exposing secret file values", async (t) => {
  const root = await createFixtureRoot(t);
  await writeFile(path.join(root, ".env"), "SECRET_TOKEN=do-not-print\nVISIBLE_MODE=local\n", "utf8");
  await writeFile(
    path.join(root, "src", "config.js"),
    [
      "const token = process.env.SECRET_TOKEN;",
      "const url = process.env.API_URL ?? 'http://localhost';"
    ].join("\n"),
    "utf8"
  );

  const result = await runAiTool(["config-map", "--root", root, "--json"]);

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.tool, "config-map");
  assert.equal(payload.errors.length, 0);
  assert.ok(payload.data.config_files.includes(".env"));
  assert.ok(payload.data.env_vars_referenced.some((envVar) => envVar.name === "SECRET_TOKEN" && envVar.required === true));
  assert.ok(payload.data.env_vars_referenced.some((envVar) => envVar.name === "API_URL" && envVar.has_default === true));
  assert.equal(JSON.stringify(payload).includes("do-not-print"), false);
});
