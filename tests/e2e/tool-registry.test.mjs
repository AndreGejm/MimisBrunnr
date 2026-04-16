import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FileSystemToolRegistry,
  loadToolRegistryFromDirectory,
  validateToolManifest
} from "../../packages/infrastructure/dist/index.js";

const registryDir = path.resolve("docker/tool-registry");

test("docker tool registry loads starter AI tool manifests", () => {
  const registry = loadToolRegistryFromDirectory(registryDir);

  assert.deepEqual(registry.map((tool) => tool.id), ["aider", "codesight", "rtk"]);
  assert.deepEqual(registry.map((tool) => tool.dockerProfile), ["aider", "codesight", "rtk"]);
  assert.equal(registry.find((tool) => tool.id === "rtk")?.memoryWritePolicy, "none");
  assert.equal(registry.find((tool) => tool.id === "aider")?.mounts.workspace, "read_write");
  assert.deepEqual(registry.find((tool) => tool.id === "aider")?.allowedMimirCommands, [
    "assemble-agent-context",
    "create-session-archive",
    "draft-note"
  ]);
});

test("docker tool registry schema preserves governed Mimisbrunnr boundaries", () => {
  const schema = JSON.parse(readFileSync(path.resolve("docker/tool-registry.schema.json"), "utf8"));

  assert.equal(schema.properties.mounts.properties.mimisbrunnr.const, "none");
  assert.deepEqual(schema.properties.memoryWritePolicy.enum, [
    "none",
    "session_only",
    "draft_note_only"
  ]);
  assert.ok(schema.properties.allowedMimirCommands.items.enum.includes("tools-package-plan"));
});

test("tool manifests reject direct mimisbrunnr mounts and unknown Mimir commands", () => {
  assert.throws(
    () => validateToolManifest({
      id: "unsafe",
      displayName: "Unsafe",
      kind: "cli",
      image: "unsafe:local",
      dockerProfile: "unsafe",
      entrypoint: ["unsafe"],
      capabilities: ["edit_files"],
      mounts: {
        workspace: "read_write",
        cache: "none",
        mimisbrunnr: "read_write"
      },
      memoryWritePolicy: "draft_note_only",
      allowedMimirCommands: ["not-a-command"],
      authRole: "operator",
      requiresOperatorReview: true,
      healthcheck: { command: ["unsafe", "--version"] }
    }),
    /mimisbrunnr mount must be none/
  );

  assert.throws(
    () => validateToolManifest({
      id: "bad-command",
      displayName: "Bad Command",
      kind: "cli",
      image: "bad-command:local",
      dockerProfile: "bad-command",
      entrypoint: ["bad-command"],
      capabilities: ["repo_inspection"],
      mounts: {
        workspace: "read_only",
        cache: "none",
        mimisbrunnr: "none"
      },
      memoryWritePolicy: "none",
      allowedMimirCommands: ["not-a-command"],
      authRole: "operator",
      requiresOperatorReview: false,
      healthcheck: { command: ["bad-command", "--version"] }
    }),
    /allowedMimirCommands\[0\] must be a runtime CLI command/
  );
});

test("tool registry reader filters tools and hides environment unless requested", () => {
  const registry = new FileSystemToolRegistry(registryDir);

  const filtered = registry.listTools({ ids: ["aider", "missing-tool"] });

  assert.equal(filtered.registryPath, registryDir);
  assert.deepEqual(filtered.tools.map((tool) => tool.id), ["aider"]);
  assert.equal("environment" in filtered.tools[0], false);
  assert.equal("runtime" in filtered.tools[0], false);
  assert.deepEqual(filtered.warnings, ["Tool manifest 'missing-tool' was not found."]);

  const withEnvironment = registry.listTools({
    ids: ["aider"],
    includeEnvironment: true
  });
  assert.equal(withEnvironment.tools[0].environment.MIMIR_API_URL, "http://mimir-api:8080");
});

