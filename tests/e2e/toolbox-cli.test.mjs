import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawn } from "node:child_process";
import * as application from "../../packages/application/dist/index.js";
import {
  compileToolboxPolicyFromDirectory,
  issueToolboxSessionLease,
  SqliteAuditLog
} from "../../packages/infrastructure/dist/index.js";

test("mimir-cli exposes toolbox discovery, activation, and sync commands from repo manifests", async () => {
  const sqlitePath = await createTempSqlitePath();
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const listResult = await runCliCommand(
    ["list-toolboxes", "--json", "{}", "--no-pretty"],
    env
  );
  assert.equal(listResult.exitCode, 0, listResult.stderr);
  const listPayload = JSON.parse(listResult.stdout);
  assert.equal(listPayload.ok, true);
  assert.ok(
    listPayload.toolboxes.some((toolbox) => toolbox.id === "docs-research")
  );
  const docsResearchListing = listPayload.toolboxes.find(
    (toolbox) => toolbox.id === "docs-research"
  );
  assert.equal(
    docsResearchListing.summary,
    "External docs, web search, and GitHub read for implementation research."
  );
  assert.equal(docsResearchListing.trustClass, "external-read");
  assert.ok(
    docsResearchListing.exampleTasks.includes(
      "Compare upstream docs with the current implementation"
    )
  );
  assert.ok(
    listPayload.toolboxes.some((toolbox) => toolbox.id === "core-dev+docs-research")
  );
  assert.ok(
    listPayload.toolboxes.some((toolbox) => toolbox.id === "core-dev+runtime-observe")
  );
  assert.equal(listPayload.auditEvents[0].type, "toolbox_discovery");

  const describeResult = await runCliCommand(
    [
      "describe-toolbox",
      "--json",
      JSON.stringify({ toolboxId: "docs-research" }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(describeResult.exitCode, 0, describeResult.stderr);
  const describePayload = JSON.parse(describeResult.stdout);
  assert.equal(describePayload.ok, true);
  assert.equal(describePayload.toolbox.id, "docs-research");
  assert.equal(
    describePayload.toolbox.summary,
    "External docs, web search, and GitHub read for implementation research."
  );
  assert.ok(
    describePayload.toolbox.exampleTasks.includes(
      "Compare upstream docs with the current implementation"
    )
  );
  assert.equal(describePayload.auditEvents[0].type, "toolbox_discovery");
  assert.equal(describePayload.toolbox.trustClass, "external-read");
  assert.equal(describePayload.toolbox.workflow.activationMode, "session-switch");
  assert.equal(describePayload.toolbox.workflow.sessionMode, "toolbox-activated");
  assert.equal(describePayload.toolbox.profile.fallbackProfile, "core-dev");
  assert.equal(
    describePayload.diagnostics.profileRevision,
    policy.profiles["docs-research"].profileRevision
  );
  assert.deepEqual(describePayload.toolbox.antiUseCases, [
    { type: "denied_category", category: "github-write" },
    { type: "denied_category", category: "docker-write" },
    { type: "denied_category", category: "deployment" }
  ]);
  assert.ok(
    describePayload.toolbox.suppressedTools.some(
      (tool) =>
        tool.toolId === "github.search" &&
        tool.semanticCapabilityId === "github.search" &&
        tool.boundary === "client-overlay-reduction" &&
        tool.reasons.includes("suppressed-semantic-capability:github.search")
    )
  );
  assert.ok(
    describePayload.toolbox.suppressedTools.some(
      (tool) =>
        tool.toolId === "github.pull_request.read" &&
        tool.semanticCapabilityId === "github.pull-request.read" &&
        tool.boundary === "client-overlay-reduction" &&
        tool.reasons.includes("suppressed-semantic-capability:github.pull-request.read")
    )
  );

  const describeCompositeResult = await runCliCommand(
    [
      "describe-toolbox",
      "--json",
      JSON.stringify({ toolboxId: "core-dev+docs-research" }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(describeCompositeResult.exitCode, 0, describeCompositeResult.stderr);
  const describeCompositePayload = JSON.parse(describeCompositeResult.stdout);
  assert.equal(describeCompositePayload.ok, true);
  assert.equal(describeCompositePayload.toolbox.id, "core-dev+docs-research");
  assert.equal(
    describeCompositePayload.toolbox.summary,
    "Code changes that also need external documentation and GitHub read context."
  );
  assert.ok(
    describeCompositePayload.toolbox.exampleTasks.includes(
      "Implement a fix while checking upstream docs"
    )
  );
  assert.equal(describeCompositePayload.toolbox.profile.composite, true);
  assert.deepEqual(
    describeCompositePayload.toolbox.profile.baseProfiles,
    ["core-dev", "docs-research"]
  );
  assert.equal(
    describeCompositePayload.toolbox.profile.compositeReason,
    "repeated_workflow"
  );
  assert.equal(
    describeCompositePayload.diagnostics.profileRevision,
    policy.profiles["core-dev+docs-research"].profileRevision
  );
  assert.deepEqual(describeCompositePayload.toolbox.antiUseCases, [
    { type: "denied_category", category: "github-write" },
    { type: "denied_category", category: "docker-write" },
    { type: "denied_category", category: "deployment" }
  ]);
  assert.ok(
    describeCompositePayload.toolbox.suppressedTools.some(
      (tool) =>
        tool.toolId === "github.search" &&
        tool.semanticCapabilityId === "github.search" &&
        tool.boundary === "client-overlay-reduction"
    )
  );

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "docs-research",
        taskSummary: "Need external docs and repo read access"
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approved, true);
  assert.equal(activationPayload.activation.approvedProfile, "docs-research");
  assert.equal(typeof activationPayload.activation.leaseToken, "string");
  assert.equal(activationPayload.activation.reasonCode, "toolbox_activation_approved");
  assert.equal(activationPayload.activation.diagnostics.profileId, "docs-research");
  assert.equal(
    activationPayload.activation.diagnostics.profileRevision,
    policy.profiles["docs-research"].profileRevision
  );
  assert.equal(activationPayload.activation.diagnostics.lease.issued, true);
  assert.ok(
    activationPayload.activation.auditEvents.some(
      (event) =>
        event.type === "toolbox_activation_approved" &&
        event.profileRevision === policy.profiles["docs-research"].profileRevision
    )
  );
  assert.equal(activationPayload.activation.handoff.mode, "reconnect");
  assert.equal(activationPayload.activation.handoff.targetProfileId, "docs-research");
  assert.equal(activationPayload.activation.downgradeTarget, "core-dev");
  assert.equal(
    activationPayload.activation.details.approval.trustClass,
    "external-read"
  );
  assert.equal(
    activationPayload.activation.handoff.downgradeTarget,
    "core-dev"
  );
  assert.equal(
    activationPayload.activation.handoff.handoffStrategy,
    "env-reconnect"
  );
  assert.equal(
    activationPayload.activation.handoff.handoffPresetRef,
    "codex.toolbox"
  );
  assert.equal(
    activationPayload.activation.handoff.clientPresetRef,
    "codex.toolbox"
  );
  assert.equal(
    activationPayload.activation.handoff.client.handoffStrategy,
    "env-reconnect"
  );
  assert.equal(
    activationPayload.activation.handoff.client.handoffPresetRef,
    "codex.toolbox"
  );
  assert.equal(
    activationPayload.activation.handoff.client.clientPresetRef,
    "codex.toolbox"
  );
  assert.equal(
    activationPayload.activation.handoff.environment.MAB_TOOLBOX_ACTIVE_PROFILE,
    "docs-research"
  );
  assert.equal(
    activationPayload.activation.handoff.environment.MAB_TOOLBOX_SESSION_POLICY_TOKEN,
    "{{leaseToken}}"
  );
  assert.equal(
    activationPayload.activation.handoff.actorDefaults.sessionPolicyTokenFromEnv,
    "MAB_TOOLBOX_SESSION_POLICY_TOKEN"
  );
  assert.match(
    activationPayload.activation.leaseExpiresAt,
    /^\d{4}-\d{2}-\d{2}T/
  );
  assert.equal(
    activationPayload.activation.handoff.lease.expiresAt,
    activationPayload.activation.leaseExpiresAt
  );

  const activeToolsResult = await runCliCommand(
    ["list-active-tools", "--json", "{}", "--no-pretty"],
    env
  );
  assert.equal(activeToolsResult.exitCode, 0, activeToolsResult.stderr);
  const activeToolsPayload = JSON.parse(activeToolsResult.stdout);
  assert.equal(activeToolsPayload.ok, true);
  assert.ok(
    activeToolsPayload.declaredTools.some(
      (tool) => tool.toolId === "search_context" && tool.availabilityState === "declared"
    )
  );
  assert.ok(
    activeToolsPayload.activeTools.some(
      (tool) => tool.toolId === "search_context" && tool.availabilityState === "active"
    )
  );
  assert.deepEqual(activeToolsPayload.suppressedTools, []);

  const activeToolboxResult = await runCliCommand(
    ["list-active-toolbox", "--json", "{}", "--no-pretty"],
    {
      ...env,
      MAB_TOOLBOX_ACTIVE_PROFILE: "docs-research"
    }
  );
  assert.equal(activeToolboxResult.exitCode, 0, activeToolboxResult.stderr);
  const activeToolboxPayload = JSON.parse(activeToolboxResult.stdout);
  assert.equal(activeToolboxPayload.ok, true);
  assert.equal(activeToolboxPayload.profile.id, "docs-research");
  assert.equal(activeToolboxPayload.workflow.toolboxId, "docs-research");
  assert.equal(activeToolboxPayload.workflow.activationMode, "session-switch");
  assert.equal(activeToolboxPayload.workflow.sessionMode, "toolbox-activated");
  assert.equal(activeToolboxPayload.workflow.requiresApproval, false);
  assert.equal(activeToolboxPayload.workflow.fallbackProfile, "core-dev");
  assert.equal(activeToolboxPayload.profile.fallbackProfile, "core-dev");
  assert.ok(activeToolboxPayload.profile.allowedCategories.includes("docs-search"));
  assert.ok(activeToolboxPayload.profile.deniedCategories.includes("docker-write"));
  assert.equal(activeToolboxPayload.client.id, "codex");
  assert.equal(activeToolboxPayload.client.handoffStrategy, "env-reconnect");
  assert.equal(activeToolboxPayload.client.handoffPresetRef, "codex.toolbox");
  assert.equal(activeToolboxPayload.client.clientPresetRef, "codex.toolbox");
  assert.ok(
    activeToolboxPayload.client.suppressedSemanticCapabilities.includes("github.search")
  );
  assert.ok(
    activeToolboxPayload.client.suppressedTools.some(
      (tool) =>
        tool.toolId === "github.search" &&
        tool.semanticCapabilityId === "github.search" &&
        tool.boundary === "client-overlay-reduction" &&
        tool.reasons.includes("suppressed-semantic-capability:github.search")
    )
  );
  assert.ok(
    activeToolboxPayload.client.suppressedTools.some(
      (tool) =>
        tool.toolId === "github.pull_request.read" &&
        tool.semanticCapabilityId === "github.pull-request.read" &&
        tool.boundary === "client-overlay-reduction" &&
        tool.reasons.includes("suppressed-semantic-capability:github.pull-request.read")
    )
  );

  const deactivationResult = await runCliCommand(
    [
      "deactivate-toolbox",
      "--json",
      JSON.stringify({
        leaseToken: activationPayload.activation.leaseToken
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(deactivationResult.exitCode, 0, deactivationResult.stderr);
  const deactivationPayload = JSON.parse(deactivationResult.stdout);
  assert.equal(deactivationPayload.ok, true);
  assert.equal(deactivationPayload.reasonCode, "toolbox_deactivated");
  assert.equal(deactivationPayload.diagnostics.lease.revoked, true);
  assert.equal(deactivationPayload.handoff.targetProfileId, "bootstrap");
  assert.equal(
    deactivationPayload.handoff.client.handoffStrategy,
    "env-reconnect"
  );
  assert.deepEqual(
    deactivationPayload.handoff.clearEnvironment,
    ["MAB_TOOLBOX_SESSION_POLICY_TOKEN"]
  );

  const history = await readAuditHistory(sqlitePath);
  const actionTypes = history.entries.map((entry) => entry.actionType);
  assert.ok(actionTypes.includes("toolbox_discovery"));
  assert.ok(actionTypes.includes("toolbox_activation_approved"));
  assert.ok(actionTypes.includes("toolbox_lease_issued"));
  assert.ok(actionTypes.includes("toolbox_reconnect_generated"));
  assert.ok(actionTypes.includes("toolbox_deactivated"));

  const syncResult = await runCliCommand(
    [
      "sync-mcp-profiles",
      "--json",
      JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z" }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(syncResult.exitCode, 0, syncResult.stderr);
  const syncPayload = JSON.parse(syncResult.stdout);
  assert.equal(syncPayload.ok, true);
  assert.equal(syncPayload.dryRun, true);
  assert.equal(syncPayload.plan.generatedAt, "2026-01-01T00:00:00.000Z");
  assert.ok(
    syncPayload.plan.profiles.some((profile) => profile.id === "bootstrap")
  );
});

test("mimir-cli check-mcp-profiles reports Docker MCP profile readiness", async () => {
  const stub = createDockerStub(true);
  try {
    const result = await runCliCommand(
      ["check-mcp-profiles", "--json", "{}", "--no-pretty"],
      {
        ...process.env,
        MAB_NODE_ENV: "test",
        MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
        MIMIR_DOCKER_EXECUTABLE: process.execPath,
        MIMIR_DOCKER_EXECUTABLE_ARGS_JSON: JSON.stringify([stub.stubScript])
      }
    );

    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.dockerMcp.profileSupport.supported, true);
    assert.equal(payload.dockerMcp.profileSupport.profileCommandDetected, true);
    assert.ok(payload.dockerMcp.profileSupport.availableCommands.includes("profile"));
    assert.equal(payload.dockerMcp.gatewayProfileSupport.supported, true);
    assert.equal(payload.dockerMcp.gatewayProfileSupport.gatewayRunDetected, true);
    assert.equal(payload.dockerMcp.gatewayProfileSupport.profileFlagDetected, true);
  } finally {
    rmSync(stub.rootDir, { recursive: true, force: true });
  }
});

test("mimir-cli surfaces Codex client materialization metadata and sync-toolbox-client writes deterministic local-stdio config", async (t) => {
  const sqlitePath = await createTempSqlitePath();
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "mimir-codex-client-"));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const activationEnv = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };
  const expectedMaterializationPath = path.join(
    workspaceRoot,
    ".mimir",
    "toolbox",
    "codex.mcp.json"
  );

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "core-dev+voltagent-docs",
        taskSummary: "Need VoltAgent docs while editing the current repository"
      }),
      "--no-pretty"
    ],
    activationEnv,
    workspaceRoot
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(
    activationPayload.activation.handoff.clientMaterialization.format,
    "codex-mcp-json"
  );
  assert.equal(
    activationPayload.activation.handoff.clientMaterialization.path,
    expectedMaterializationPath
  );
  assert.deepEqual(
    activationPayload.activation.handoff.clientMaterialization.serverUsageClasses,
    {
      "voltagent-docs": "docs-only"
    }
  );

  const activeToolboxResult = await runCliCommand(
    ["list-active-toolbox", "--json", "{}", "--no-pretty"],
    {
      ...activationEnv,
      MAB_TOOLBOX_ACTIVE_PROFILE: "core-dev+voltagent-docs"
    },
    workspaceRoot
  );
  assert.equal(activeToolboxResult.exitCode, 0, activeToolboxResult.stderr);
  const activeToolboxPayload = JSON.parse(activeToolboxResult.stdout);
  assert.equal(activeToolboxPayload.ok, true);
  assert.equal(activeToolboxPayload.profile.id, "core-dev+voltagent-docs");
  assert.deepEqual(activeToolboxPayload.client.clientMaterialization, {
    format: "codex-mcp-json",
    path: expectedMaterializationPath,
    serverUsageClasses: {
      "voltagent-docs": "docs-only"
    }
  });

  const activeToolsResult = await runCliCommand(
    ["list-active-tools", "--json", "{}", "--no-pretty"],
    {
      ...activationEnv,
      MAB_TOOLBOX_ACTIVE_PROFILE: "core-dev+voltagent-docs"
    },
    workspaceRoot
  );
  assert.equal(activeToolsResult.exitCode, 0, activeToolsResult.stderr);
  const activeToolsPayload = JSON.parse(activeToolsResult.stdout);
  assert.equal(activeToolsPayload.ok, true);
  assert.ok(
    activeToolsPayload.activeTools.some(
      (tool) =>
        tool.serverId === "voltagent-docs" &&
        tool.toolId === "voltagent.docs.search" &&
        tool.category === "docs-search" &&
        tool.availabilityState === "active"
    ),
    "VoltAgent docs tool must stay active when the dedicated toolbox profile is active"
  );

  const dockerSyncResult = await runCliCommand(
    [
      "sync-mcp-profiles",
      "--json",
      JSON.stringify({ generatedAt: "2026-04-23T12:00:00.000Z" }),
      "--no-pretty"
    ],
    activationEnv,
    workspaceRoot
  );
  assert.equal(dockerSyncResult.exitCode, 0, dockerSyncResult.stderr);
  const dockerSyncPayload = JSON.parse(dockerSyncResult.stdout);
  assert.equal(dockerSyncPayload.ok, true);
  assert.ok(
    dockerSyncPayload.apply.omittedServers.some(
      (server) =>
        server.id === "voltagent-docs" &&
        server.blockedReason.includes("client-materialized local-stdio peer")
    ),
    "Docker sync must omit, not block, the VoltAgent local-stdio peer"
  );
  assert.ok(
    !dockerSyncPayload.apply.blockedServers?.some(
      (server) => server.id === "voltagent-docs"
    ),
    "VoltAgent local-stdio peer must not appear in blocked Docker servers"
  );

  const dryRunResult = await runCliCommand(
    ["sync-toolbox-client", "--json", "{}", "--no-pretty"],
    {
      ...activationEnv,
      MAB_TOOLBOX_ACTIVE_PROFILE: "core-dev+voltagent-docs"
    },
    workspaceRoot
  );
  assert.equal(dryRunResult.exitCode, 0, dryRunResult.stderr);
  const dryRunPayload = JSON.parse(dryRunResult.stdout);
  assert.equal(dryRunPayload.ok, true);
  assert.equal(dryRunPayload.dryRun, true);
  assert.equal(dryRunPayload.materialization.format, "codex-mcp-json");
  assert.equal(dryRunPayload.materialization.path, expectedMaterializationPath);
  assert.deepEqual(dryRunPayload.materialization.serverIds, ["voltagent-docs"]);
  assert.deepEqual(dryRunPayload.materialization.serverUsageClasses, {
    "voltagent-docs": "docs-only"
  });
  assert.deepEqual(dryRunPayload.materialization.content, {
    mcpServers: {
      "voltagent-docs": {
        command: "npx",
        args: ["-y", "@voltagent/docs-mcp"]
      }
    }
  });

  const applyResult = await runCliCommand(
    ["sync-toolbox-client", "--apply", "--json", "{}", "--no-pretty"],
    {
      ...activationEnv,
      MAB_TOOLBOX_ACTIVE_PROFILE: "core-dev+voltagent-docs"
    },
    workspaceRoot
  );
  assert.equal(applyResult.exitCode, 0, applyResult.stderr);
  const applyPayload = JSON.parse(applyResult.stdout);
  assert.equal(applyPayload.ok, true);
  assert.equal(applyPayload.dryRun, false);
  assert.equal(applyPayload.materialization.path, expectedMaterializationPath);
  assert.deepEqual(
    JSON.parse(readFileSync(expectedMaterializationPath, "utf8")),
    dryRunPayload.materialization.content
  );
});

test("mimir-cli accepts the legacy VoltAgent docs toolbox id and resolves it to the canonical profile", async (t) => {
  const sqlitePath = await createTempSqlitePath();
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "mimir-voltagent-alias-"));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "core-dev+voltagent-dev",
        taskSummary: "Need VoltAgent docs while editing the current repository"
      }),
      "--no-pretty"
    ],
    {
      ...process.env,
      MAB_NODE_ENV: "test",
      MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
      MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
      MAB_TOOLBOX_CLIENT_ID: "codex",
      MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
      MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
      MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
      MAB_SQLITE_PATH: sqlitePath
    },
    workspaceRoot
  );

  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approvedToolbox, "core-dev+voltagent-dev");
  assert.equal(activationPayload.activation.approvedProfile, "core-dev+voltagent-docs");
  assert.equal(
    activationPayload.activation.handoff.targetProfileId,
    "core-dev+voltagent-docs"
  );
});

