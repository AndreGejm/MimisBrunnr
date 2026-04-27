import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawn } from "node:child_process";

function writeMcpMessage(stream, message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  stream.write(Buffer.concat([header, body]));
}

function createRpcHarness(stream) {
  let buffer = Buffer.alloc(0);
  const pendingResponses = new Map();
  const queuedResponses = new Map();
  const queuedNotifications = [];
  const pendingNotifications = [];

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

      if (Object.prototype.hasOwnProperty.call(payload, "id")) {
        const key = String(payload.id);
        const waiter = pendingResponses.get(key);
        if (waiter) {
          pendingResponses.delete(key);
          waiter(payload);
        } else {
          queuedResponses.set(key, payload);
        }
        continue;
      }

      if (pendingNotifications.length > 0) {
        const waiter = pendingNotifications.shift();
        waiter(payload);
      } else {
        queuedNotifications.push(payload);
      }
    }
  });

  return {
    async request(stdin, id, method, params) {
      const key = String(id);
      if (queuedResponses.has(key)) {
        const response = queuedResponses.get(key);
        queuedResponses.delete(key);
        return response;
      }

      const responsePromise = new Promise((resolve) => {
        pendingResponses.set(key, resolve);
      });

      writeMcpMessage(stdin, {
        jsonrpc: "2.0",
        id,
        method,
        ...(params ? { params } : {})
      });

      return responsePromise;
    },
    async nextNotification({ timeoutMs = 1000, optional = false } = {}) {
      if (queuedNotifications.length > 0) {
        return queuedNotifications.shift();
      }

      const notificationPromise = new Promise((resolve) => {
        pendingNotifications.push(resolve);
      });
      const timeoutPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (optional) {
            resolve(null);
            return;
          }
          reject(
            new Error(
              `Timed out waiting ${timeoutMs}ms for broker notification.`
            )
          );
        }, timeoutMs);
        notificationPromise.finally(() => clearTimeout(timer));
      });

      return Promise.race([notificationPromise, timeoutPromise]);
    }
  };
}

async function ensureWorkspacePackageLinks() {
  const packageRoot = path.join(process.cwd(), "apps", "mimir-toolbox-mcp");
  const scopedRoot = path.join(packageRoot, "node_modules", "@mimir");
  for (const packageName of ["contracts", "infrastructure"]) {
    const linkPath = path.join(scopedRoot, packageName);
    try {
      const stats = await lstat(linkPath);
      if (stats.isSymbolicLink() || stats.isDirectory()) {
        continue;
      }
    } catch {
      await mkdir(scopedRoot, { recursive: true });
      await symlink(
        path.join(process.cwd(), "packages", packageName),
        linkPath,
        "junction"
      );
    }
  }
}

function spawnToolboxBroker({
  manifestDirectory,
  activeProfile = "bootstrap",
  clientId = "codex",
  extraEnv = {}
}) {
  const child = spawn(
    process.execPath,
    [path.join(process.cwd(), "apps", "mimir-toolbox-mcp", "dist", "main.js")],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MAB_NODE_ENV: "test",
        MAB_TOOLBOX_MANIFEST_DIR: manifestDirectory,
        MAB_TOOLBOX_ACTIVE_PROFILE: activeProfile,
        MAB_TOOLBOX_CLIENT_ID: clientId,
        MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret"
        ,
        ...extraEnv
      },
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  child.stderr.resume();
  return child;
}

async function initializeMcp(client, stdin) {
  return client.request(stdin, 1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {}
  });
}

async function stopChild(child) {
  if (child.killed) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("close", resolve));
}