test("tool registry reader can include reusable Docker runtime descriptors", () => {
  const registry = new FileSystemToolRegistry(registryDir);

  const result = registry.listTools({ ids: ["aider", "codesight", "rtk"], includeRuntime: true });

  const aider = result.tools.find((tool) => tool.id === "aider");
  assert.ok(aider);
  assert.equal(aider.runtime.compose.service, "aider");
  assert.equal(aider.runtime.compose.profile, "aider");
  assert.deepEqual(aider.runtime.compose.files, [
    "docker/compose.local.yml",
    "docker/compose.tools.yml"
  ]);
  assert.equal(aider.runtime.container.image, "mimir-tool-aider:local");
  assert.equal(aider.runtime.container.workingDir, "/workspace");
  assert.deepEqual(aider.runtime.container.workspaceMount, {
    environmentVariable: "MIMIR_TOOL_WORKSPACE",
    defaultHostPath: "..",
    containerPath: "/workspace",
    access: "read_write"
  });
  assert.deepEqual(aider.runtime.container.cacheMount, {
    volume: "mimir_aider_cache",
    containerPath: "/cache",
    access: "read_write"
  });
  assert.equal(aider.runtime.container.mimisbrunnrMountAllowed, false);
  assert.deepEqual(aider.runtime.environmentKeys, ["MIMIR_API_URL"]);

  const codesight = result.tools.find((tool) => tool.id === "codesight");
  assert.ok(codesight);
  assert.equal(codesight.runtime.compose.service, "codesight");
  assert.equal(codesight.runtime.container.workspaceMount.access, "read_only");
  assert.deepEqual(codesight.runtime.container.cacheMount, {
    volume: "mimir_codesight_cache",
    containerPath: "/cache",
    access: "read_write"
  });

  const rtk = result.tools.find((tool) => tool.id === "rtk");
  assert.ok(rtk);
  assert.equal("cacheMount" in rtk.runtime.container, false);
  assert.deepEqual(rtk.runtime.environmentKeys, []);
});

test("tool registry builds reusable Docker package plans without executing tools", () => {
  const registry = new FileSystemToolRegistry(registryDir);

  const result = registry.getPackagePlan({ ids: ["aider", "rtk"] });

  assert.equal(result.registryPath, registryDir);
  assert.equal(result.packageReady, true);
  assert.deepEqual(result.composeFiles, [
    "docker/compose.local.yml",
    "docker/compose.tools.yml"
  ]);
  assert.deepEqual(result.tools.map((tool) => tool.id), ["aider", "rtk"]);
  assert.deepEqual(result.warnings, []);

  const aider = result.tools.find((tool) => tool.id === "aider");
  assert.ok(aider);
  assert.equal(aider.service, "aider");
  assert.equal(aider.image, "mimir-tool-aider:local");
  assert.deepEqual(aider.composeRun, {
    command: "docker",
    args: [
      "compose",
      "-f",
      "docker/compose.local.yml",
      "-f",
      "docker/compose.tools.yml",
      "--profile",
      "aider",
      "run",
      "--rm",
      "aider"
    ]
  });
  assert.deepEqual(aider.workspaceMount, {
    environmentVariable: "MIMIR_TOOL_WORKSPACE",
    defaultHostPath: "..",
    containerPath: "/workspace",
    access: "read_write"
  });
  assert.deepEqual(aider.cacheMount, {
    volume: "mimir_aider_cache",
    containerPath: "/cache",
    access: "read_write"
  });
  assert.equal(aider.mimisbrunnrMountAllowed, false);
  assert.deepEqual(aider.environmentKeys, ["MIMIR_API_URL"]);
  assert.equal(aider.buildRecipe.path, "docker/tool-images/aider/Dockerfile");
  assert.equal(aider.buildRecipe.exists, false);
  assert.match(aider.caveats.join("\n"), /image must already exist/i);

  const rtk = result.tools.find((tool) => tool.id === "rtk");
  assert.ok(rtk);
  assert.equal("cacheMount" in rtk, false);
  assert.deepEqual(rtk.environmentKeys, []);
  assert.equal(rtk.buildRecipe.path, "docker/tool-images/rtk/Dockerfile");
  assert.equal(rtk.buildRecipe.exists, false);
});