test("mimir-cli sync-mcp-profiles apply is blocked before execution when descriptor-only servers are present", async () => {
  const stub = createDockerStub(true);
  try {
    const env = {
      ...process.env,
      MAB_NODE_ENV: "test",
      MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
      MIMIR_DOCKER_EXECUTABLE: process.execPath,
      MIMIR_DOCKER_EXECUTABLE_ARGS_JSON: JSON.stringify([stub.stubScript]),
      DOCKER_STUB_LOG: stub.logFile
    };

    const result = await runCliCommand(
      [
        "sync-mcp-profiles",
        "--apply",
        "--json",
        JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z" }),
        "--no-pretty"
      ],
      env
    );

    assert.notEqual(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.dryRun, false);
    assert.equal(payload.plan.generatedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(payload.apply.status, "blocked");
    assert.ok(payload.apply.blockedServers.some((server) => server.id === "dockerhub-read"));

    const bootstrapCommand = payload.apply.plan.commands.find(
      (command) => command.profileId === "bootstrap"
    );
    assert.ok(bootstrapCommand);
    assert.deepEqual(bootstrapCommand.serverRefs, [
      "file://./docker/mcp/servers/mimir-control.yaml",
      "file://./docker/mcp/servers/mimir-core.yaml"
    ]);

    let logLines = [];
    try {
      logLines = readFileSync(stub.logFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
    } catch {
      // Apply was blocked before docker profile commands were executed.
    }
    assert.equal(logLines.length, 0);
  } finally {
    rmSync(stub.rootDir, { recursive: true, force: true });
  }
});

test("mimir-cli returns structured activation denial diagnostics and persists the denial", async () => {
  const sqlitePath = await createTempSqlitePath();
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "missing-toolbox",
        requiredCategories: ["search"]
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approved, false);
  assert.equal(
    activationPayload.activation.reasonCode,
    "toolbox_activation_denied_no_matching_toolbox"
  );
  assert.equal(activationPayload.activation.diagnostics.requestedToolbox, "missing-toolbox");
  assert.equal(
    activationPayload.activation.diagnostics.profileRevision,
    policy.profiles.bootstrap.profileRevision
  );
  assert.deepEqual(activationPayload.activation.diagnostics.requiredCategories, ["search"]);
  assert.equal(activationPayload.activation.auditEvents[0].type, "toolbox_activation_denied");
  assert.equal(
    activationPayload.activation.auditEvents[0].profileRevision,
    policy.profiles.bootstrap.profileRevision
  );
  assert.equal(
    activationPayload.activation.auditEvents[0].details.reasonCode,
    "toolbox_activation_denied_no_matching_toolbox"
  );
  assert.equal(activationPayload.activation.handoff.targetProfileId, "bootstrap");
  assert.equal(activationPayload.activation.leaseExpiresAt, null);
  assert.equal(
    activationPayload.activation.handoff.lease.expiresAt,
    undefined
  );
  assert.equal(
    activationPayload.activation.handoff.client.handoffStrategy,
    "env-reconnect"
  );
  assert.deepEqual(
    activationPayload.activation.handoff.clearEnvironment,
    ["MAB_TOOLBOX_SESSION_POLICY_TOKEN"]
  );

  const history = await readAuditHistory(sqlitePath);
  assert.ok(history.entries.some((entry) => entry.actionType === "toolbox_activation_denied"));
});

test("mimir-cli reports Antigravity manual reconnect handoff metadata and active tools", async () => {
  const sqlitePath = await createTempSqlitePath();
  const activationEnv = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "antigravity",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "docs-research",
        taskSummary: "Need external docs and repo read access"
      }),
      "--no-pretty"
    ],
    activationEnv
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approved, true);
  assert.equal(activationPayload.activation.approvedProfile, "docs-research");
  assert.equal(activationPayload.activation.handoff.mode, "reconnect");
  assert.equal(activationPayload.activation.handoff.targetProfileId, "docs-research");
  assert.equal(
    activationPayload.activation.handoff.client.handoffStrategy,
    "manual-env-reconnect"
  );
  assert.equal(
    activationPayload.activation.handoff.client.handoffPresetRef,
    "antigravity.toolbox"
  );
  assert.equal(
    activationPayload.activation.handoff.client.clientPresetRef,
    "antigravity.toolbox"
  );

  const activeToolsResult = await runCliCommand(
    ["list-active-tools", "--json", "{}", "--no-pretty"],
    {
      ...activationEnv,
      MAB_TOOLBOX_ACTIVE_PROFILE: "docs-research"
    }
  );
  assert.equal(activeToolsResult.exitCode, 0, activeToolsResult.stderr);
  const activeToolsPayload = JSON.parse(activeToolsResult.stdout);
  assert.equal(activeToolsPayload.ok, true);
  assert.ok(
    activeToolsPayload.activeTools.some(
      (tool) => tool.toolId === "github.search" && tool.availabilityState === "active"
    )
  );
  assert.ok(
    activeToolsPayload.activeTools.some(
      (tool) => tool.toolId === "brave.web_search" && tool.availabilityState === "active"
    )
  );
  assert.deepEqual(activeToolsPayload.suppressedTools, []);
});