async function createToolboxManifestRoot({ idleTimeoutSeconds = 120 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-toolbox-local-stdio-"));
  const peerScriptPath = path
    .resolve("tests", "fixtures", "mcp", "local-stdio-peer.mjs")
    .replace(/\\/g, "/");
  const nodeExecutable = process.execPath.replace(/\\/g, "/");

  const writeYaml = async (relativePath, lines) => {
    const targetPath = path.join(root, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, lines.join("\n"), "utf8");
  };

  await writeYaml("categories.yaml", [
    "categories:",
    "  repo-read:",
    "    description: Read-only repository access",
    "    trustClass: local-read",
    "    mutationLevel: read",
    "  local-docs:",
    "    description: Local documentation lookup",
    "    trustClass: local-read",
    "    mutationLevel: read",
    "  internal-memory:",
    "    description: Internal memory retrieval",
    "    trustClass: local-read",
    "    mutationLevel: read",
    "  internal-memory-write:",
    "    description: Internal memory writes",
    "    trustClass: local-readwrite",
    "    mutationLevel: write",
    "  peer-read:",
    "    description: Local stdio peer read access",
    "    trustClass: external-read",
    "    mutationLevel: read"
  ]);

  await writeYaml("trust-classes.yaml", [
    "trustClasses:",
    "  local-read:",
    "    level: 10",
    "    description: Local read-only",
    "  local-readwrite:",
    "    level: 20",
    "    description: Local read/write",
    "  external-read:",
    "    level: 30",
    "    description: External read-only"
  ]);

  await writeYaml("servers/mimir-control.yaml", [
    "server:",
    "  id: mimir-control",
    "  displayName: Mimir Control",
    "  source: owned",
    "  kind: control",
    "  trustClass: local-read",
    "  mutationLevel: read",
    "  tools:",
    "    - toolId: list_toolboxes",
    "      displayName: List Toolboxes",
    "      category: repo-read",
    "      trustClass: local-read",
    "      mutationLevel: read",
    "      semanticCapabilityId: toolbox.discovery.list",
    "    - toolId: describe_toolbox",
    "      displayName: Describe Toolbox",
    "      category: repo-read",
    "      trustClass: local-read",
    "      mutationLevel: read",
    "      semanticCapabilityId: toolbox.discovery.describe",
    "    - toolId: request_toolbox_activation",
    "      displayName: Request Toolbox Activation",
    "      category: repo-read",
    "      trustClass: local-read",
    "      mutationLevel: read",
    "      semanticCapabilityId: toolbox.activation.request",
    "    - toolId: list_active_toolbox",
    "      displayName: List Active Toolbox",
    "      category: repo-read",
    "      trustClass: local-read",
    "      mutationLevel: read",
    "      semanticCapabilityId: toolbox.activation.state",
    "    - toolId: list_active_tools",
    "      displayName: List Active Tools",
    "      category: repo-read",
    "      trustClass: local-read",
    "      mutationLevel: read",
    "      semanticCapabilityId: toolbox.activation.tools",
    "    - toolId: deactivate_toolbox",
    "      displayName: Deactivate Toolbox",
    "      category: repo-read",
    "      trustClass: local-read",
    "      mutationLevel: read",
    "      semanticCapabilityId: toolbox.activation.deactivate"
  ]);

  await writeYaml("servers/mimir-core.yaml", [
    "server:",
    "  id: mimir-core",
    "  displayName: Mimir Core",
    "  source: owned",
    "  kind: semantic",
    "  trustClass: local-read",
    "  mutationLevel: read",
    "  tools:",
    "    - toolId: search_context",
    "      displayName: Search Context",
    "      category: internal-memory",
    "      trustClass: local-read",
    "      mutationLevel: read",
    "      semanticCapabilityId: mimir.context.search",
    "    - toolId: fetch_decision_summary",
    "      displayName: Fetch Decision Summary",
    "      category: local-docs",
    "      trustClass: local-read",
    "      mutationLevel: read",
    "      semanticCapabilityId: mimir.decision.summary",
    "    - toolId: draft_note",
    "      displayName: Draft Note",
    "      category: internal-memory-write",
    "      trustClass: local-readwrite",
    "      mutationLevel: write",
    "      semanticCapabilityId: mimir.memory.draft",
    "    - toolId: create_session_archive",
    "      displayName: Create Session Archive",
    "      category: internal-memory-write",
    "      trustClass: local-readwrite",
    "      mutationLevel: write",
    "      semanticCapabilityId: mimir.memory.archive"
  ]);

  await writeYaml("servers/temp-local-stdio-peer.yaml", [
    "server:",
    "  id: temp-local-stdio-peer",
    "  displayName: Temp Local Stdio Peer",
    "  source: peer",
    "  kind: peer",
    "  trustClass: external-read",
    "  mutationLevel: read",
    "  runtimeBinding:",
    "    kind: local-stdio",
    `    command: '${nodeExecutable}'`,
    "    args:",
    `      - '${peerScriptPath}'`,
    "  tools:",
    "    - toolId: temp_peer_echo",
    "      displayName: Temp Peer Echo",
    "      category: peer-read",
    "      trustClass: external-read",
    "      mutationLevel: read",
    "      semanticCapabilityId: peer.temp.echo"
  ]);

  await writeYaml("servers/temp-docker-catalog-peer.yaml", [
    "server:",
    "  id: temp-docker-catalog-peer",
    "  displayName: Temp Docker Catalog Peer",
    "  source: peer",
    "  kind: peer",
    "  trustClass: external-read",
    "  mutationLevel: read",
    "  dockerRuntime:",
    "    applyMode: catalog",
    "    catalogServerId: temp-docker-catalog",
    "  tools:",
    "    - toolId: temp_docker_search",
    "      displayName: Temp Docker Search",
    "      category: peer-read",
    "      trustClass: external-read",
    "      mutationLevel: read",
    "      semanticCapabilityId: peer.temp.docker.search"
  ]);

  await writeYaml("servers/temp-descriptor-only-peer.yaml", [
    "server:",
    "  id: temp-descriptor-only-peer",
    "  displayName: Temp Descriptor Only Peer",
    "  source: peer",
    "  kind: peer",
    "  trustClass: external-read",
    "  mutationLevel: read",
    "  dockerRuntime:",
    "    applyMode: descriptor-only",
    "    blockedReason: >-",
    "      descriptor-only peer is intentionally blocked in the mixed-peer diagnostics fixture.",
    "    unsafeCatalogServerIds:",
    "      - temp-descriptor-only",
    "  tools:",
    "    - toolId: temp_descriptor_read",
    "      displayName: Temp Descriptor Read",
    "      category: peer-read",
    "      trustClass: external-read",
    "      mutationLevel: read",
    "      semanticCapabilityId: peer.temp.descriptor.read"
  ]);

  await writeYaml("bands/bootstrap.yaml", [
    "band:",
    "  id: bootstrap",
    "  displayName: Bootstrap",
    "  trustClass: local-read",
    "  mutationLevel: read",
    "  autoExpand: false",
    "  requiresApproval: false",
    "  includeServers:",
    "    - mimir-control",
    "    - mimir-core",
    "  allowedCategories:",
    "    - repo-read",
    "    - local-docs",
    "    - internal-memory",
    "  deniedCategories:",
    "    - internal-memory-write",
    "    - peer-read",
    "  contraction:",
    "    taskAware: false",
    "    onLeaseExpiry: true"
  ]);

  await writeYaml("bands/temp-peer-read.yaml", [
    "band:",
    "  id: temp-peer-read",
    "  displayName: Temp Peer Read",
    "  trustClass: external-read",
    "  mutationLevel: read",
    "  autoExpand: false",
    "  requiresApproval: false",
    "  includeServers:",
    "    - mimir-control",
    "    - mimir-core",
    "    - temp-local-stdio-peer",
    "  allowedCategories:",
    "    - repo-read",
    "    - local-docs",
    "    - internal-memory",
    "    - peer-read",
    "  deniedCategories:",
    "    - internal-memory-write",
    "  contraction:",
    "    taskAware: true",
    `    idleTimeoutSeconds: ${idleTimeoutSeconds}`,
    "    onLeaseExpiry: true"
  ]);

  await writeYaml("bands/temp-mixed-peer-read.yaml", [
    "band:",
    "  id: temp-mixed-peer-read",
    "  displayName: Temp Mixed Peer Read",
    "  trustClass: external-read",
    "  mutationLevel: read",
    "  autoExpand: false",
    "  requiresApproval: false",
    "  includeServers:",
    "    - mimir-control",
    "    - mimir-core",
    "    - temp-local-stdio-peer",
    "    - temp-docker-catalog-peer",
    "    - temp-descriptor-only-peer",
    "  allowedCategories:",
    "    - repo-read",
    "    - local-docs",
    "    - internal-memory",
    "    - peer-read",
    "  deniedCategories:",
    "    - internal-memory-write",
    "  contraction:",
    "    taskAware: true",
    `    idleTimeoutSeconds: ${idleTimeoutSeconds}`,
    "    onLeaseExpiry: true"
  ]);

  await writeYaml("profiles/bootstrap.yaml", [
    "profile:",
    "  id: bootstrap",
    "  displayName: Bootstrap",
    "  sessionMode: toolbox-bootstrap",
    "  includeBands:",
    "    - bootstrap"
  ]);

  await writeYaml("profiles/temp-peer-toolbox.yaml", [
    "profile:",
    "  id: temp-peer-toolbox",
    "  displayName: Temp Peer Toolbox",
    "  sessionMode: toolbox-activated",
    "  includeBands:",
    "    - temp-peer-read"
  ]);

  await writeYaml("profiles/temp-mixed-peer-toolbox.yaml", [
    "profile:",
    "  id: temp-mixed-peer-toolbox",
    "  displayName: Temp Mixed Peer Toolbox",
    "  sessionMode: toolbox-activated",
    "  includeBands:",
    "    - temp-mixed-peer-read"
  ]);

  await writeYaml("intents.yaml", [
    "intents:",
    "  temp-peer-toolbox:",
    "    displayName: Temp Peer Toolbox",
    "    summary: Activate a local stdio peer fixture in the same broker session.",
    "    exampleTasks:",
    "      - Call the temp local stdio peer",
    "    targetProfile: temp-peer-toolbox",
    "    trustClass: external-read",
    "    requiresApproval: false",
    "    activationMode: session-switch",
    "    allowedCategories:",
    "      - repo-read",
    "      - local-docs",
    "      - internal-memory",
    "      - peer-read",
    "    deniedCategories:",
    "      - internal-memory-write",
    "    fallbackProfile: bootstrap"
    ,
    "  temp-mixed-peer-toolbox:",
    "    displayName: Temp Mixed Peer Toolbox",
    "    summary: Activate a mixed peer toolbox in the same broker session.",
    "    exampleTasks:",
    "      - Inspect local and omitted peer broker diagnostics",
    "    targetProfile: temp-mixed-peer-toolbox",
    "    trustClass: external-read",
    "    requiresApproval: false",
    "    activationMode: session-switch",
    "    allowedCategories:",
    "      - repo-read",
    "      - local-docs",
    "      - internal-memory",
    "      - peer-read",
    "    deniedCategories:",
    "      - internal-memory-write",
    "    fallbackProfile: bootstrap"
  ]);

  await writeYaml("clients/codex.yaml", [
    "client:",
    "  id: codex",
    "  displayName: Codex",
    "  handoffStrategy: env-reconnect",
    "  handoffPresetRef: codex.toolbox"
  ]);

  return root;
}

test("mimir-toolbox-mcp emits tools/list_changed when a local-stdio peer toolbox activates", async (t) => {
  await ensureWorkspacePackageLinks();
  const manifestDirectory = await createToolboxManifestRoot();
  t.after(async () => {
    await rm(manifestDirectory, { recursive: true, force: true });
  });

  const child = spawnToolboxBroker({ manifestDirectory });
  t.after(async () => {
    await stopChild(child);
  });

  const client = createRpcHarness(child.stdout);
  const initialize = await initializeMcp(client, child.stdin);
  assert.equal(initialize.result.serverInfo.name, "mimir-toolbox-mcp");

  const bootstrapTools = await client.request(child.stdin, 2, "tools/list");
  assert.ok(
    !bootstrapTools.result.tools.some((tool) => tool.name === "temp_peer_echo"),
    "bootstrap should stay narrow before activation"
  );

  const activation = await client.request(child.stdin, 3, "tools/call", {
    name: "request_toolbox_activation",
    arguments: {
      requestedToolbox: "temp-peer-toolbox",
      clientId: "codex",
      taskSummary: "Need the temp local stdio peer in the current broker session."
    }
  });
  assert.equal(activation.result.structuredContent.approved, true);
  assert.equal(
    activation.result.structuredContent.approvedProfile,
    "temp-peer-toolbox"
  );

  const notification = await client.nextNotification({ timeoutMs: 1500 });
  assert.equal(notification.method, "notifications/tools/list_changed");

  const activatedTools = await client.request(child.stdin, 4, "tools/list");
  assert.ok(
    activatedTools.result.tools.some((tool) => tool.name === "temp_peer_echo"),
    "activated broker tools/list should include the local-stdio peer tool"
  );
});

test("mimir-toolbox-mcp hides non-routable mixed peers and reports backend diagnostics on activation", async (t) => {
  await ensureWorkspacePackageLinks();
  const manifestDirectory = await createToolboxManifestRoot();
  t.after(async () => {
    await rm(manifestDirectory, { recursive: true, force: true });
  });

  const child = spawnToolboxBroker({ manifestDirectory });
  t.after(async () => {
    await stopChild(child);
  });

  const client = createRpcHarness(child.stdout);
  await initializeMcp(client, child.stdin);

  const activation = await client.request(child.stdin, 3, "tools/call", {
    name: "request_toolbox_activation",
    arguments: {
      requestedToolbox: "temp-mixed-peer-toolbox",
      clientId: "codex",
      taskSummary: "Need mixed peer diagnostics in the current broker session."
    }
  });
  assert.equal(activation.result.structuredContent.approved, true);
  assert.equal(
    activation.result.structuredContent.approvedProfile,
    "temp-mixed-peer-toolbox"
  );

  const notification = await client.nextNotification({ timeoutMs: 1500 });
  assert.equal(notification.method, "notifications/tools/list_changed");

  const brokerTools = await client.request(child.stdin, 4, "tools/list");
  const brokerToolNames = brokerTools.result.tools.map((tool) => tool.name);
  assert.ok(brokerToolNames.includes("temp_peer_echo"));
  assert.ok(!brokerToolNames.includes("temp_docker_search"));
  assert.ok(!brokerToolNames.includes("temp_descriptor_read"));

  const activeTools = await client.request(child.stdin, 5, "tools/call", {
    name: "list_active_tools",
    arguments: {}
  });
  assert.ok(
    activeTools.result.structuredContent.brokerOmittedTools.some(
      (tool) => tool.toolId === "temp_docker_search" && tool.reason.length > 0
    )
  );
  assert.ok(
    activeTools.result.structuredContent.brokerOmittedTools.some(
      (tool) => tool.toolId === "temp_descriptor_read" && tool.reason.length > 0
    )
  );
  assert.deepEqual(
    activeTools.result.structuredContent.brokerBackendStates,
    [
      {
        serverId: "temp-local-stdio-peer",
        runtimeBindingKind: "local-stdio",
        routable: true,
        health: {
          status: "ready"
        }
      },
      {
        serverId: "temp-docker-catalog-peer",
        runtimeBindingKind: "docker-catalog",
        routable: false,
        reason: "docker-backed peer routing is not implemented in the dynamic broker yet"
      },
      {
        serverId: "temp-descriptor-only-peer",
        runtimeBindingKind: "descriptor-only",
        routable: false,
        reason: "descriptor-only peer is intentionally blocked in the mixed-peer diagnostics fixture."
      }
    ]
  );
});

test("mimir-toolbox-mcp exposes, routes, and then removes a local-stdio peer tool in one session", async (t) => {
  await ensureWorkspacePackageLinks();
  const manifestDirectory = await createToolboxManifestRoot();
  t.after(async () => {
    await rm(manifestDirectory, { recursive: true, force: true });
  });

  const child = spawnToolboxBroker({ manifestDirectory });
  t.after(async () => {
    await stopChild(child);
  });

  const client = createRpcHarness(child.stdout);
  await initializeMcp(client, child.stdin);

  const activation = await client.request(child.stdin, 10, "tools/call", {
    name: "request_toolbox_activation",
    arguments: {
      requestedToolbox: "temp-peer-toolbox",
      clientId: "codex",
      taskSummary: "Need the temp local stdio peer in the current broker session."
    }
  });
  await client.nextNotification({ timeoutMs: 250, optional: true });

  const activeTools = await client.request(child.stdin, 11, "tools/call", {
    name: "list_active_tools",
    arguments: {}
  });
  assert.ok(
    activeTools.result.structuredContent.activeTools.some(
      (tool) => tool.toolId === "temp_peer_echo"
    ),
    "control-surface active tools should include the local-stdio peer descriptor"
  );

  const brokerTools = await client.request(child.stdin, 12, "tools/list");
  assert.ok(
    brokerTools.result.tools.some((tool) => tool.name === "temp_peer_echo"),
    "broker tools/list should expose the activated local-stdio peer tool"
  );

  const peerCall = await client.request(child.stdin, 13, "tools/call", {
    name: "temp_peer_echo",
    arguments: {
      message: "hello from the dynamic toolbox"
    }
  });
  assert.equal(peerCall.result.isError, false);
  assert.equal(
    peerCall.result.structuredContent.echoed,
    "hello from the dynamic toolbox"
  );
  assert.equal(
    peerCall.result.structuredContent.source,
    "local-stdio-peer-fixture"
  );

  const deactivation = await client.request(child.stdin, 14, "tools/call", {
    name: "deactivate_toolbox",
    arguments: {
      leaseToken: activation.result.structuredContent.leaseToken
    }
  });
  assert.equal(
    deactivation.result.structuredContent.downgradeTarget,
    "bootstrap"
  );

  const deactivationNotification = await client.nextNotification({
    timeoutMs: 1500
  });
  assert.equal(
    deactivationNotification.method,
    "notifications/tools/list_changed"
  );

  const downgradedTools = await client.request(child.stdin, 15, "tools/list");
  assert.ok(
    !downgradedTools.result.tools.some((tool) => tool.name === "temp_peer_echo"),
    "deactivation should contract the broker surface back to bootstrap"
  );
});

test("mimir-toolbox-mcp contracts an idle peer toolbox back to bootstrap in the same session", async (t) => {
  await ensureWorkspacePackageLinks();
  const manifestDirectory = await createToolboxManifestRoot({ idleTimeoutSeconds: 1 });
  t.after(async () => {
    await rm(manifestDirectory, { recursive: true, force: true });
  });

  const child = spawnToolboxBroker({ manifestDirectory });
  t.after(async () => {
    await stopChild(child);
  });

  const client = createRpcHarness(child.stdout);
  await initializeMcp(client, child.stdin);

  const activation = await client.request(child.stdin, 31, "tools/call", {
    name: "request_toolbox_activation",
    arguments: {
      requestedToolbox: "temp-peer-toolbox",
      clientId: "codex",
      taskSummary: "Need the temp peer tool briefly."
    }
  });
  assert.equal(activation.result.structuredContent.approved, true);
  const activationNotification = await client.nextNotification({
    timeoutMs: 1500,
    optional: true
  });
  if (activationNotification) {
    assert.equal(activationNotification.method, "notifications/tools/list_changed");
  }

  const activatedTools = await client.request(child.stdin, 32, "tools/list");
  assert.ok(
    activatedTools.result.tools.some((tool) => tool.name === "temp_peer_echo"),
    "activated broker tools/list should include the local-stdio peer tool"
  );

  await new Promise((resolve) => setTimeout(resolve, 1200));

  const contractionNotification = await client.nextNotification({
    timeoutMs: 1500
  });
  assert.equal(contractionNotification.method, "notifications/tools/list_changed");

  const activeToolbox = await client.request(child.stdin, 33, "tools/call", {
    name: "list_active_toolbox",
    arguments: {}
  });
  assert.equal(activeToolbox.result.structuredContent.profile.id, "bootstrap");
  assert.equal(
    activeToolbox.result.structuredContent.sessionState.activationCause,
    "idle_timeout"
  );

  const contractedTools = await client.request(child.stdin, 34, "tools/list");
  assert.ok(
    !contractedTools.result.tools.some((tool) => tool.name === "temp_peer_echo"),
    "idle contraction should remove the peer tool from broker tools/list"
  );

  const stalePeerCall = await client.request(child.stdin, 35, "tools/call", {
    name: "temp_peer_echo",
    arguments: {
      message: "still there?"
    }
  });
  assert.equal(stalePeerCall.result.isError, true);
  assert.equal(
    stalePeerCall.result.structuredContent.error.code,
    "toolbox_session_contracted"
  );
});

test("mimir-toolbox-mcp contracts an activated peer toolbox when its lease expires", async (t) => {
  await ensureWorkspacePackageLinks();
  const manifestDirectory = await createToolboxManifestRoot({ idleTimeoutSeconds: 120 });
  t.after(async () => {
    await rm(manifestDirectory, { recursive: true, force: true });
  });

  const child = spawnToolboxBroker({
    manifestDirectory,
    extraEnv: {
      MAB_TOOLBOX_LEASE_TTL_SECONDS: "1"
    }
  });
  t.after(async () => {
    await stopChild(child);
  });

  const client = createRpcHarness(child.stdout);
  await initializeMcp(client, child.stdin);

  const activation = await client.request(child.stdin, 41, "tools/call", {
    name: "request_toolbox_activation",
    arguments: {
      requestedToolbox: "temp-peer-toolbox",
      clientId: "codex",
      taskSummary: "Need the temp peer tool under a short lease."
    }
  });
  assert.equal(activation.result.structuredContent.approved, true);
  assert.match(
    activation.result.structuredContent.leaseExpiresAt,
    /^\d{4}-\d{2}-\d{2}T/
  );
  const activationNotification = await client.nextNotification({
    timeoutMs: 1500,
    optional: true
  });
  if (activationNotification) {
    assert.equal(activationNotification.method, "notifications/tools/list_changed");
  }

  await new Promise((resolve) => setTimeout(resolve, 1200));

  const contractionNotification = await client.nextNotification({
    timeoutMs: 1500
  });
  assert.equal(contractionNotification.method, "notifications/tools/list_changed");

  const activeToolbox = await client.request(child.stdin, 42, "tools/call", {
    name: "list_active_toolbox",
    arguments: {}
  });
  assert.equal(activeToolbox.result.structuredContent.profile.id, "bootstrap");
  assert.equal(
    activeToolbox.result.structuredContent.sessionState.activationCause,
    "lease_expired"
  );

  const contractedTools = await client.request(child.stdin, 43, "tools/list");
  assert.ok(
    !contractedTools.result.tools.some((tool) => tool.name === "temp_peer_echo"),
    "lease expiry contraction should remove the peer tool from broker tools/list"
  );

  const stalePeerCall = await client.request(child.stdin, 44, "tools/call", {
    name: "temp_peer_echo",
    arguments: {
      message: "still there?"
    }
  });
  assert.equal(stalePeerCall.result.isError, true);
  assert.equal(
    stalePeerCall.result.structuredContent.error.code,
    "toolbox_session_contracted"
  );

  const deactivation = await client.request(child.stdin, 45, "tools/call", {
    name: "deactivate_toolbox",
    arguments: {
      leaseToken: activation.result.structuredContent.leaseToken
    }
  });
  assert.equal(
    deactivation.result.structuredContent.diagnostics.lease.reasonCode,
    "toolbox_expired"
  );
});
