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
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
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
    const docsResearchListing = listToolboxes.result.structuredContent.toolboxes.find(
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
    assert.ok(toolboxIds.includes("core-dev+docs-research"));
    assert.ok(toolboxIds.includes("core-dev+runtime-observe"));
    assert.equal(listToolboxes.result.structuredContent.auditEvents[0].type, "toolbox_discovery");
    assert.equal(
      listToolboxes.result.structuredContent.auditEvents[0].details.toolboxId,
      undefined
    );

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "describe_toolbox",
        arguments: {
          toolboxId: "core-dev+docs-research"
        }
      }
    });
    const describeToolbox = await transport.next();
    assert.equal(
      describeToolbox.result.structuredContent.toolbox.summary,
      "Code changes that also need external documentation and GitHub read context."
    );
    assert.ok(
      describeToolbox.result.structuredContent.toolbox.exampleTasks.includes(
        "Implement a fix while checking upstream docs"
      )
    );
    assert.equal(
      describeToolbox.result.structuredContent.toolbox.workflow.activationMode,
      "session-switch"
    );
    assert.equal(
      describeToolbox.result.structuredContent.toolbox.trustClass,
      "external-read"
    );
    assert.equal(
      describeToolbox.result.structuredContent.diagnostics.profileRevision,
      policy.profiles["core-dev+docs-research"].profileRevision
    );
    assert.deepEqual(
      describeToolbox.result.structuredContent.toolbox.antiUseCases,
      [
        { type: "denied_category", category: "github-write" },
        { type: "denied_category", category: "docker-write" },
        { type: "denied_category", category: "deployment" }
      ]
    );
    assert.ok(
      describeToolbox.result.structuredContent.toolbox.suppressedTools.some(
        (tool) =>
          tool.toolId === "github.search" &&
          tool.semanticCapabilityId === "github.search" &&
          tool.boundary === "client-overlay-reduction" &&
          tool.reasons.includes("suppressed-semantic-capability:github.search")
      )
    );
    assert.ok(
      describeToolbox.result.structuredContent.toolbox.suppressedTools.some(
        (tool) =>
          tool.toolId === "github.pull_request.read" &&
          tool.semanticCapabilityId === "github.pull-request.read" &&
          tool.boundary === "client-overlay-reduction" &&
          tool.reasons.includes("suppressed-semantic-capability:github.pull-request.read")
      )
    );
    assert.equal(
      describeToolbox.result.structuredContent.toolbox.profile.composite,
      true
    );
    assert.deepEqual(
      describeToolbox.result.structuredContent.toolbox.profile.baseProfiles,
      ["core-dev", "docs-research"]
    );
    assert.equal(
      describeToolbox.result.structuredContent.toolbox.profile.compositeReason,
      "repeated_workflow"
    );

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: {
        name: "describe_toolbox",
        arguments: {
          toolboxId: "core-dev+voltagent-docs"
        }
      }
    });
    const describeVoltAgentToolbox = await transport.next();
    assert.ok(
      describeVoltAgentToolbox.result.structuredContent.toolbox.servers.some(
        (server) =>
          server.id === "voltagent-docs" &&
          server.usageClass === "docs-only" &&
          server.runtimeBindingKind === "local-stdio" &&
          server.clientMaterializationTarget === "codex-mcp-json"
      )
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
      activation.result.structuredContent.diagnostics.profileRevision,
      policy.profiles["docs-research"].profileRevision
    );
    assert.equal(
      activation.result.structuredContent.diagnostics.lease.issued,
      true
    );
    assert.ok(
      activation.result.structuredContent.auditEvents.some(
        (event) =>
          event.type === "toolbox_activation_approved" &&
          event.profileRevision === policy.profiles["docs-research"].profileRevision
      )
    );
    assert.equal(
      activation.result.structuredContent.handoff.targetProfileId,
      "docs-research"
    );
    assert.equal(
      activation.result.structuredContent.details.approval.trustClass,
      "external-read"
    );
    assert.equal(
      activation.result.structuredContent.downgradeTarget,
      "core-dev"
    );
    assert.equal(
      activation.result.structuredContent.handoff.downgradeTarget,
      "core-dev"
    );
    assert.equal(
      activation.result.structuredContent.handoff.handoffStrategy,
      "env-reconnect"
    );
    assert.equal(
      activation.result.structuredContent.handoff.handoffPresetRef,
      "codex.toolbox"
    );
    assert.equal(
      activation.result.structuredContent.handoff.clientPresetRef,
      "codex.toolbox"
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
      activation.result.structuredContent.handoff.client.clientPresetRef,
      "codex.toolbox"
    );
    assert.equal(
      activation.result.structuredContent.handoff.environment.MAB_TOOLBOX_SESSION_POLICY_TOKEN,
      "{{leaseToken}}"
    );
    assert.match(
      activation.result.structuredContent.leaseExpiresAt,
      /^\d{4}-\d{2}-\d{2}T/
    );
    assert.equal(
      activation.result.structuredContent.handoff.lease.expiresAt,
      activation.result.structuredContent.leaseExpiresAt
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
    assert.equal(activeToolbox.result.structuredContent.workflow.toolboxId, null);
    assert.equal(activeToolbox.result.structuredContent.workflow.activationMode, null);
    assert.equal(
      activeToolbox.result.structuredContent.workflow.sessionMode,
      "toolbox-bootstrap"
    );
    assert.equal(activeToolbox.result.structuredContent.workflow.requiresApproval, false);
    assert.equal(activeToolbox.result.structuredContent.workflow.fallbackProfile, null);
    assert.ok(
      activeToolbox.result.structuredContent.profile.servers.some(
        (server) =>
          server.id === "mimir-control" &&
          server.usageClass === "general" &&
          server.source === "owned"
      )
    );

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
  const antigravityChild = spawnControlServer({
    activeProfile: "docs-research",
    clientId: "antigravity"
  });
  try {
    const codexTransport = createMessageCollector(codexChild.stdout);
    const claudeTransport = createMessageCollector(claudeChild.stdout);
    const antigravityTransport = createMessageCollector(antigravityChild.stdout);
    await initializeMcp(codexTransport, codexChild.stdin);
    await initializeMcp(claudeTransport, claudeChild.stdin);
    await initializeMcp(antigravityTransport, antigravityChild.stdin);

    for (const [stdin, requestId] of [
      [codexChild.stdin, 10],
      [claudeChild.stdin, 20],
      [antigravityChild.stdin, 30]
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
    const antigravityTools = await antigravityTransport.next();

    const codexToolIds = codexTools.result.structuredContent.tools.map((tool) => tool.toolId);
    const claudeToolIds = claudeTools.result.structuredContent.tools.map((tool) => tool.toolId);
    const antigravityToolIds = antigravityTools.result.structuredContent.tools.map((tool) => tool.toolId);

    assert.ok(!codexToolIds.includes("github.search"));
    assert.ok(claudeToolIds.includes("github.search"));
    assert.ok(antigravityToolIds.includes("github.search"));
    assert.ok(codexToolIds.includes("brave.web_search"));
    assert.ok(antigravityToolIds.includes("brave.web_search"));
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
    assert.deepEqual(antigravityTools.result.structuredContent.suppressedTools, []);

    writeMcpMessage(codexChild.stdin, {
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "list_active_toolbox",
        arguments: {}
      }
    });
    const codexToolbox = await codexTransport.next();
    assert.ok(
      codexToolbox.result.structuredContent.client.suppressedTools.some(
        (tool) =>
          tool.toolId === "github.search" &&
          tool.semanticCapabilityId === "github.search" &&
          tool.boundary === "client-overlay-reduction" &&
          tool.reasons.includes("suppressed-semantic-capability:github.search")
      )
    );
    assert.ok(
      codexToolbox.result.structuredContent.client.suppressedTools.some(
        (tool) =>
          tool.toolId === "github.pull_request.read" &&
          tool.semanticCapabilityId === "github.pull-request.read" &&
          tool.boundary === "client-overlay-reduction" &&
          tool.reasons.includes("suppressed-semantic-capability:github.pull-request.read")
      )
    );
  } finally {
    await stopChild(codexChild);
    await stopChild(claudeChild);
    await stopChild(antigravityChild);
  }
});