test("mimir-cli exposes Kubernetes read-only tools in runtime-observe without mutation tools", async () => {
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "runtime-observe",
    MAB_TOOLBOX_CLIENT_ID: "codex"
  };

  const activeToolsResult = await runCliCommand(
    ["list-active-tools", "--json", "{}", "--no-pretty"],
    env
  );
  assert.equal(activeToolsResult.exitCode, 0, activeToolsResult.stderr);
  const activeToolsPayload = JSON.parse(activeToolsResult.stdout);
  assert.equal(activeToolsPayload.ok, true);
  const activeToolIds = activeToolsPayload.activeTools.map((tool) => tool.toolId);
  assert.ok(activeToolIds.includes("kubernetes.context.inspect"));
  assert.ok(activeToolIds.includes("kubernetes.events.list"));
  assert.ok(activeToolIds.includes("kubernetes.logs.query"));
  assert.ok(!activeToolIds.includes("kubernetes.apply"));
});

test("mimir-cli denies runtime-admin activation until approval is granted", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "runtime-admin",
        taskSummary: "Need to restart a container"
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approved, false);
  assert.equal(
    activationPayload.activation.reasonCode,
    "toolbox_activation_denied_requires_approval"
  );
  assert.equal(activationPayload.activation.fallbackProfile, "runtime-observe");
  assert.equal(
    activationPayload.activation.handoff.targetProfileId,
    "runtime-observe"
  );
  assert.equal(activationPayload.activation.leaseExpiresAt, null);
  assert.equal(
    activationPayload.activation.handoff.lease.expiresAt,
    undefined
  );
  assert.equal(activationPayload.activation.leaseToken, null);
  assert.equal(
    activationPayload.activation.auditEvents[0].type,
    "toolbox_activation_denied"
  );
  assert.equal(
    activationPayload.activation.auditEvents[0].details.reasonCode,
    "toolbox_activation_denied_requires_approval"
  );

  const history = await readAuditHistory(sqlitePath);
  assert.ok(history.entries.some((entry) => entry.actionType === "toolbox_activation_denied"));
});

