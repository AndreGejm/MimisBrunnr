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
  clientId = "codex"
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

async function createMixedPeerToolboxManifestRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-toolbox-peer-diagnostics-"));
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
    "    description: Mixed peer read access",
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
    "    idleTimeoutSeconds: 120",
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

async function activateMixedPeerToolbox(client, stdin) {
  const activation = await client.request(stdin, 10, "tools/call", {
    name: "request_toolbox_activation",
    arguments: {
      requestedToolbox: "temp-mixed-peer-toolbox",
      clientId: "codex",
      taskSummary: "Need mixed peer diagnostics in the current broker session."
    }
  });
  assert.equal(activation.result.structuredContent.approved, true);
  await client.nextNotification({ timeoutMs: 1500 });
  return activation;
}

test("mixed peer toolbox keeps broker tools/list to routable peers and reports omitted reasons", async (t) => {
  await ensureWorkspacePackageLinks();
  const manifestDirectory = await createMixedPeerToolboxManifestRoot();
  t.after(async () => {
    await rm(manifestDirectory, { recursive: true, force: true });
  });

  const child = spawnToolboxBroker({ manifestDirectory });
  t.after(async () => {
    await stopChild(child);
  });

  const client = createRpcHarness(child.stdout);
  await initializeMcp(client, child.stdin);
  await activateMixedPeerToolbox(client, child.stdin);

  const brokerTools = await client.request(child.stdin, 11, "tools/list");
  const brokerToolNames = brokerTools.result.tools.map((tool) => tool.name);
  assert.ok(brokerToolNames.includes("temp_peer_echo"));
  assert.ok(!brokerToolNames.includes("temp_docker_search"));
  assert.ok(!brokerToolNames.includes("temp_descriptor_read"));

  const activeTools = await client.request(child.stdin, 12, "tools/call", {
    name: "list_active_tools",
    arguments: {}
  });
  assert.ok(
    activeTools.result.structuredContent.brokerVisibleTools.includes("temp_peer_echo")
  );
  assert.ok(
    !activeTools.result.structuredContent.brokerVisibleTools.includes("temp_docker_search")
  );
  assert.ok(
    !activeTools.result.structuredContent.brokerVisibleTools.includes("temp_descriptor_read")
  );

  assert.deepEqual(
    activeTools.result.structuredContent.brokerOmittedTools.map((tool) => tool.toolId).sort(),
    ["temp_descriptor_read", "temp_docker_search"]
  );
  assert.match(
    activeTools.result.structuredContent.brokerOmittedTools.find(
      (tool) => tool.toolId === "temp_docker_search"
    ).reason,
    /docker-backed peer routing is not implemented/i
  );
  assert.match(
    activeTools.result.structuredContent.brokerOmittedTools.find(
      (tool) => tool.toolId === "temp_descriptor_read"
    ).reason,
    /descriptor-only peer is intentionally blocked/i
  );
});

test("mixed peer toolbox surfaces backend health and routability diagnostics for active peer backends", async (t) => {
  await ensureWorkspacePackageLinks();
  const manifestDirectory = await createMixedPeerToolboxManifestRoot();
  t.after(async () => {
    await rm(manifestDirectory, { recursive: true, force: true });
  });

  const child = spawnToolboxBroker({ manifestDirectory });
  t.after(async () => {
    await stopChild(child);
  });

  const client = createRpcHarness(child.stdout);
  await initializeMcp(client, child.stdin);
  await activateMixedPeerToolbox(client, child.stdin);

  const activeTools = await client.request(child.stdin, 20, "tools/call", {
    name: "list_active_tools",
    arguments: {}
  });
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