test("mimir-control MCP returns Antigravity manual reconnect handoff metadata", async (t) => {
  const child = spawnControlServer({
    activeProfile: "bootstrap",
    clientId: "antigravity"
  });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: {
        name: "request_toolbox_activation",
        arguments: {
          requestedToolbox: "docs-research"
        }
      }
    });

    const activation = await transport.next();
    assert.equal(activation.result.structuredContent.approved, true);
    assert.equal(activation.result.structuredContent.approvedProfile, "docs-research");
    assert.equal(
      activation.result.structuredContent.handoff.client.handoffStrategy,
      "manual-env-reconnect"
    );
    assert.equal(
      activation.result.structuredContent.handoff.client.handoffPresetRef,
      "antigravity.toolbox"
    );
    assert.equal(
      activation.result.structuredContent.handoff.client.clientPresetRef,
      "antigravity.toolbox"
    );
    assert.equal(
      activation.result.structuredContent.handoff.environment.MAB_TOOLBOX_ACTIVE_PROFILE,
      "docs-research"
    );
    assert.equal(
      activation.result.structuredContent.handoff.environment.MAB_TOOLBOX_SESSION_POLICY_TOKEN,
      "{{leaseToken}}"
    );
  } finally {
    await stopChild(child);
  }
});

test("mimir-control MCP exposes read-only runtime-observe tools without admin mutation tools", async (t) => {
  const child = spawnControlServer({
    activeProfile: "runtime-observe",
    clientId: "codex"
  });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 45,
      method: "tools/call",
      params: {
        name: "list_active_tools",
        arguments: {}
      }
    });

    const activeTools = await transport.next();
    const activeToolIds = activeTools.result.structuredContent.tools.map((tool) => tool.toolId);
    assert.ok(activeToolIds.includes("grafana.logs.query"));
    assert.ok(activeToolIds.includes("grafana.metrics.query"));
    assert.ok(activeToolIds.includes("grafana.traces.query"));
    assert.ok(activeToolIds.includes("docker.inspect"));
    assert.ok(activeToolIds.includes("kubernetes.context.inspect"));
    assert.ok(activeToolIds.includes("kubernetes.events.list"));
    assert.ok(activeToolIds.includes("kubernetes.logs.query"));
    assert.ok(!activeToolIds.includes("docker.restart"));
    assert.ok(!activeToolIds.includes("kubernetes.apply"));
    assert.deepEqual(activeTools.result.structuredContent.suppressedTools, []);
  } finally {
    await stopChild(child);
  }
});