test("mimir-cli approves runtime-admin activation when explicit operator approval is supplied", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "runtime-admin",
        taskSummary: "Need to restart a container",
        approval: {
          grantedBy: "operator",
          grantedAt: "2026-04-19T22:30:00.000Z",
          reason: "Approved runtime intervention"
        }
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approved, true);
  assert.equal(activationPayload.activation.approvedToolbox, "runtime-admin");
  assert.equal(activationPayload.activation.approvedProfile, "runtime-admin");
  assert.equal(
    activationPayload.activation.handoff.targetProfileId,
    "runtime-admin"
  );
  assert.equal(
    activationPayload.activation.details.approval.requiresApproval,
    true
  );
  assert.equal(
    activationPayload.activation.details.approval.granted,
    true
  );
  assert.equal(
    activationPayload.activation.details.approval.grantedBy,
    "operator"
  );
  assert.equal(
    activationPayload.activation.details.approval.grantedAt,
    "2026-04-19T22:30:00.000Z"
  );
  assert.equal(
    activationPayload.activation.details.approval.reason,
    "Approved runtime intervention"
  );
  assert.equal(typeof activationPayload.activation.leaseToken, "string");

  const activeToolsResult = await runCliCommand(
    ["list-active-tools", "--json", "{}", "--no-pretty"],
    {
      ...env,
      MAB_TOOLBOX_ACTIVE_PROFILE: "runtime-admin"
    }
  );
  assert.equal(activeToolsResult.exitCode, 0, activeToolsResult.stderr);
  const activeToolsPayload = JSON.parse(activeToolsResult.stdout);
  assert.equal(activeToolsPayload.ok, true);
  assert.ok(
    activeToolsPayload.activeTools.some(
      (tool) => tool.toolId === "docker.restart" && tool.availabilityState === "active"
    )
  );
  assert.ok(
    activeToolsPayload.activeTools.some(
      (tool) =>
        tool.toolId === "kubernetes.context.inspect" &&
        tool.availabilityState === "active"
    )
  );
  assert.ok(
    !activeToolsPayload.activeTools.some((tool) => tool.toolId === "kubernetes.apply")
  );
});