test("tool registry package plans report missing requested tools as not package-ready", () => {
  const registry = new FileSystemToolRegistry(registryDir);

  const result = registry.getPackagePlan({ ids: ["aider", "missing-tool"] });

  assert.equal(result.packageReady, false);
  assert.deepEqual(result.tools.map((tool) => tool.id), ["aider"]);
  assert.deepEqual(result.warnings, ["Tool manifest 'missing-tool' was not found."]);
});
test("tool registry checkTools returns valid results for a clean registry", () => {
  const registry = new FileSystemToolRegistry(registryDir);
  const result = registry.checkTools();

  assert.equal(result.ok, true);
  assert.equal(result.registryPath, registryDir);
  assert.ok(result.generatedAt);
  assert.equal(result.checks.length, 3);
  for (const check of result.checks) {
    assert.equal(check.status, "valid");
    assert.deepEqual(check.errors, []);
    assert.ok(check.toolId);
    assert.ok(check.dockerProfile);
  }
  assert.deepEqual(result.warnings, []);
});

test("tool registry checkTools filters by ids and warns about unfound ids", () => {
  const registry = new FileSystemToolRegistry(registryDir);

  const filtered = registry.checkTools({ ids: ["aider", "missing-tool"] });

  assert.equal(filtered.ok, true);
  assert.equal(filtered.checks.length, 1);
  assert.equal(filtered.checks[0].toolId, "aider");
  assert.equal(filtered.checks[0].status, "valid");
  assert.deepEqual(filtered.warnings, ["Tool manifest 'missing-tool' was not found."]);
});

test("tool registry checkTools returns invalid result for malformed manifest without throwing", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "mimir-test-"));
  try {
    writeFileSync(path.join(tmpDir, "broken.json"), "{ not valid json }", "utf8");
    writeFileSync(path.join(tmpDir, "bad-schema.json"), JSON.stringify({
      id: "bad-tool",
      displayName: "Bad Tool",
      kind: "cli",
      image: "bad:local",
      dockerProfile: "bad-tool",
      entrypoint: ["bad"],
      capabilities: ["edit_files"],
      mounts: { workspace: "read_write", cache: "none", mimisbrunnr: "read_write" },
      memoryWritePolicy: "none",
      allowedMimirCommands: [],
      authRole: "operator",
      requiresOperatorReview: false,
      healthcheck: { command: ["bad", "--version"] }
    }), "utf8");

    const registry = new FileSystemToolRegistry(tmpDir);
    const result = registry.checkTools();

    assert.equal(result.ok, false);
    assert.equal(result.checks.length, 2);

    const brokenCheck = result.checks.find((c) => c.fileName === "broken.json");
    assert.ok(brokenCheck);
    assert.equal(brokenCheck.status, "invalid");
    assert.ok(brokenCheck.errors.length > 0);

    const schemaCheck = result.checks.find((c) => c.fileName === "bad-schema.json");
    assert.ok(schemaCheck);
    assert.equal(schemaCheck.status, "invalid");
    assert.equal(schemaCheck.toolId, "bad-tool");
    assert.ok(schemaCheck.errors.length > 0);
    assert.match(schemaCheck.errors[0], /mimisbrunnr mount must be none/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
test("tool registry checkTools filters invalid requested manifests without false missing warnings", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "mimir-test-filter-"));
  try {
    writeFileSync(path.join(tmpDir, "aider.json"), JSON.stringify({
      id: "aider",
      displayName: "Aider",
      kind: "coding_agent",
      image: "aider:local",
      dockerProfile: "aider",
      entrypoint: ["aider"],
      capabilities: ["edit_files"],
      mounts: { workspace: "read_write", cache: "none", mimisbrunnr: "read_write" },
      memoryWritePolicy: "draft_note_only",
      allowedMimirCommands: ["draft-note"],
      authRole: "operator",
      requiresOperatorReview: true,
      healthcheck: { command: ["aider", "--version"] }
    }), "utf8");
    writeFileSync(path.join(tmpDir, "broken.json"), "{ not valid json }", "utf8");

    const registry = new FileSystemToolRegistry(tmpDir);
    const result = registry.checkTools({ ids: ["aider"] });

    assert.equal(result.ok, false);
    assert.deepEqual(result.checks.map((check) => check.fileName), ["aider.json"]);
    assert.equal(result.checks[0].toolId, "aider");
    assert.equal(result.checks[0].status, "invalid");
    assert.deepEqual(result.warnings, []);

    const missing = registry.checkTools({ ids: ["missing-tool"] });
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.checks, []);
    assert.deepEqual(missing.warnings, ["Tool manifest 'missing-tool' was not found."]);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
