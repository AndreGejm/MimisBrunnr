import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  compileToolboxPolicyFromDirectory,
  compileDockerMcpRuntimePlan,
  buildDockerMcpRuntimeApplyPlan
} from "../../packages/infrastructure/dist/index.js";

test("compileDockerMcpRuntimePlan returns deterministic Docker profile and server output", () => {
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  const first = compileDockerMcpRuntimePlan(policy);
  const second = compileDockerMcpRuntimePlan(policy);

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(first.profiles.some((profile) => profile.id === "bootstrap"));
  assert.ok(first.profiles.some((profile) => profile.id === "docs-research"));

  const canonicalNames = first.profiles.map((profile) => profile.dockerProfileName);
  assert.equal(new Set(canonicalNames).size, canonicalNames.length);
  assert.ok(first.servers.some((server) => server.id === "mimir-control"));
  assert.ok(first.servers.some((server) => server.id === "kubernetes-read"));
  assert.ok(
    first.servers.some((server) => server.id === "dockerhub-read"),
    "compileDockerMcpRuntimePlan must include dockerhub-read server"
  );
});

test("sync-mcp-profiles apply mode is blocked and omits descriptor-only dockerhub-read from server refs", async () => {
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

    // dockerhub-read is descriptor-only: apply must be blocked
    assert.notEqual(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.apply.status, "blocked");
    assert.ok(
      Array.isArray(payload.apply.blockedServers),
      "blocked apply must report blockedServers array"
    );
    assert.ok(
      payload.apply.blockedServers.some((s) => s.id === "dockerhub-read"),
      "blockedServers must include dockerhub-read"
    );

    // No catalog refs for descriptor-only servers anywhere in the plan commands
    for (const command of payload.apply.plan.commands) {
      assert.ok(
        !command.serverRefs.some((ref) => ref.includes("dockerhub-read")),
        `profile '${command.profileId}' must NOT emit a catalog ref for descriptor-only dockerhub-read`
      );
    }

    const bootstrapCommand = payload.apply.plan.commands.find(
      (command) => command.profileId === "bootstrap"
    );
    assert.ok(bootstrapCommand, "bootstrap apply command must exist");
    assert.ok(
      !bootstrapCommand.serverRefs.some((ref) => ref.includes("dockerhub-read")),
      "bootstrap command must NOT include dockerhub-read server ref"
    );
  } finally {
    rmSync(stub.rootDir, { recursive: true, force: true });
  }
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

test("sync-mcp-profiles apply mode is blocked when descriptor-only servers exist, plan commands use correct catalog IDs", async () => {
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

    // With checked-in manifests several profiles include descriptor-only servers
    // (dockerhub-read, kubernetes-read, github-read, docker-read, docker-admin,
    //  github-write). Apply must be blocked; no profile-create commands are run.
    assert.notEqual(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.apply.status, "blocked");
    assert.ok(Array.isArray(payload.apply.blockedServers));
    assert.ok(payload.apply.blockedServers.some((s) => s.id === "dockerhub-read"));

    // Bootstrap command only references owned file URIs
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

    // Catalog-mode servers use catalogServerId (not the policy server id)
    const docsCommand = payload.apply.plan.commands.find(
      (command) => command.profileId === "docs-research"
    );
    assert.ok(docsCommand);
    assert.ok(
      docsCommand.serverRefs.includes("catalog://mcp/docker-mcp-catalog/brave"),
      "docs-research must reference brave-search via catalogServerId 'brave'"
    );
    assert.ok(
      docsCommand.serverRefs.includes("catalog://mcp/docker-mcp-catalog/docker-docs")
    );
    assert.ok(
      !docsCommand.serverRefs.some((ref) => ref.includes("kubernetes-read")),
      "docs-research must not emit kubernetes-read catalog ref"
    );

    // No docker profile create commands were shelled out (logFile absent or empty)
    let logLines = [];
    try {
      logLines = readFileSync(stub.logFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
    } catch {
      // logFile was never written; acceptable
    }
    assert.equal(logLines.length, 0, "no docker profile create commands must be run when apply is blocked");
  } finally {
    rmSync(stub.rootDir, { recursive: true, force: true });
  }
});

test("compileDockerMcpRuntimePlan exposes dockerApplyMode catalog and catalogServerId on catalog-mode peer servers", () => {
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const plan = compileDockerMcpRuntimePlan(policy);

  const braveServer = plan.servers.find((s) => s.id === "brave-search");
  assert.ok(braveServer, "brave-search must appear in the runtime plan");
  assert.equal(
    braveServer.dockerApplyMode,
    "catalog",
    "brave-search must expose dockerApplyMode: catalog (declared in its server manifest dockerRuntime stanza)"
  );
  assert.equal(
    braveServer.catalogServerId,
    "brave",
    "brave-search catalogServerId must be 'brave' (the live Docker catalog name), not 'brave-search'"
  );
});

test("compileDockerMcpRuntimePlan marks descriptor-only peer servers with blockedReason and no catalogServerId", () => {
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const plan = compileDockerMcpRuntimePlan(policy);

  const dockerhubServer = plan.servers.find((s) => s.id === "dockerhub-read");
  assert.ok(dockerhubServer, "dockerhub-read must appear in the runtime plan");
  assert.equal(
    dockerhubServer.dockerApplyMode,
    "descriptor-only",
    "dockerhub-read must expose dockerApplyMode: descriptor-only; the live dockerhub catalog server exposes mutation tools"
  );
  assert.ok(
    typeof dockerhubServer.blockedReason === "string" && dockerhubServer.blockedReason.length > 0,
    "dockerhub-read must expose a non-empty blockedReason"
  );
  assert.equal(
    dockerhubServer.catalogServerId,
    undefined,
    "descriptor-only server dockerhub-read must not expose a catalogServerId"
  );
});

test("sync-mcp-profiles dry-run apply commands use catalogServerId for catalog-mode peer server refs", async () => {
  const result = await runSyncCommand(
    ["--json", JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z" }), "--no-pretty"],
    { MIMIR_DOCKER_RUNTIME_GENERATED_AT: "2026-01-01T00:00:00.000Z" }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const output = JSON.parse(result.stdout);

  const docsCommand = output.apply.commands.find((c) => c.profileId === "docs-research");
  assert.ok(docsCommand, "docs-research command must appear in dry-run apply plan");
  assert.ok(
    docsCommand.serverRefs.includes("catalog://mcp/docker-mcp-catalog/brave"),
    "docs-research must reference brave-search using catalogServerId 'brave', not the policy server id 'brave-search'"
  );
  assert.ok(
    !docsCommand.serverRefs.includes("catalog://mcp/docker-mcp-catalog/brave-search"),
    "docs-research must NOT emit 'brave-search' as the Docker catalog server ID"
  );
});

test("sync-mcp-profiles dry-run apply commands omit descriptor-only servers from catalog refs", async () => {
  const result = await runSyncCommand(
    ["--json", JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z" }), "--no-pretty"],
    { MIMIR_DOCKER_RUNTIME_GENERATED_AT: "2026-01-01T00:00:00.000Z" }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const output = JSON.parse(result.stdout);

  for (const command of output.apply.commands) {
    assert.ok(
      !command.serverRefs.some((ref) => ref.includes("dockerhub-read")),
      `profile '${command.profileId}' must NOT emit a catalog ref for descriptor-only server 'dockerhub-read'`
    );
  }
});

test("sync-mcp-profiles apply mode returns blocked when compiled plan contains descriptor-only servers in profiles", async () => {
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

    assert.notEqual(result.exitCode, 0, "apply must exit non-zero when descriptor-only servers are in profiles");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(
      payload.apply.status,
      "blocked",
      "apply status must be 'blocked' when compiled plan contains descriptor-only servers in profiles"
    );
    assert.ok(
      Array.isArray(payload.apply.blockedServers),
      "payload.apply.blockedServers must be an array reporting descriptor-only servers that caused the block"
    );
    assert.ok(
      payload.apply.blockedServers.some((s) => s.id === "dockerhub-read"),
      "blockedServers must include dockerhub-read"
    );
  } finally {
    rmSync(stub.rootDir, { recursive: true, force: true });
  }
});

test("sync-mcp-profiles dry-run succeeds and reports dockerApplyMode metadata per server in plan", async () => {
  const result = await runSyncCommand(
    ["--json", JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z" }), "--no-pretty"],
    { MIMIR_DOCKER_RUNTIME_GENERATED_AT: "2026-01-01T00:00:00.000Z" }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.dryRun, true);

  const planServers = output.plan.servers;
  assert.ok(Array.isArray(planServers), "dry-run plan must include a servers array");

  const braveServer = planServers.find((s) => s.id === "brave-search");
  assert.ok(braveServer, "dry-run plan must include brave-search server");
  assert.equal(
    braveServer.dockerApplyMode,
    "catalog",
    "brave-search must report dockerApplyMode: catalog in dry-run plan output"
  );
  assert.equal(
    braveServer.catalogServerId,
    "brave",
    "brave-search must report catalogServerId: brave in dry-run plan output"
  );

  const dockerhubServer = planServers.find((s) => s.id === "dockerhub-read");
  assert.ok(dockerhubServer, "dry-run plan must include dockerhub-read server");
  assert.equal(
    dockerhubServer.dockerApplyMode,
    "descriptor-only",
    "dockerhub-read must report dockerApplyMode: descriptor-only in dry-run plan output"
  );
  assert.ok(
    typeof dockerhubServer.blockedReason === "string" && dockerhubServer.blockedReason.length > 0,
    "dockerhub-read must report a non-empty blockedReason in dry-run plan output"
  );
});

test("buildDockerMcpRuntimeApplyPlan blocks peer server with missing dockerApplyMode and omits catalog ref", () => {
  const minimalPlan = {
    manifestRevision: "test-rev",
    generatedAt: "2026-01-01T00:00:00.000Z",
    servers: [
      {
        id: "owned-server",
        dockerServerName: "owned-server",
        source: "owned",
        kind: "control",
        toolIds: []
      },
      {
        id: "peer-no-metadata",
        dockerServerName: "peer-no-metadata",
        source: "peer",
        kind: "peer",
        toolIds: []
        // no dockerApplyMode, no catalogServerId
      }
    ],
    profiles: [
      {
        id: "test-profile",
        dockerProfileName: "test-profile",
        sessionMode: "toolbox-activated",
        serverIds: ["owned-server", "peer-no-metadata"],
        toolIds: []
      }
    ]
  };

  const applyPlan = buildDockerMcpRuntimeApplyPlan(minimalPlan);

  const command = applyPlan.commands.find((c) => c.profileId === "test-profile");
  assert.ok(command, "test-profile command must exist");

  // owned server emits a file:// ref
  assert.ok(
    command.serverRefs.some((ref) => ref === "file://./docker/mcp/servers/owned-server.yaml"),
    "serverRefs must include file:// ref for owned-server"
  );

  // peer with no metadata must NOT emit any catalog:// ref
  assert.ok(
    !command.serverRefs.some((ref) => ref.includes("catalog://")),
    "serverRefs must NOT include any catalog:// ref when peer has no dockerApplyMode"
  );

  // command.blockedServers must include the peer
  assert.ok(
    Array.isArray(command.blockedServers) &&
      command.blockedServers.some((s) => s.id === "peer-no-metadata"),
    "command.blockedServers must include peer-no-metadata"
  );

  const commandBlocked = command.blockedServers.find((s) => s.id === "peer-no-metadata");
  assert.ok(
    /missing docker[Aa]pply[Mm]ode|missing apply metadata/i.test(commandBlocked.blockedReason),
    `blockedReason must mention missing dockerApplyMode or apply metadata, got: '${commandBlocked.blockedReason}'`
  );

  // applyPlan.blockedServers (plan-level) must also include the peer
  assert.ok(
    Array.isArray(applyPlan.blockedServers) &&
      applyPlan.blockedServers.some((s) => s.id === "peer-no-metadata"),
    "applyPlan.blockedServers must include peer-no-metadata"
  );

  const planBlocked = applyPlan.blockedServers.find((s) => s.id === "peer-no-metadata");
  assert.ok(
    /missing docker[Aa]pply[Mm]ode|missing apply metadata/i.test(planBlocked.blockedReason),
    `plan-level blockedReason must mention missing dockerApplyMode or apply metadata, got: '${planBlocked.blockedReason}'`
  );
});

test("buildDockerMcpRuntimeApplyPlan blocks catalog-mode peer server with missing catalogServerId", () => {
  const minimalPlan = {
    manifestRevision: "test-rev",
    generatedAt: "2026-01-01T00:00:00.000Z",
    servers: [
      {
        id: "peer-catalog-no-id",
        dockerServerName: "peer-catalog-no-id",
        source: "peer",
        kind: "peer",
        toolIds: [],
        dockerApplyMode: "catalog"
        // catalogServerId intentionally absent
      }
    ],
    profiles: [
      {
        id: "test-profile",
        dockerProfileName: "test-profile",
        sessionMode: "toolbox-activated",
        serverIds: ["peer-catalog-no-id"],
        toolIds: []
      }
    ]
  };

  const applyPlan = buildDockerMcpRuntimeApplyPlan(minimalPlan);
  const command = applyPlan.commands.find((c) => c.profileId === "test-profile");
  assert.ok(command, "test-profile command must exist");

  assert.ok(
    !command.serverRefs.some((ref) => ref.includes("catalog://")),
    "catalog-mode peer with missing catalogServerId must NOT emit a catalog:// ref"
  );

  assert.ok(
    Array.isArray(command.blockedServers) &&
      command.blockedServers.some((s) => s.id === "peer-catalog-no-id"),
    "command.blockedServers must include peer-catalog-no-id"
  );

  const blocked = command.blockedServers.find((s) => s.id === "peer-catalog-no-id");
  assert.ok(
    /missing catalogServerId/i.test(blocked.blockedReason),
    `blockedReason must mention missing catalogServerId, got: '${blocked.blockedReason}'`
  );

  assert.ok(
    Array.isArray(applyPlan.blockedServers) &&
      applyPlan.blockedServers.some((s) => s.id === "peer-catalog-no-id"),
    "applyPlan.blockedServers must include peer-catalog-no-id"
  );
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

test("sync-mcp-profiles dry-run emits catalog://mcp/docker-mcp-catalog/semgrep for security-audit and full profiles", async () => {
  const result = await runSyncCommand(
    ["--json", JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z" }), "--no-pretty"],
    { MIMIR_DOCKER_RUNTIME_GENERATED_AT: "2026-01-01T00:00:00.000Z" }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const output = JSON.parse(result.stdout);

  for (const profileId of ["security-audit", "full"]) {
    const command = output.apply.commands.find((c) => c.profileId === profileId);
    assert.ok(command, `${profileId} command must appear in dry-run apply plan`);
    assert.ok(
      command.serverRefs.includes("catalog://mcp/docker-mcp-catalog/semgrep"),
      `${profileId} must reference semgrep-audit using catalogServerId 'semgrep'`
    );
  }
});

test("compileDockerMcpRuntimePlan includes semgrep-audit server with catalog apply mode and catalogServerId semgrep", () => {
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const plan = compileDockerMcpRuntimePlan(policy);

  const semgrepServer = plan.servers.find((s) => s.id === "semgrep-audit");
  assert.ok(semgrepServer, "semgrep-audit must appear in the runtime plan");
  assert.equal(
    semgrepServer.dockerApplyMode,
    "catalog",
    "semgrep-audit must expose dockerApplyMode: catalog"
  );
  assert.equal(
    semgrepServer.catalogServerId,
    "semgrep",
    "semgrep-audit catalogServerId must be 'semgrep' (the live Docker catalog name, not 'semgrep-audit')"
  );
});

test("sync-mcp-profiles dry-run emits catalog://mcp/docker-mcp-catalog/deepwiki for research profiles", async () => {
  const result = await runSyncCommand(
    ["--json", JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z" }), "--no-pretty"],
    { MIMIR_DOCKER_RUNTIME_GENERATED_AT: "2026-01-01T00:00:00.000Z" }
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const output = JSON.parse(result.stdout);

  for (const profileId of ["docs-research", "core-dev+docs-research", "full"]) {
    const command = output.apply.commands.find((c) => c.profileId === profileId);
    assert.ok(command, `${profileId} command must appear in dry-run apply plan`);
    assert.ok(
      command.serverRefs.includes("catalog://mcp/docker-mcp-catalog/deepwiki"),
      `${profileId} must reference deepwiki-read using catalogServerId 'deepwiki'`
    );
  }
});

test("compileDockerMcpRuntimePlan includes deepwiki-read server with catalog apply mode and catalogServerId deepwiki", () => {
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const plan = compileDockerMcpRuntimePlan(policy);

  const deepwikiServer = plan.servers.find((s) => s.id === "deepwiki-read");
  assert.ok(deepwikiServer, "deepwiki-read must appear in the runtime plan");
  assert.equal(
    deepwikiServer.dockerApplyMode,
    "catalog",
    "deepwiki-read must expose dockerApplyMode: catalog"
  );
  assert.equal(
    deepwikiServer.catalogServerId,
    "deepwiki",
    "deepwiki-read catalogServerId must be 'deepwiki' (the live Docker catalog name)"
  );
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