test("mimir-cli rejects operator approval when it targets a different toolbox", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "runtime-admin",
        taskSummary: "Need to restart a container",
        approval: {
          grantedBy: "operator",
          grantedAt: "2026-04-19T22:30:00.000Z",
          reason: "Approved runtime intervention",
          toolboxId: "delivery-admin"
        }
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approved, false);
  assert.equal(
    activationPayload.activation.reasonCode,
    "toolbox_activation_denied_invalid_approval"
  );
  assert.equal(activationPayload.activation.fallbackProfile, "runtime-observe");
  assert.equal(activationPayload.activation.downgradeTarget, "runtime-observe");
  assert.equal(
    activationPayload.activation.handoff.targetProfileId,
    "runtime-observe"
  );
  assert.equal(
    activationPayload.activation.handoff.downgradeTarget,
    "runtime-observe"
  );
  assert.equal(activationPayload.activation.leaseExpiresAt, null);
  assert.equal(
    activationPayload.activation.handoff.lease.expiresAt,
    undefined
  );
  assert.equal(activationPayload.activation.leaseToken, null);
  assert.equal(
    activationPayload.activation.details.approval.granted,
    false
  );
  assert.equal(
    activationPayload.activation.details.approval.grantedBy,
    "operator"
  );
  assert.equal(
    activationPayload.activation.auditEvents[0].details.approval.toolboxId,
    "delivery-admin"
  );
});

test("mimir-cli denies delivery-admin activation until approval is granted", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "delivery-admin",
        taskSummary: "Need to publish a release artifact"
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approved, false);
  assert.equal(
    activationPayload.activation.reasonCode,
    "toolbox_activation_denied_requires_approval"
  );
  assert.equal(activationPayload.activation.fallbackProfile, "runtime-admin");
  assert.equal(activationPayload.activation.downgradeTarget, "runtime-admin");
  assert.equal(
    activationPayload.activation.handoff.targetProfileId,
    "runtime-admin"
  );
  assert.equal(
    activationPayload.activation.handoff.downgradeTarget,
    "runtime-admin"
  );
  assert.equal(activationPayload.activation.leaseToken, null);
  assert.equal(activationPayload.activation.leaseExpiresAt, null);
});

