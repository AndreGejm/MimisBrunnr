import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";

test("vendored codex voltagent client is present and wired into the monorepo workspace", async () => {
  const repoRoot = process.cwd();
  const vendoredRoot = path.join(repoRoot, "vendor", "codex-claude-voltagent-client");
  const vendoredPackagePath = path.join(vendoredRoot, "package.json");
  const vendoredProvenancePath = path.join(vendoredRoot, "VENDORED_FROM.md");
  const rootWorkspacePath = path.join(repoRoot, "pnpm-workspace.yaml");
  const rootPackagePath = path.join(repoRoot, "package.json");

  const vendoredPackage = JSON.parse(await readFile(vendoredPackagePath, "utf8"));
  const rootWorkspace = await readFile(rootWorkspacePath, "utf8");
  const rootPackage = JSON.parse(await readFile(rootPackagePath, "utf8"));

  assert.equal(vendoredPackage.name, "codex-claude-voltagent-client");
  assert.match(rootWorkspace, /vendor\/codex-claude-voltagent-client/);
  assert.equal(
    rootPackage.scripts["vendor:codex-voltagent:build"],
    "pnpm --dir vendor/codex-claude-voltagent-client build"
  );
  assert.equal(
    rootPackage.scripts["vendor:codex-voltagent:typecheck"],
    "pnpm --dir vendor/codex-claude-voltagent-client typecheck"
  );
  assert.equal(
    rootPackage.scripts["vendor:codex-voltagent:smoke"],
    "pnpm --dir vendor/codex-claude-voltagent-client codex:smoke"
  );
  assert.ok((await readFile(vendoredProvenancePath, "utf8")).includes("Imported commit:"));
});
