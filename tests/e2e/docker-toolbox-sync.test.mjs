import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  compileToolboxPolicyFromDirectory,
  compileDockerMcpRuntimePlan
} from "../../packages/infrastructure/dist/index.js";

test("compileDockerMcpRuntimePlan returns deterministic Docker profile and server output", () => {
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  const first = compileDockerMcpRuntimePlan(policy);
  const second = compileDockerMcpRuntimePlan(policy);

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(first.profiles.some((profile) => profile.id === "bootstrap"));
  assert.ok(first.profiles.some((profile) => profile.id === "docs-research"));
  assert.ok(first.profiles.some((profile) => profile.id === "core-dev+docs-research"));
  assert.ok(first.profiles.some((profile) => profile.id === "core-dev+runtime-observe"));
  assert.ok(first.servers.some((server) => server.id === "kubernetes-read"));

  const canonicalNames = first.profiles.map((profile) => profile.dockerProfileName);
  assert.equal(new Set(canonicalNames).size, canonicalNames.length);
  assert.ok(first.servers.some((server) => server.id === "mimir-control"));
});

test("sync-mcp-profiles dry-run output remains deterministic", async () => {
  const payload = { generatedAt: "2026-01-01T00:00:00.000Z" };
  const first = await runSyncCommand(["--json", JSON.stringify(payload), "--no-pretty"], {
    MIMIR_DOCKER_RUNTIME_GENERATED_AT: payload.generatedAt
  });
  const second = await runSyncCommand(["--json", JSON.stringify(payload), "--no-pretty"], {
    MIMIR_DOCKER_RUNTIME_GENERATED_AT: payload.generatedAt
  });

  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(second.exitCode, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);

  const result = JSON.parse(first.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.apply.status, "dry-run");
  assert.ok(result.apply.commands.length > 0);
});