test("mimir-cli approves delivery-admin activation and exposes only delivery admin tools", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "delivery-admin",
        taskSummary: "Need to publish a release artifact",
        approval: {
          grantedBy: "operator",
          grantedAt: "2026-04-19T22:35:00.000Z",
          reason: "Approved delivery workflow"
        }
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approved, true);
  assert.equal(activationPayload.activation.approvedToolbox, "delivery-admin");
  assert.equal(activationPayload.activation.approvedProfile, "delivery-admin");
  assert.equal(
    activationPayload.activation.handoff.targetProfileId,
    "delivery-admin"
  );
  assert.equal(
    activationPayload.activation.details.approval.requiresApproval,
    true
  );
  assert.equal(
    activationPayload.activation.details.approval.granted,
    true
  );

  const activeToolsResult = await runCliCommand(
    ["list-active-tools", "--json", "{}", "--no-pretty"],
    {
      ...env,
      MAB_TOOLBOX_ACTIVE_PROFILE: "delivery-admin"
    }
  );
  assert.equal(activeToolsResult.exitCode, 0, activeToolsResult.stderr);
  const activeToolsPayload = JSON.parse(activeToolsResult.stdout);
  assert.equal(activeToolsPayload.ok, true);
  assert.ok(
    activeToolsPayload.activeTools.some(
      (tool) => tool.toolId === "github.issue.comment" && tool.availabilityState === "active"
    )
  );
  assert.ok(
    activeToolsPayload.activeTools.some(
      (tool) => tool.toolId === "github.pull_request.review" && tool.availabilityState === "active"
    )
  );
  assert.ok(
    activeToolsPayload.activeTools.some(
      (tool) => tool.toolId === "docker.restart" && tool.availabilityState === "active"
    )
  );
  assert.ok(
    !activeToolsPayload.activeTools.some((tool) => tool.toolId === "brave.web_search")
  );
  assert.ok(
    !activeToolsPayload.activeTools.some((tool) => tool.toolId === "grafana.logs.query")
  );

  const activeToolboxResult = await runCliCommand(
    ["list-active-toolbox", "--json", "{}", "--no-pretty"],
    {
      ...env,
      MAB_TOOLBOX_ACTIVE_PROFILE: "delivery-admin"
    }
  );
  assert.equal(activeToolboxResult.exitCode, 0, activeToolboxResult.stderr);
  const activeToolboxPayload = JSON.parse(activeToolboxResult.stdout);
  assert.equal(activeToolboxPayload.ok, true);
  assert.equal(activeToolboxPayload.profile.id, "delivery-admin");
  assert.equal(activeToolboxPayload.workflow.toolboxId, "delivery-admin");
  assert.equal(activeToolboxPayload.workflow.requiresApproval, true);
  assert.equal(activeToolboxPayload.workflow.fallbackProfile, "runtime-admin");
  assert.equal(activeToolboxPayload.profile.fallbackProfile, "runtime-admin");
});

test("mimir-cli denies full activation until approval is granted", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "claude",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "full",
        taskSummary: "Need broad emergency access"
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approved, false);
  assert.equal(
    activationPayload.activation.reasonCode,
    "toolbox_activation_denied_requires_approval"
  );
  assert.equal(activationPayload.activation.fallbackProfile, "delivery-admin");
  assert.equal(activationPayload.activation.downgradeTarget, "delivery-admin");
  assert.equal(
    activationPayload.activation.handoff.targetProfileId,
    "delivery-admin"
  );
});

test("mimir-cli approves full activation for Claude and exposes the complete operator toolbox", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "claude",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "full",
        taskSummary: "Need broad emergency access",
        approval: {
          grantedBy: "operator",
          grantedAt: "2026-04-19T22:40:00.000Z",
          reason: "Approved full recovery workflow"
        }
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approved, true);
  assert.equal(activationPayload.activation.approvedToolbox, "full");
  assert.equal(activationPayload.activation.approvedProfile, "full");
  assert.equal(
    activationPayload.activation.handoff.targetProfileId,
    "full"
  );
  assert.equal(
    activationPayload.activation.details.approval.requiresApproval,
    true
  );
  assert.equal(
    activationPayload.activation.details.approval.granted,
    true
  );

  const activeToolsResult = await runCliCommand(
    ["list-active-tools", "--json", "{}", "--no-pretty"],
    {
      ...env,
      MAB_TOOLBOX_ACTIVE_PROFILE: "full"
    }
  );
  assert.equal(activeToolsResult.exitCode, 0, activeToolsResult.stderr);
  const activeToolsPayload = JSON.parse(activeToolsResult.stdout);
  assert.equal(activeToolsPayload.ok, true);
  for (const toolId of [
    "github.search",
    "github.issue.comment",
    "brave.web_search",
    "grafana.logs.query",
    "docker.restart"
  ]) {
    assert.ok(
      activeToolsPayload.activeTools.some(
        (tool) => tool.toolId === toolId && tool.availabilityState === "active"
      ),
      `expected ${toolId} to be active in full profile`
    );
  }
  assert.deepEqual(activeToolsPayload.suppressedTools, []);

  const activeToolboxResult = await runCliCommand(
    ["list-active-toolbox", "--json", "{}", "--no-pretty"],
    {
      ...env,
      MAB_TOOLBOX_ACTIVE_PROFILE: "full"
    }
  );
  assert.equal(activeToolboxResult.exitCode, 0, activeToolboxResult.stderr);
  const activeToolboxPayload = JSON.parse(activeToolboxResult.stdout);
  assert.equal(activeToolboxPayload.ok, true);
  assert.equal(activeToolboxPayload.profile.id, "full");
  assert.equal(activeToolboxPayload.workflow.toolboxId, "full");
  assert.equal(activeToolboxPayload.workflow.requiresApproval, true);
  assert.equal(activeToolboxPayload.workflow.fallbackProfile, "delivery-admin");
  assert.equal(activeToolboxPayload.profile.fallbackProfile, "delivery-admin");
  assert.equal(activeToolboxPayload.client.id, "claude");
  assert.equal(activeToolboxPayload.client.handoffPresetRef, "claude.toolbox");
  assert.deepEqual(
    activeToolboxPayload.client.suppressedSemanticCapabilities,
    []
  );
  assert.deepEqual(activeToolboxPayload.client.suppressedTools, []);
});

