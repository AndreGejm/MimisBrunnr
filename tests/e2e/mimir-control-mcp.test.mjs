import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

function writeMcpMessage(stream, message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  stream.write(Buffer.concat([header, body]));
}

function writeRawMcpFrame(stream, header, body = "") {
  stream.write(Buffer.from(`${header}\r\n\r\n${body}`, "utf8"));
}

function createMessageCollector(stream) {
  let buffer = Buffer.alloc(0);
  const queue = [];
  const waiters = [];

  stream.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    while (true) {
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator === -1) {
        break;
      }

      const header = buffer.subarray(0, separator).toString("utf8");
      const match = header.match(/^Content-Length:\s*(\d+)$/im);
      if (!match) {
        throw new Error("Missing Content-Length header in MCP response.");
      }

      const contentLength = Number.parseInt(match[1], 10);
      const totalLength = separator + 4 + contentLength;
      if (buffer.length < totalLength) {
        break;
      }

      const payload = JSON.parse(
        buffer.subarray(separator + 4, totalLength).toString("utf8")
      );
      buffer = buffer.subarray(totalLength);

      if (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter(payload);
      } else {
        queue.push(payload);
      }
    }
  });

  return {
    next() {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift());
      }

      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    }
  };
}

function spawnControlServer({
  activeProfile = "bootstrap",
  clientId = "codex",
  sqlitePath
} = {}) {
  const child = spawn(
    process.execPath,
    [path.join(process.cwd(), "apps", "mimir-control-mcp", "dist", "main.js")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MAB_NODE_ENV: "test",
        MAB_TOOLBOX_MANIFEST_DIR: path.join(process.cwd(), "docker", "mcp"),
        MAB_TOOLBOX_ACTIVE_PROFILE: activeProfile,
        MAB_TOOLBOX_CLIENT_ID: clientId,
        MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
        ...(sqlitePath ? { MAB_SQLITE_PATH: sqlitePath } : {})
      },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  child.stderr.resume();
  child.closed = new Promise((resolve) => {
    child.once("close", resolve);
  });
  return child;
}

async function initializeMcp(transport, stdin) {
  writeMcpMessage(stdin, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {}
    }
  });
  await transport.next();
}