test("mimir-control MCP approves runtime-admin activation when operator approval is supplied", async (t) => {
  const child = spawnControlServer({
    activeProfile: "bootstrap",
    clientId: "codex"
  });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 451,
      method: "tools/call",
      params: {
        name: "request_toolbox_activation",
        arguments: {
          requestedToolbox: "runtime-admin",
          taskSummary: "Need to restart a container",
          approval: {
            grantedBy: "operator",
            grantedAt: "2026-04-19T22:30:00.000Z",
            reason: "Approved runtime intervention"
          }
        }
      }
    });

    const activation = await transport.next();
    assert.equal(activation.result.structuredContent.approved, true);
    assert.equal(activation.result.structuredContent.approvedToolbox, "runtime-admin");
    assert.equal(activation.result.structuredContent.approvedProfile, "runtime-admin");
    assert.equal(
      activation.result.structuredContent.handoff.targetProfileId,
      "runtime-admin"
    );
    assert.equal(
      activation.result.structuredContent.details.approval.requiresApproval,
      true
    );
    assert.equal(
      activation.result.structuredContent.details.approval.granted,
      true
    );
    assert.equal(
      activation.result.structuredContent.details.approval.grantedBy,
      "operator"
    );

    const runtimeChild = spawnControlServer({
      activeProfile: "runtime-admin",
      clientId: "codex"
    });
    try {
      const runtimeTransport = createMessageCollector(runtimeChild.stdout);
      await initializeMcp(runtimeTransport, runtimeChild.stdin);
      writeMcpMessage(runtimeChild.stdin, {
        jsonrpc: "2.0",
        id: 452,
        method: "tools/call",
        params: {
          name: "list_active_tools",
          arguments: {}
        }
      });
      const activeTools = await runtimeTransport.next();
      const activeToolIds = activeTools.result.structuredContent.tools.map((tool) => tool.toolId);
      assert.ok(activeToolIds.includes("docker.restart"));
      assert.ok(activeToolIds.includes("kubernetes.context.inspect"));
      assert.ok(!activeToolIds.includes("kubernetes.apply"));
    } finally {
      await stopChild(runtimeChild);
    }
  } finally {
    await stopChild(child);
  }
});