test("mimir-cli resolves repo-write plus docs-search to the composite docs toolbox instead of escalating to full", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requiredCategories: ["repo-write", "docs-search"],
        taskSummary: "Need to edit code while checking external docs"
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approved, true);
  assert.equal(
    activationPayload.activation.approvedToolbox,
    "core-dev+docs-research"
  );
  assert.equal(
    activationPayload.activation.approvedProfile,
    "core-dev+docs-research"
  );
  assert.equal(
    activationPayload.activation.handoff.targetProfileId,
    "core-dev+docs-research"
  );

  const activeToolsResult = await runCliCommand(
    ["list-active-tools", "--json", "{}", "--no-pretty"],
    {
      ...env,
      MAB_TOOLBOX_ACTIVE_PROFILE: "core-dev+docs-research"
    }
  );
  assert.equal(activeToolsResult.exitCode, 0, activeToolsResult.stderr);
  const activeToolsPayload = JSON.parse(activeToolsResult.stdout);
  assert.equal(activeToolsPayload.ok, true);
  assert.ok(
    activeToolsPayload.activeTools.some(
      (tool) => tool.toolId === "draft_note" && tool.availabilityState === "active"
    )
  );
  assert.ok(
    activeToolsPayload.activeTools.some(
      (tool) => tool.toolId === "brave.web_search" && tool.availabilityState === "active"
    )
  );
  assert.ok(
    !activeToolsPayload.activeTools.some((tool) => tool.toolId === "github.search")
  );
  assert.ok(
    activeToolsPayload.suppressedTools.some(
      (tool) =>
        tool.toolId === "github.search" &&
        tool.suppressionReasons.includes("suppressed-semantic-capability:github.search")
    )
  );

  const activeToolboxResult = await runCliCommand(
    ["list-active-toolbox", "--json", "{}", "--no-pretty"],
    {
      ...env,
      MAB_TOOLBOX_ACTIVE_PROFILE: "core-dev+docs-research"
    }
  );
  assert.equal(activeToolboxResult.exitCode, 0, activeToolboxResult.stderr);
  const activeToolboxPayload = JSON.parse(activeToolboxResult.stdout);
  assert.equal(activeToolboxPayload.ok, true);
  assert.equal(activeToolboxPayload.profile.id, "core-dev+docs-research");
  assert.equal(activeToolboxPayload.workflow.toolboxId, "core-dev+docs-research");
  assert.equal(activeToolboxPayload.workflow.activationMode, "session-switch");
  assert.equal(activeToolboxPayload.workflow.sessionMode, "toolbox-activated");
  assert.equal(activeToolboxPayload.workflow.requiresApproval, false);
  assert.equal(activeToolboxPayload.workflow.fallbackProfile, "core-dev");
  assert.equal(activeToolboxPayload.profile.composite, true);
  assert.deepEqual(activeToolboxPayload.profile.baseProfiles, ["core-dev", "docs-research"]);
  assert.equal(activeToolboxPayload.profile.fallbackProfile, "core-dev");
  assert.equal(activeToolboxPayload.client.handoffStrategy, "env-reconnect");
});

