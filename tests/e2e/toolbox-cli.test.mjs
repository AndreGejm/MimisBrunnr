import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawn } from "node:child_process";
import * as application from "../../packages/application/dist/index.js";
import { SqliteAuditLog } from "../../packages/infrastructure/dist/index.js";

test("mimir-cli exposes toolbox discovery, activation, and sync commands from repo manifests", async () => {
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
  assert.equal(describePayload.auditEvents[0].type, "toolbox_discovery");

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
  assert.equal(activationPayload.activation.diagnostics.lease.issued, true);
  assert.equal(activationPayload.activation.handoff.mode, "reconnect");
  assert.equal(activationPayload.activation.handoff.targetProfileId, "docs-research");
  assert.equal(
    activationPayload.activation.handoff.client.handoffStrategy,
    "env-reconnect"
  );
  assert.equal(
    activationPayload.activation.handoff.client.handoffPresetRef,
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

test("mimir-cli returns structured activation denial diagnostics and persists the denial", async () => {
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
  assert.deepEqual(activationPayload.activation.diagnostics.requiredCategories, ["search"]);
  assert.equal(activationPayload.activation.auditEvents[0].type, "toolbox_activation_denied");
  assert.equal(
    activationPayload.activation.auditEvents[0].details.reasonCode,
    "toolbox_activation_denied_no_matching_toolbox"
  );
  assert.equal(activationPayload.activation.handoff.targetProfileId, "bootstrap");
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
  process.on("exit", () => {
    void rm(root, { recursive: true, force: true });
  });
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