test("mimir-control MCP rejects approval that targets a different toolbox", async (t) => {
  const child = spawnControlServer({
    activeProfile: "bootstrap",
    clientId: "codex"
  });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 455,
      method: "tools/call",
      params: {
        name: "request_toolbox_activation",
        arguments: {
          requestedToolbox: "runtime-admin",
          taskSummary: "Need to restart a container",
          approval: {
            grantedBy: "operator",
            grantedAt: "2026-04-19T22:30:00.000Z",
            reason: "Approved runtime intervention",
            toolboxId: "delivery-admin"
          }
        }
      }
    });

    const activation = await transport.next();
    assert.equal(activation.result.structuredContent.approved, false);
    assert.equal(
      activation.result.structuredContent.reasonCode,
      "toolbox_activation_denied_invalid_approval"
    );
    assert.equal(
      activation.result.structuredContent.fallbackProfile,
      "runtime-observe"
    );
    assert.equal(
      activation.result.structuredContent.downgradeTarget,
      "runtime-observe"
    );
    assert.equal(
      activation.result.structuredContent.handoff.targetProfileId,
      "runtime-observe"
    );
    assert.equal(
      activation.result.structuredContent.handoff.downgradeTarget,
      "runtime-observe"
    );
    assert.equal(activation.result.structuredContent.leaseExpiresAt, null);
    assert.equal(
      activation.result.structuredContent.handoff.lease.expiresAt,
      undefined
    );
    assert.equal(activation.result.structuredContent.leaseToken, null);
    assert.equal(
      activation.result.structuredContent.details.approval.granted,
      false
    );
    assert.equal(
      activation.result.structuredContent.details.approval.grantedBy,
      "operator"
    );
    assert.equal(
      activation.result.structuredContent.auditEvents[0].details.approval.toolboxId,
      "delivery-admin"
    );
  } finally {
    await stopChild(child);
  }
});

test("mimir-control MCP denies delivery-admin activation until approval is granted", async (t) => {
  const child = spawnControlServer({
    activeProfile: "bootstrap",
    clientId: "codex"
  });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 456,
      method: "tools/call",
      params: {
        name: "request_toolbox_activation",
        arguments: {
          requestedToolbox: "delivery-admin",
          taskSummary: "Need to publish a release artifact"
        }
      }
    });

    const activation = await transport.next();
    assert.equal(activation.result.structuredContent.approved, false);
    assert.equal(
      activation.result.structuredContent.reasonCode,
      "toolbox_activation_denied_requires_approval"
    );
    assert.equal(
      activation.result.structuredContent.fallbackProfile,
      "runtime-admin"
    );
    assert.equal(
      activation.result.structuredContent.downgradeTarget,
      "runtime-admin"
    );
    assert.equal(
      activation.result.structuredContent.handoff.targetProfileId,
      "runtime-admin"
    );
    assert.equal(
      activation.result.structuredContent.handoff.downgradeTarget,
      "runtime-admin"
    );
    assert.equal(activation.result.structuredContent.leaseToken, null);
    assert.equal(activation.result.structuredContent.leaseExpiresAt, null);
  } finally {
    await stopChild(child);
  }
});