test("mimir-control MCP exposes toolbox discovery tools and bootstrap-safe active tools", async (t) => {
  const { root, sqlitePath } = await createTempSqlitePath();
  const child = spawnControlServer({
    activeProfile: "bootstrap",
    clientId: "codex",
    sqlitePath
  });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list"
    });
    const toolsList = await transport.next();
    const toolNames = toolsList.result.tools.map((tool) => tool.name);

    assert.deepEqual(toolNames, [
      "list_toolboxes",
      "describe_toolbox",
      "request_toolbox_activation",
      "list_active_toolbox",
      "list_active_tools",
      "deactivate_toolbox"
    ]);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "list_toolboxes",
        arguments: {}
      }
    });
    const listToolboxes = await transport.next();
    const toolboxIds = listToolboxes.result.structuredContent.toolboxes.map((toolbox) => toolbox.id);
    assert.ok(toolboxIds.includes("docs-research"));
    assert.equal(listToolboxes.result.structuredContent.auditEvents[0].type, "toolbox_discovery");
    assert.equal(
      listToolboxes.result.structuredContent.auditEvents[0].details.toolboxId,
      undefined
    );

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "request_toolbox_activation",
        arguments: {
          requestedToolbox: "docs-research"
        }
      }
    });
    const activation = await transport.next();
    assert.equal(activation.result.structuredContent.approvedProfile, "docs-research");
    assert.equal(typeof activation.result.structuredContent.leaseToken, "string");
    assert.equal(activation.result.structuredContent.reasonCode, "toolbox_activation_approved");
    assert.equal(
      activation.result.structuredContent.diagnostics.approvedToolbox,
      "docs-research"
    );
    assert.equal(
      activation.result.structuredContent.diagnostics.lease.issued,
      true
    );
    assert.equal(
      activation.result.structuredContent.handoff.targetProfileId,
      "docs-research"
    );
    assert.equal(
      activation.result.structuredContent.handoff.client.handoffStrategy,
      "env-reconnect"
    );
    assert.equal(
      activation.result.structuredContent.handoff.client.handoffPresetRef,
      "codex.toolbox"
    );
    assert.equal(
      activation.result.structuredContent.handoff.environment.MAB_TOOLBOX_SESSION_POLICY_TOKEN,
      "{{leaseToken}}"
    );

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "list_active_toolbox",
        arguments: {}
      }
    });
    const activeToolbox = await transport.next();
    assert.equal(activeToolbox.result.structuredContent.profile.id, "bootstrap");

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "list_active_tools",
        arguments: {}
      }
    });
    const activeTools = await transport.next();
    const activeToolIds = activeTools.result.structuredContent.tools.map((tool) => tool.toolId);
    assert.ok(activeToolIds.includes("list_toolboxes"));
    assert.ok(activeToolIds.includes("search_context"));
    assert.ok(!activeToolIds.includes("draft_note"));
    assert.ok(!activeToolIds.includes("github.search"));
    assert.ok(
      activeTools.result.structuredContent.declaredTools.some(
        (tool) => tool.toolId === "search_context" && tool.availabilityState === "declared"
      )
    );
    assert.ok(
      activeTools.result.structuredContent.activeTools.some(
        (tool) => tool.toolId === "search_context" && tool.availabilityState === "active"
      )
    );
    assert.deepEqual(activeTools.result.structuredContent.suppressedTools, []);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "deactivate_toolbox",
        arguments: {
          leaseToken: activation.result.structuredContent.leaseToken
        }
      }
    });
    const deactivation = await transport.next();
    assert.equal(deactivation.result.structuredContent.reasonCode, "toolbox_deactivated");
    assert.equal(deactivation.result.structuredContent.diagnostics.lease.revoked, true);
    assert.equal(
      deactivation.result.structuredContent.handoff.targetProfileId,
      "bootstrap"
    );
    assert.equal(
      deactivation.result.structuredContent.handoff.client.handoffStrategy,
      "env-reconnect"
    );
    assert.deepEqual(
      deactivation.result.structuredContent.handoff.clearEnvironment,
      ["MAB_TOOLBOX_SESSION_POLICY_TOKEN"]
    );

    const history = await readAuditHistory(sqlitePath);
    const actionTypes = history.entries.map((entry) => entry.actionType);
    assert.ok(actionTypes.includes("toolbox_discovery"));
    assert.ok(actionTypes.includes("toolbox_activation_approved"));
    assert.ok(actionTypes.includes("toolbox_reconnect_generated"));
    assert.ok(actionTypes.includes("toolbox_lease_issued"));
    assert.ok(actionTypes.includes("toolbox_deactivated"));
  } finally {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("mimir-control MCP applies client overlay suppression to activated profile tool listings", async (t) => {
  const codexChild = spawnControlServer({ activeProfile: "docs-research", clientId: "codex" });
  const claudeChild = spawnControlServer({ activeProfile: "docs-research", clientId: "claude" });
  try {
    const codexTransport = createMessageCollector(codexChild.stdout);
    const claudeTransport = createMessageCollector(claudeChild.stdout);
    await initializeMcp(codexTransport, codexChild.stdin);
    await initializeMcp(claudeTransport, claudeChild.stdin);

    for (const [stdin, requestId] of [
      [codexChild.stdin, 10],
      [claudeChild.stdin, 20]
    ]) {
      writeMcpMessage(stdin, {
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: {
          name: "list_active_tools",
          arguments: {}
        }
      });
    }

    const codexTools = await codexTransport.next();
    const claudeTools = await claudeTransport.next();

    const codexToolIds = codexTools.result.structuredContent.tools.map((tool) => tool.toolId);
    const claudeToolIds = claudeTools.result.structuredContent.tools.map((tool) => tool.toolId);

    assert.ok(!codexToolIds.includes("github.search"));
    assert.ok(claudeToolIds.includes("github.search"));
    assert.ok(codexToolIds.includes("brave.web_search"));
    assert.ok(
      codexTools.result.structuredContent.suppressedTools.some(
        (tool) =>
          tool.toolId === "github.search" &&
          tool.suppressionReasons.includes("suppressed-semantic-capability:github.search")
      )
    );
    assert.ok(
      !claudeTools.result.structuredContent.suppressedTools.some(
        (tool) => tool.toolId === "github.search"
      )
    );
  } finally {
    await stopChild(codexChild);
    await stopChild(claudeChild);
  }
});

test("mimir-control MCP records activation denial diagnostics and audit history", async (t) => {
  const { root, sqlitePath } = await createTempSqlitePath();
  const child = spawnControlServer({ activeProfile: "bootstrap", clientId: "codex", sqlitePath });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 50,
      method: "tools/call",
      params: {
        name: "request_toolbox_activation",
        arguments: {
          requestedToolbox: "missing-toolbox",
          requiredCategories: ["search"]
        }
      }
    });

    const activation = await transport.next();
    assert.equal(activation.result.structuredContent.approved, false);
    assert.equal(
      activation.result.structuredContent.reasonCode,
      "toolbox_activation_denied_no_matching_toolbox"
    );
    assert.equal(
      activation.result.structuredContent.diagnostics.requestedToolbox,
      "missing-toolbox"
    );
    assert.deepEqual(activation.result.structuredContent.diagnostics.requiredCategories, ["search"]);
    assert.equal(activation.result.structuredContent.auditEvents[0].type, "toolbox_activation_denied");
    assert.equal(
      activation.result.structuredContent.auditEvents[0].details.reasonCode,
      "toolbox_activation_denied_no_matching_toolbox"
    );

    const history = await readAuditHistory(sqlitePath);
    assert.ok(history.entries.some((entry) => entry.actionType === "toolbox_activation_denied"));
  } finally {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("mimir-control MCP emits toolbox_expired when deactivating an expired lease", async () => {
  const { root, sqlitePath } = await createTempSqlitePath();
  const child = spawnControlServer({
    activeProfile: "docs-research",
    clientId: "codex",
    sqlitePath
  });
  try {
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

    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 80,
      method: "tools/call",
      params: {
        name: "deactivate_toolbox",
        arguments: {
          leaseToken: expiredLease
        }
      }
    });

    const deactivation = await transport.next();
    assert.equal(deactivation.result.structuredContent.reasonCode, "toolbox_deactivated");
    assert.equal(
      deactivation.result.structuredContent.diagnostics.lease.reasonCode,
      "toolbox_expired"
    );
    assert.ok(
      deactivation.result.structuredContent.auditEvents.some(
        (event) => event.type === "toolbox_expired"
      )
    );

    const history = await readAuditHistory(sqlitePath);
    assert.ok(history.entries.some((entry) => entry.actionType === "toolbox_expired"));
    assert.ok(history.entries.some((entry) => entry.actionType === "toolbox_deactivated"));
  } finally {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("mimir-control MCP returns parse errors for malformed frames and stays alive", async () => {
  const child = spawnControlServer({ activeProfile: "bootstrap", clientId: "codex" });
  try {
    const transport = createMessageCollector(child.stdout);

    writeRawMcpFrame(child.stdin, "Content-Length: nope", "{}");
    const parseError = await transport.next();
    assert.equal(parseError.error.code, -32700);
    assert.match(parseError.error.message, /content-length|parse/i);

    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 90,
      method: "tools/list"
    });
    const toolsList = await transport.next();
    assert.ok(toolsList.result.tools.some((tool) => tool.name === "list_toolboxes"));
  } finally {
    await stopChild(child);
  }
});