test("mimir-cli rejects activation when a toolbox lease cannot be issued", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "bootstrap",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activationResult = await runCliCommand(
    [
      "request-toolbox-activation",
      "--json",
      JSON.stringify({
        requestedToolbox: "docs-research",
        taskSummary: "Need external docs and repo read access"
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(activationResult.exitCode, 0, activationResult.stderr);
  const activationPayload = JSON.parse(activationResult.stdout);
  assert.equal(activationPayload.ok, true);
  assert.equal(activationPayload.activation.approved, false);
  assert.equal(
    activationPayload.activation.reasonCode,
    "toolbox_activation_denied_lease_not_issued"
  );
  assert.equal(
    activationPayload.activation.diagnostics.lease.issued,
    false
  );
  assert.equal(
    activationPayload.activation.diagnostics.lease.reasonCode,
    "toolbox_lease_rejected_missing_issuer_secret"
  );
  assert.equal(activationPayload.activation.leaseToken, null);
  assert.equal(activationPayload.activation.handoff.targetProfileId, "bootstrap");
  assert.deepEqual(
    activationPayload.activation.handoff.clearEnvironment,
    ["MAB_TOOLBOX_SESSION_POLICY_TOKEN"]
  );

  const history = await readAuditHistory(sqlitePath);
  const actionTypes = history.entries.map((entry) => entry.actionType);
  assert.ok(actionTypes.includes("toolbox_activation_denied"));
  assert.ok(actionTypes.includes("toolbox_lease_rejected"));
});

test("mimir-cli records toolbox_expired when deactivating an expired lease", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "docs-research",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const expiredLease = issueToolboxSessionLease(
    {
      version: 1,
      sessionId: "expired-toolbox-session",
      issuer: "mimir-control",
      audience: "mimir-core",
      clientId: "codex",
      approvedProfile: "docs-research",
      approvedCategories: policy.profiles["docs-research"].allowedCategories,
      deniedCategories: policy.profiles["docs-research"].deniedCategories,
      trustClass: policy.intents["docs-research"].trustClass,
      manifestRevision: policy.manifestRevision,
      profileRevision: policy.profiles["docs-research"].profileRevision,
      issuedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:01:00.000Z",
      nonce: "expired-toolbox-nonce"
    },
    "toolbox-secret"
  );

  const deactivationResult = await runCliCommand(
    [
      "deactivate-toolbox",
      "--json",
      JSON.stringify({
        leaseToken: expiredLease
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(deactivationResult.exitCode, 0, deactivationResult.stderr);
  const deactivationPayload = JSON.parse(deactivationResult.stdout);
  assert.equal(deactivationPayload.ok, true);
  assert.equal(deactivationPayload.reasonCode, "toolbox_deactivated");
  assert.equal(deactivationPayload.diagnostics.lease.reasonCode, "toolbox_expired");
  assert.ok(
    deactivationPayload.auditEvents.some((event) => event.type === "toolbox_expired")
  );

  const history = await readAuditHistory(sqlitePath);
  const actionTypes = history.entries.map((entry) => entry.actionType);
  assert.ok(actionTypes.includes("toolbox_expired"));
  assert.ok(actionTypes.includes("toolbox_deactivated"));
});

test("mimir-cli list-active-tools when runtime-observe is active includes kubernetes read-only tools", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "runtime-observe",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activeToolsResult = await runCliCommand(
    ["list-active-tools", "--json", "{}", "--no-pretty"],
    env
  );
  assert.equal(activeToolsResult.exitCode, 0, activeToolsResult.stderr);
  const payload = JSON.parse(activeToolsResult.stdout);
  assert.equal(payload.ok, true);

  const activeToolIds = payload.activeTools.map((t) => t.toolId);
  assert.ok(
    activeToolIds.includes("kubernetes.context.inspect"),
    "runtime-observe active tools must include kubernetes.context.inspect"
  );
  assert.ok(
    activeToolIds.includes("kubernetes.events.list"),
    "runtime-observe active tools must include kubernetes.events.list"
  );
  assert.ok(
    activeToolIds.includes("kubernetes.logs.query"),
    "runtime-observe active tools must include kubernetes.logs.query"
  );

  const k8sActive = payload.activeTools.filter((t) => t.toolId.startsWith("kubernetes."));
  for (const tool of k8sActive) {
    assert.equal(tool.mutationLevel, "read", `${tool.toolId} must be read-only`);
  }
});

test("mimir-cli list-active-tools when security-audit is active includes semgrep read-only tools", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "security-audit",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activeToolsResult = await runCliCommand(
    ["list-active-tools", "--json", "{}", "--no-pretty"],
    env
  );
  assert.equal(activeToolsResult.exitCode, 0, activeToolsResult.stderr);
  const payload = JSON.parse(activeToolsResult.stdout);
  assert.equal(payload.ok, true);

  assert.ok(
    payload.activeTools.some((t) => t.semanticCapabilityId?.startsWith("security.semgrep.")),
    "security-audit active tools must include at least one security.semgrep.* tool"
  );

  const semgrepActive = payload.activeTools.filter((t) =>
    t.semanticCapabilityId?.startsWith("security.semgrep.")
  );
  for (const tool of semgrepActive) {
    assert.equal(tool.mutationLevel, "read", `${tool.toolId} must be read-only`);
    assert.equal(tool.category, "security-scan-read", `${tool.toolId} must use security-scan-read category`);
  }
});

test("mimir-cli list-active-tools when docs-research is active includes deepwiki read-only tools", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "docs-research",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };

  const activeToolsResult = await runCliCommand(
    ["list-active-tools", "--json", "{}", "--no-pretty"],
    env
  );
  assert.equal(activeToolsResult.exitCode, 0, activeToolsResult.stderr);
  const payload = JSON.parse(activeToolsResult.stdout);
  assert.equal(payload.ok, true);

  const activeToolIds = payload.activeTools.map((t) => t.toolId);
  assert.ok(
    activeToolIds.includes("read_wiki_structure"),
    "docs-research active tools must include read_wiki_structure"
  );
  assert.ok(
    activeToolIds.includes("read_wiki_contents"),
    "docs-research active tools must include read_wiki_contents"
  );
  assert.ok(
    activeToolIds.includes("ask_question"),
    "docs-research active tools must include ask_question"
  );

  const deepwikiActive = payload.activeTools.filter((t) =>
    t.semanticCapabilityId?.startsWith("repo.knowledge.")
  );
  for (const tool of deepwikiActive) {
    assert.equal(tool.category, "repo-knowledge-read", `${tool.toolId} must use repo-knowledge-read`);
    assert.equal(tool.mutationLevel, "read", `${tool.toolId} must be read-only`);
  }
});

test("mimir-cli deactivation returns the active profile fallback downgrade target", async () => {
  const sqlitePath = await createTempSqlitePath();
  const env = {
    ...process.env,
    MAB_NODE_ENV: "test",
    MAB_TOOLBOX_MANIFEST_DIR: path.resolve("docker", "mcp"),
    MAB_TOOLBOX_ACTIVE_PROFILE: "docs-research",
    MAB_TOOLBOX_CLIENT_ID: "codex",
    MAB_TOOLBOX_LEASE_ISSUER: "mimir-control",
    MAB_TOOLBOX_LEASE_AUDIENCE: "mimir-core",
    MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
    MAB_SQLITE_PATH: sqlitePath
  };
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const validLease = issueToolboxSessionLease(
    {
      version: 1,
      sessionId: "docs-research-session",
      issuer: "mimir-control",
      audience: "mimir-core",
      clientId: "codex",
      approvedProfile: "docs-research",
      approvedCategories: policy.profiles["docs-research"].allowedCategories,
      deniedCategories: policy.profiles["docs-research"].deniedCategories,
      trustClass: policy.intents["docs-research"].trustClass,
      manifestRevision: policy.manifestRevision,
      profileRevision: policy.profiles["docs-research"].profileRevision,
      issuedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      nonce: "docs-research-active-nonce"
    },
    "toolbox-secret"
  );

  const deactivationResult = await runCliCommand(
    [
      "deactivate-toolbox",
      "--json",
      JSON.stringify({
        leaseToken: validLease
      }),
      "--no-pretty"
    ],
    env
  );
  assert.equal(deactivationResult.exitCode, 0, deactivationResult.stderr);
  const deactivationPayload = JSON.parse(deactivationResult.stdout);
  assert.equal(deactivationPayload.ok, true);
  assert.equal(deactivationPayload.reasonCode, "toolbox_deactivated");
  assert.equal(deactivationPayload.activeProfile, "docs-research");
  assert.equal(deactivationPayload.downgradeTarget, "core-dev");
  assert.equal(deactivationPayload.handoff.targetProfileId, "core-dev");
  assert.equal(deactivationPayload.handoff.downgradeTarget, "core-dev");
  assert.equal(deactivationPayload.diagnostics.lease.revoked, true);
});

test("mimir-cli temp sqlite helper reuses a single process exit cleanup hook", async () => {
  const before = process.listenerCount("exit");

  await createTempSqlitePath();
  const afterFirst = process.listenerCount("exit");

  await createTempSqlitePath();
  const afterSecond = process.listenerCount("exit");

  assert.ok(
    afterFirst === before || afterFirst === before + 1,
    `expected at most one new exit listener, got ${before} -> ${afterFirst}`
  );
  assert.equal(
    afterSecond,
    afterFirst,
    `expected exit listener count to stay stable, got ${afterFirst} -> ${afterSecond}`
  );
});

function runCliCommand(args, env, cwd = process.cwd()) {
  const scriptPath = path.join(process.cwd(), "apps", "mimir-cli", "dist", "main.js");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      env,
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

async function createTempSqlitePath() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-toolbox-"));
  tempSqliteRoots.add(root);
  if (!tempSqliteCleanupRegistered) {
    tempSqliteCleanupRegistered = true;
    process.once("exit", () => {
      for (const tempRoot of tempSqliteRoots) {
        void rm(tempRoot, { recursive: true, force: true });
      }
    });
  }
  return path.join(root, "mimir.sqlite");
}

async function readAuditHistory(sqlitePath) {
  const auditLog = new SqliteAuditLog(sqlitePath);
  const auditHistoryService = new application.AuditHistoryService(auditLog);
  try {
    const result = await auditHistoryService.queryHistory({
      actor: {
        actorId: "operator",
        actorRole: "operator",
        transport: "cli",
        source: "test",
        requestId: "test-request",
        initiatedAt: new Date().toISOString()
      },
      limit: 50
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    return result.data;
  } finally {
    auditLog.close();
  }
}

const tempSqliteRoots = new Set();
let tempSqliteCleanupRegistered = false;

function createDockerStub(supported) {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "mimir-cli-docker-stub-"));
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
  const gatewayRunHelpText = [
    "Docker MCP Toolkit's CLI - Manage your MCP servers and clients.",
    "",
    "Usage: docker mcp gateway run",
    "",
    "Flags:",
    ...(supported
      ? ["      --profile string   Profile to use"]
      : ["      --servers strings  Names of the servers to enable"]),
    ""
  ].join("\n");

  writeFileSync(
    stubScript,
    [
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const logFile = process.env.DOCKER_STUB_LOG;",
      `const helpText = ${JSON.stringify(helpText)};`,
      `const gatewayRunHelpText = ${JSON.stringify(gatewayRunHelpText)};`,
      "if (args[0] === 'mcp' && args[1] === '--help') {",
      "  process.stdout.write(helpText);",
      "  process.exit(0);",
      "}",
      "if (args[0] === 'mcp' && args[1] === 'gateway' && args[2] === 'run' && args[3] === '--help') {",
      "  process.stdout.write(gatewayRunHelpText);",
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