test("mimir-control MCP approves delivery-admin activation and exposes only delivery admin tools", async (t) => {
  const child = spawnControlServer({
    activeProfile: "bootstrap",
    clientId: "codex"
  });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 457,
      method: "tools/call",
      params: {
        name: "request_toolbox_activation",
        arguments: {
          requestedToolbox: "delivery-admin",
          taskSummary: "Need to publish a release artifact",
          approval: {
            grantedBy: "operator",
            grantedAt: "2026-04-19T22:35:00.000Z",
            reason: "Approved delivery workflow"
          }
        }
      }
    });

    const activation = await transport.next();
    assert.equal(activation.result.structuredContent.approved, true);
    assert.equal(
      activation.result.structuredContent.approvedToolbox,
      "delivery-admin"
    );
    assert.equal(
      activation.result.structuredContent.approvedProfile,
      "delivery-admin"
    );
    assert.equal(
      activation.result.structuredContent.handoff.targetProfileId,
      "delivery-admin"
    );
    assert.equal(
      activation.result.structuredContent.details.approval.requiresApproval,
      true
    );
    assert.equal(
      activation.result.structuredContent.details.approval.granted,
      true
    );

    const runtimeChild = spawnControlServer({
      activeProfile: "delivery-admin",
      clientId: "codex"
    });
    try {
      const runtimeTransport = createMessageCollector(runtimeChild.stdout);
      await initializeMcp(runtimeTransport, runtimeChild.stdin);
      writeMcpMessage(runtimeChild.stdin, {
        jsonrpc: "2.0",
        id: 458,
        method: "tools/call",
        params: {
          name: "list_active_tools",
          arguments: {}
        }
      });
      const activeTools = await runtimeTransport.next();
      const activeToolIds = activeTools.result.structuredContent.tools.map((tool) => tool.toolId);
      assert.ok(activeToolIds.includes("github.issue.comment"));
      assert.ok(activeToolIds.includes("github.pull_request.review"));
      assert.ok(activeToolIds.includes("docker.restart"));
      assert.ok(!activeToolIds.includes("brave.web_search"));
      assert.ok(!activeToolIds.includes("grafana.logs.query"));

      writeMcpMessage(runtimeChild.stdin, {
        jsonrpc: "2.0",
        id: 459,
        method: "tools/call",
        params: {
          name: "list_active_toolbox",
          arguments: {}
        }
      });
      const activeToolbox = await runtimeTransport.next();
      assert.equal(activeToolbox.result.structuredContent.profile.id, "delivery-admin");
      assert.equal(
        activeToolbox.result.structuredContent.workflow.toolboxId,
        "delivery-admin"
      );
      assert.equal(
        activeToolbox.result.structuredContent.workflow.requiresApproval,
        true
      );
      assert.equal(
        activeToolbox.result.structuredContent.workflow.fallbackProfile,
        "runtime-admin"
      );
      assert.equal(
        activeToolbox.result.structuredContent.profile.fallbackProfile,
        "runtime-admin"
      );
    } finally {
      await stopChild(runtimeChild);
    }
  } finally {
    await stopChild(child);
  }
});

test("mimir-control MCP denies full activation until approval is granted", async (t) => {
  const child = spawnControlServer({
    activeProfile: "bootstrap",
    clientId: "claude"
  });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 460,
      method: "tools/call",
      params: {
        name: "request_toolbox_activation",
        arguments: {
          requestedToolbox: "full",
          taskSummary: "Need broad emergency access"
        }
      }
    });

    const activation = await transport.next();
    assert.equal(activation.result.structuredContent.approved, false);
    assert.equal(
      activation.result.structuredContent.reasonCode,
      "toolbox_activation_denied_requires_approval"
    );
    assert.equal(
      activation.result.structuredContent.fallbackProfile,
      "delivery-admin"
    );
    assert.equal(
      activation.result.structuredContent.downgradeTarget,
      "delivery-admin"
    );
    assert.equal(
      activation.result.structuredContent.handoff.targetProfileId,
      "delivery-admin"
    );
  } finally {
    await stopChild(child);
  }
});