test("mimir-control MCP lists kubernetes read-only tools when runtime-observe is active", async () => {
  const child = spawnControlServer({ activeProfile: "runtime-observe", clientId: "codex" });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 200,
      method: "tools/call",
      params: {
        name: "list_active_tools",
        arguments: {}
      }
    });

    const activeTools = await transport.next();
    const activeToolIds = activeTools.result.structuredContent.activeTools.map((t) => t.toolId);

    assert.ok(
      activeToolIds.includes("kubernetes.context.inspect"),
      "runtime-observe must expose kubernetes.context.inspect as active tool"
    );
    assert.ok(
      activeToolIds.includes("kubernetes.events.list"),
      "runtime-observe must expose kubernetes.events.list as active tool"
    );
    assert.ok(
      activeToolIds.includes("kubernetes.logs.query"),
      "runtime-observe must expose kubernetes.logs.query as active tool"
    );

    const k8sTools = activeTools.result.structuredContent.activeTools.filter((t) =>
      t.toolId.startsWith("kubernetes.")
    );
    for (const tool of k8sTools) {
      assert.equal(tool.mutationLevel, "read", `${tool.toolId} must be read-only`);
    }

    // Codex overlay must not suppress kubernetes tools (no kubernetes semantic capability suppression)
    assert.ok(
      !activeTools.result.structuredContent.suppressedTools.some((t) =>
        t.toolId.startsWith("kubernetes.")
      ),
      "Codex overlay must not suppress kubernetes tools"
    );
  } finally {
    await stopChild(child);
  }
});

test("mimir-control MCP lists DockerHub read-only tools when docs-research is active", async () => {
  const child = spawnControlServer({ activeProfile: "docs-research", clientId: "codex" });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 210,
      method: "tools/call",
      params: {
        name: "list_active_tools",
        arguments: {}
      }
    });

    const activeTools = await transport.next();
    const activeToolIds = activeTools.result.structuredContent.activeTools.map((t) => t.toolId);

    assert.ok(
      activeToolIds.includes("dockerhub.image.search"),
      "docs-research must expose dockerhub.image.search as active tool"
    );
    assert.ok(
      activeToolIds.includes("dockerhub.image.tags.list"),
      "docs-research must expose dockerhub.image.tags.list as active tool"
    );
    assert.ok(
      activeToolIds.includes("dockerhub.image.inspect"),
      "docs-research must expose dockerhub.image.inspect as active tool"
    );

    const dockerHubTools = activeTools.result.structuredContent.activeTools.filter((t) =>
      t.toolId.startsWith("dockerhub.")
    );
    for (const tool of dockerHubTools) {
      assert.equal(tool.category, "container-registry-read", `${tool.toolId} must use container-registry-read`);
      assert.equal(tool.trustClass, "external-read", `${tool.toolId} must be external-read`);
      assert.equal(tool.mutationLevel, "read", `${tool.toolId} must be read-only`);
    }

    assert.ok(
      !activeTools.result.structuredContent.suppressedTools.some((t) =>
        t.toolId.startsWith("dockerhub.")
      ),
      "Codex overlay must not suppress dockerhub tools"
    );
  } finally {
    await stopChild(child);
  }
});

async function createTempSqlitePath() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-toolbox-"));
  return {
    root,
    sqlitePath: path.join(root, "mimir.sqlite")
  };
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

async function stopChild(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    child.closed,
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await child.closed;
  }
}