test("sync-mcp-profiles apply mode fails clearly when local Docker MCP profiles are unavailable", async () => {
  const result = await runSyncCommand(
    ["--apply", "--json", JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z" }), "--no-pretty"],
    {
      MIMIR_DOCKER_RUNTIME_GENERATED_AT: "2026-01-01T00:00:00.000Z"
    }
  );

  assert.notEqual(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.dryRun, false);
  assert.equal(payload.apply.status, "unsupported");
  assert.equal(payload.apply.compatibility.supported, false);
  assert.ok(
    payload.apply.compatibility.nextSteps.some((step) =>
      step.includes("docker mcp feature enable profiles")
    )
  );
});

test("sync-mcp-profiles apply mode shells out when docker mcp profile support exists", async () => {
  const stub = createDockerStub(true);
  try {
    const result = await runSyncCommand(
      ["--apply", "--json", JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z" }), "--no-pretty"],
      {
        MIMIR_DOCKER_EXECUTABLE: process.execPath,
        MIMIR_DOCKER_EXECUTABLE_ARGS_JSON: JSON.stringify([stub.stubScript]),
        MIMIR_DOCKER_RUNTIME_GENERATED_AT: "2026-01-01T00:00:00.000Z",
        DOCKER_STUB_LOG: stub.logFile
      }
    );

    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.apply.status, "applied");
    assert.equal(payload.apply.commandResults.length, payload.plan.profiles.length);

    const bootstrapCommand = payload.apply.plan.commands.find(
      (command) => command.profileId === "bootstrap"
    );
    assert.ok(bootstrapCommand);
    assert.deepEqual(bootstrapCommand.argv.slice(0, 6), [
      "mcp",
      "profile",
      "create",
      "--name",
      "bootstrap",
      "--id"
    ]);
    assert.deepEqual(bootstrapCommand.serverRefs, [
      "file://./docker/mcp/servers/mimir-control.yaml",
      "file://./docker/mcp/servers/mimir-core.yaml"
    ]);

    const docsCommand = payload.apply.plan.commands.find(
      (command) => command.profileId === "docs-research"
    );
    assert.ok(docsCommand);
    assert.ok(
      docsCommand.serverRefs.includes("catalog://mcp/docker-mcp-catalog/brave-search")
    );
    assert.ok(
      docsCommand.serverRefs.includes("catalog://mcp/docker-mcp-catalog/docker-docs")
    );

    const compositeCommand = payload.apply.plan.commands.find(
      (command) => command.profileId === "core-dev+runtime-observe"
    );
    assert.ok(compositeCommand);
    assert.ok(
      compositeCommand.serverRefs.includes("catalog://mcp/docker-mcp-catalog/grafana-observe")
    );
    assert.ok(
      compositeCommand.serverRefs.includes("catalog://mcp/docker-mcp-catalog/docker-read")
    );
    assert.ok(
      compositeCommand.serverRefs.includes(
        "catalog://mcp/docker-mcp-catalog/kubernetes-read"
      )
    );

    const log = readFileSync(stub.logFile, "utf8").trim().split(/\r?\n/);
    assert.equal(log.length, payload.plan.profiles.length);
  } finally {
    rmSync(stub.rootDir, { recursive: true, force: true });
  }
});

test("sync-mcp-profiles rejects unknown flags and missing --source values", async () => {
  const unknownFlag = await runSyncCommand(["--bogus"], {
    MIMIR_DOCKER_RUNTIME_GENERATED_AT: "2026-01-01T00:00:00.000Z"
  });
  assert.notEqual(unknownFlag.exitCode, 0);
  assert.match(unknownFlag.stderr, /Unknown flag '--bogus'/);

  const missingSource = await runSyncCommand(["--source"], {
    MIMIR_DOCKER_RUNTIME_GENERATED_AT: "2026-01-01T00:00:00.000Z"
  });
  assert.notEqual(missingSource.exitCode, 0);
  assert.match(missingSource.stderr, /--source requires a directory path/);
});

function runSyncCommand(args, extraEnv = {}) {
  const scriptPath = path.join(process.cwd(), "scripts", "docker", "sync-mcp-profiles.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function createDockerStub(supported) {
  const rootDir = mkdtempSync(path.join(tmpdir(), "mimir-docker-stub-"));
  const logFile = path.join(rootDir, "docker.log");
  const stubScript = path.join(rootDir, "docker-stub.cjs");
  const helpText = supported
    ? [
        "Docker MCP Toolkit's CLI - Manage your MCP servers and clients.",
        "",
        "Usage: docker mcp [OPTIONS]",
        "",
        "Available Commands:",
        "  catalog     Manage MCP server catalogs",
        "  client      Manage MCP clients",
        "  config      Manage the configuration",
        "  feature     Manage experimental features",
        "  gateway     Manage the MCP Server gateway",
        "  profile     Manage profiles",
        "  server      Manage servers",
        "  tools       Manage tools",
        "  version     Show the version information",
        ""
      ].join("\n")
    : [
        "Docker MCP Toolkit's CLI - Manage your MCP servers and clients.",
        "",
        "Usage: docker mcp [OPTIONS]",
        "",
        "Available Commands:",
        "  catalog     Manage MCP server catalogs",
        "  client      Manage MCP clients",
        "  config      Manage the configuration",
        "  feature     Manage experimental features",
        "  gateway     Manage the MCP Server gateway",
        "  server      Manage servers",
        "  tools       Manage tools",
        "  version     Show the version information",
        ""
      ].join("\n");

  writeFileSync(
    stubScript,
    [
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const logFile = process.env.DOCKER_STUB_LOG;",
      `const helpText = ${JSON.stringify(helpText)};`,
      "if (args[0] === 'mcp' && args[1] === '--help') {",
      "  process.stdout.write(helpText);",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'mcp' && args[1] === 'profile' && args[2] === 'create') {",
      "  if (logFile) { fs.appendFileSync(logFile, JSON.stringify(args) + '\\n'); }",
      "  process.stdout.write('profile created\\n');",
      "  process.exit(0);",
      "}",
      "process.stdout.write('ok\\n');",
      "process.exit(0);",
      ""
    ].join("\n"),
    "utf8"
  );

  return { rootDir, logFile, stubScript };
}