test("mimir-control MCP approves full activation for Claude and exposes the complete operator toolbox", async (t) => {
  const child = spawnControlServer({
    activeProfile: "bootstrap",
    clientId: "claude"
  });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 461,
      method: "tools/call",
      params: {
        name: "request_toolbox_activation",
        arguments: {
          requestedToolbox: "full",
          taskSummary: "Need broad emergency access",
          approval: {
            grantedBy: "operator",
            grantedAt: "2026-04-19T22:40:00.000Z",
            reason: "Approved full recovery workflow"
          }
        }
      }
    });

    const activation = await transport.next();
    assert.equal(activation.result.structuredContent.approved, true);
    assert.equal(activation.result.structuredContent.approvedToolbox, "full");
    assert.equal(activation.result.structuredContent.approvedProfile, "full");
    assert.equal(
      activation.result.structuredContent.handoff.targetProfileId,
      "full"
    );
    assert.equal(
      activation.result.structuredContent.details.approval.requiresApproval,
      true
    );
    assert.equal(
      activation.result.structuredContent.details.approval.granted,
      true
    );

    const runtimeChild = spawnControlServer({
      activeProfile: "full",
      clientId: "claude"
    });
    try {
      const runtimeTransport = createMessageCollector(runtimeChild.stdout);
      await initializeMcp(runtimeTransport, runtimeChild.stdin);
      writeMcpMessage(runtimeChild.stdin, {
        jsonrpc: "2.0",
        id: 462,
        method: "tools/call",
        params: {
          name: "list_active_tools",
          arguments: {}
        }
      });
      const activeTools = await runtimeTransport.next();
      const activeToolIds = activeTools.result.structuredContent.tools.map((tool) => tool.toolId);
      for (const toolId of [
        "github.search",
        "github.issue.comment",
        "brave.web_search",
        "grafana.logs.query",
        "docker.restart"
      ]) {
        assert.ok(
          activeToolIds.includes(toolId),
          `expected ${toolId} to be active in full profile`
        );
      }
      assert.deepEqual(activeTools.result.structuredContent.suppressedTools, []);

      writeMcpMessage(runtimeChild.stdin, {
        jsonrpc: "2.0",
        id: 463,
        method: "tools/call",
        params: {
          name: "list_active_toolbox",
          arguments: {}
        }
      });
      const activeToolbox = await runtimeTransport.next();
      assert.equal(activeToolbox.result.structuredContent.profile.id, "full");
      assert.equal(
        activeToolbox.result.structuredContent.workflow.toolboxId,
        "full"
      );
      assert.equal(
        activeToolbox.result.structuredContent.workflow.requiresApproval,
        true
      );
      assert.equal(
        activeToolbox.result.structuredContent.workflow.fallbackProfile,
        "delivery-admin"
      );
      assert.equal(
        activeToolbox.result.structuredContent.profile.fallbackProfile,
        "delivery-admin"
      );
      assert.equal(activeToolbox.result.structuredContent.client.id, "claude");
      assert.equal(
        activeToolbox.result.structuredContent.client.handoffPresetRef,
        "claude.toolbox"
      );
      assert.deepEqual(
        activeToolbox.result.structuredContent.client.suppressedSemanticCapabilities,
        []
      );
      assert.deepEqual(
        activeToolbox.result.structuredContent.client.suppressedTools,
        []
      );
    } finally {
      await stopChild(runtimeChild);
    }
  } finally {
    await stopChild(child);
  }
});

