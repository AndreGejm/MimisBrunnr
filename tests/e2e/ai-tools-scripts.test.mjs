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