test("mimir-control MCP resolves repo-write plus logs-read to the composite runtime-observe toolbox", async (t) => {
  const child = spawnControlServer({
    activeProfile: "bootstrap",
    clientId: "codex"
  });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 46,
      method: "tools/call",
      params: {
        name: "request_toolbox_activation",
        arguments: {
          requiredCategories: ["repo-write", "logs-read"]
        }
      }
    });

    const activation = await transport.next();
    assert.equal(activation.result.structuredContent.approved, true);
    assert.equal(
      activation.result.structuredContent.approvedToolbox,
      "core-dev+runtime-observe"
    );
    assert.equal(
      activation.result.structuredContent.approvedProfile,
      "core-dev+runtime-observe"
    );
    assert.equal(
      activation.result.structuredContent.handoff.targetProfileId,
      "core-dev+runtime-observe"
    );

    const runtimeChild = spawnControlServer({
      activeProfile: "core-dev+runtime-observe",
      clientId: "codex"
    });
    try {
      const runtimeTransport = createMessageCollector(runtimeChild.stdout);
      await initializeMcp(runtimeTransport, runtimeChild.stdin);
      writeMcpMessage(runtimeChild.stdin, {
        jsonrpc: "2.0",
        id: 471,
        method: "tools/call",
        params: {
          name: "list_active_toolbox",
          arguments: {}
        }
      });
      const activeToolbox = await runtimeTransport.next();
      assert.equal(activeToolbox.result.structuredContent.profile.id, "core-dev+runtime-observe");
      assert.equal(
        activeToolbox.result.structuredContent.workflow.toolboxId,
        "core-dev+runtime-observe"
      );
      assert.equal(
        activeToolbox.result.structuredContent.workflow.activationMode,
        "session-switch"
      );
      assert.equal(
        activeToolbox.result.structuredContent.workflow.sessionMode,
        "toolbox-activated"
      );
      assert.equal(
        activeToolbox.result.structuredContent.workflow.requiresApproval,
        false
      );
      assert.equal(
        activeToolbox.result.structuredContent.workflow.fallbackProfile,
        "runtime-observe"
      );
      assert.equal(activeToolbox.result.structuredContent.profile.composite, true);
      assert.deepEqual(
        activeToolbox.result.structuredContent.profile.baseProfiles,
        ["core-dev", "runtime-observe"]
      );
      assert.equal(
        activeToolbox.result.structuredContent.profile.fallbackProfile,
        "runtime-observe"
      );
      assert.ok(
        activeToolbox.result.structuredContent.profile.allowedCategories.includes("logs-read")
      );
      assert.ok(
        activeToolbox.result.structuredContent.profile.deniedCategories.includes("docker-write")
      );
      assert.equal(activeToolbox.result.structuredContent.client.id, "codex");
      assert.equal(
        activeToolbox.result.structuredContent.client.handoffStrategy,
        "env-reconnect"
      );
      assert.equal(
        activeToolbox.result.structuredContent.client.handoffPresetRef,
        "codex.toolbox"
      );
      assert.equal(
        activeToolbox.result.structuredContent.client.clientPresetRef,
        "codex.toolbox"
      );

      writeMcpMessage(runtimeChild.stdin, {
        jsonrpc: "2.0",
        id: 472,
        method: "tools/call",
        params: {
          name: "list_active_tools",
          arguments: {}
        }
      });
      const activeTools = await runtimeTransport.next();
      const activeToolIds = activeTools.result.structuredContent.tools.map((tool) => tool.toolId);
      assert.ok(activeToolIds.includes("draft_note"));
      assert.ok(activeToolIds.includes("grafana.logs.query"));
      assert.ok(activeToolIds.includes("docker.inspect"));
      assert.ok(activeToolIds.includes("kubernetes.context.inspect"));
      assert.ok(activeToolIds.includes("kubernetes.events.list"));
      assert.ok(activeToolIds.includes("kubernetes.logs.query"));
      assert.ok(!activeToolIds.includes("docker.restart"));
      assert.ok(!activeToolIds.includes("kubernetes.apply"));
    } finally {
      await stopChild(runtimeChild);
    }
  } finally {
    await stopChild(child);
  }
});

test("mimir-control MCP records activation denial diagnostics and audit history", async (t) => {
  const { root, sqlitePath } = await createTempSqlitePath();
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
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
    assert.equal(
      activation.result.structuredContent.diagnostics.profileRevision,
      policy.profiles.bootstrap.profileRevision
    );
    assert.deepEqual(activation.result.structuredContent.diagnostics.requiredCategories, ["search"]);
    assert.equal(activation.result.structuredContent.leaseExpiresAt, null);
    assert.equal(
      activation.result.structuredContent.handoff.lease.expiresAt,
      undefined
    );
    assert.equal(activation.result.structuredContent.auditEvents[0].type, "toolbox_activation_denied");
    assert.equal(
      activation.result.structuredContent.auditEvents[0].profileRevision,
      policy.profiles.bootstrap.profileRevision
    );
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

test("mimir-control MCP deactivation returns the active profile fallback downgrade target", async () => {
  const { root, sqlitePath } = await createTempSqlitePath();
  const child = spawnControlServer({
    activeProfile: "docs-research",
    clientId: "codex",
    sqlitePath
  });
  try {
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

    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 81,
      method: "tools/call",
      params: {
        name: "deactivate_toolbox",
        arguments: {
          leaseToken: validLease
        }
      }
    });

    const deactivation = await transport.next();
    assert.equal(deactivation.result.structuredContent.reasonCode, "toolbox_deactivated");
    assert.equal(deactivation.result.structuredContent.activeProfile, "docs-research");
    assert.equal(deactivation.result.structuredContent.downgradeTarget, "core-dev");
    assert.equal(
      deactivation.result.structuredContent.handoff.targetProfileId,
      "core-dev"
    );
    assert.equal(
      deactivation.result.structuredContent.handoff.downgradeTarget,
      "core-dev"
    );
    assert.equal(deactivation.result.structuredContent.diagnostics.lease.revoked, true);
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

test("mimir-control MCP lists DeepWiki read-only tools when docs-research is active", { timeout: 10000 }, async () => {
  const child = spawnControlServer({ activeProfile: "docs-research", clientId: "codex" });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 221,
      method: "tools/call",
      params: {
        name: "list_active_tools",
        arguments: {}
      }
    });

    const activeTools = await transport.next();
    const activeToolIds = activeTools.result.structuredContent.activeTools.map((t) => t.toolId);

    assert.ok(
      activeToolIds.includes("read_wiki_structure"),
      "docs-research must expose read_wiki_structure as active tool"
    );
    assert.ok(
      activeToolIds.includes("read_wiki_contents"),
      "docs-research must expose read_wiki_contents as active tool"
    );
    assert.ok(
      activeToolIds.includes("ask_question"),
      "docs-research must expose ask_question as active tool"
    );

    const deepwikiTools = activeTools.result.structuredContent.activeTools.filter((t) =>
      t.semanticCapabilityId?.startsWith("repo.knowledge.")
    );
    for (const tool of deepwikiTools) {
      assert.equal(tool.category, "repo-knowledge-read", `${tool.toolId} must use repo-knowledge-read`);
      assert.equal(tool.trustClass, "external-read", `${tool.toolId} must be external-read`);
      assert.equal(tool.mutationLevel, "read", `${tool.toolId} must be read-only`);
    }

    assert.ok(
      !activeTools.result.structuredContent.suppressedTools.some((t) =>
        t.semanticCapabilityId?.startsWith("repo.knowledge.")
      ),
      "Codex overlay must not suppress deepwiki tools"
    );
  } finally {
    await stopChild(child);
  }
});

test("mimir-control MCP lists Semgrep read-only tools when security-audit is active", { timeout: 10000 }, async () => {
  const child = spawnControlServer({ activeProfile: "security-audit", clientId: "codex" });
  try {
    const transport = createMessageCollector(child.stdout);
    await initializeMcp(transport, child.stdin);

    writeMcpMessage(child.stdin, {
      jsonrpc: "2.0",
      id: 220,
      method: "tools/call",
      params: {
        name: "list_active_tools",
        arguments: {}
      }
    });

    const activeTools = await transport.next();

    assert.ok(
      activeTools.result.structuredContent.activeTools.some((t) =>
        t.semanticCapabilityId?.startsWith("security.semgrep.")
      ),
      "security-audit must expose at least one security.semgrep.* tool as active"
    );

    const semgrepTools = activeTools.result.structuredContent.activeTools.filter((t) =>
      t.semanticCapabilityId?.startsWith("security.semgrep.")
    );
    for (const tool of semgrepTools) {
      assert.equal(tool.mutationLevel, "read", `${tool.toolId} must be read-only`);
      assert.equal(tool.trustClass, "external-read", `${tool.toolId} must be external-read`);
      assert.equal(tool.category, "security-scan-read", `${tool.toolId} must use security-scan-read category`);
    }

    assert.ok(
      !activeTools.result.structuredContent.suppressedTools.some((t) =>
        t.semanticCapabilityId?.startsWith("security.semgrep.")
      ),
      "Codex overlay must not suppress semgrep tools"
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
