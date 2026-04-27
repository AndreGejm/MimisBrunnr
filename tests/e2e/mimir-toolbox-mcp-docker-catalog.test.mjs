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
        MAB_TOOLBOX_LEASE_ISSUER_SECRET: "toolbox-secret",
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
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("close", resolve);
    child.kill("SIGTERM");
  });
}

async function createDockerCatalogManifestRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mimir-toolbox-docker-catalog-"));

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
    "    description: Docker catalog peer read access",
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

  await writeYaml("bands/temp-docker-catalog-read.yaml", [
    "band:",
    "  id: temp-docker-catalog-read",
    "  displayName: Temp Docker Catalog Read",
    "  trustClass: external-read",
    "  mutationLevel: read",
    "  autoExpand: false",
    "  requiresApproval: false",
    "  includeServers:",
    "    - mimir-control",
    "    - mimir-core",
    "    - temp-docker-catalog-peer",
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

  await writeYaml("profiles/temp-docker-catalog-toolbox.yaml", [
    "profile:",
    "  id: temp-docker-catalog-toolbox",
    "  displayName: Temp Docker Catalog Toolbox",
    "  sessionMode: toolbox-activated",
    "  includeBands:",
    "    - temp-docker-catalog-read"
  ]);

  await writeYaml("intents.yaml", [
    "intents:",
    "  temp-docker-catalog-toolbox:",
    "    displayName: Temp Docker Catalog Toolbox",
    "    summary: Activate a docker-catalog peer in the same broker session.",
    "    exampleTasks:",
    "      - Call the temp docker catalog peer",
    "    targetProfile: temp-docker-catalog-toolbox",
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

test("mimir-toolbox-mcp exposes and routes a docker-catalog peer through the broker session", async (t) => {
  await ensureWorkspacePackageLinks();
  const manifestDirectory = await createDockerCatalogManifestRoot();
  const gatewayFixturePath = path
    .resolve("tests", "fixtures", "mcp", "docker-gateway-peer.mjs")
    .replace(/\\/g, "/");
  t.after(async () => {
    await rm(manifestDirectory, { recursive: true, force: true });
  });

  const child = spawnToolboxBroker({
    manifestDirectory,
    extraEnv: {
      MAB_TOOLBOX_ENABLE_DOCKER_GATEWAY_ADAPTER: "true",
      MAB_TOOLBOX_DOCKER_GATEWAY_EXECUTABLE: process.execPath,
      MAB_TOOLBOX_DOCKER_GATEWAY_ARGS_JSON: JSON.stringify([gatewayFixturePath])
    }
  });
  t.after(async () => {
    await stopChild(child);
  });

  const client = createRpcHarness(child.stdout);
  await initializeMcp(client, child.stdin);

  const bootstrapTools = await client.request(child.stdin, 2, "tools/list");
  assert.ok(
    !bootstrapTools.result.tools.some((tool) => tool.name === "temp_docker_search"),
    "bootstrap should stay narrow before activation"
  );

  const activation = await client.request(child.stdin, 3, "tools/call", {
    name: "request_toolbox_activation",
    arguments: {
      requestedToolbox: "temp-docker-catalog-toolbox",
      clientId: "codex",
      taskSummary: "Need the fake Docker gateway-backed peer in the current broker session."
    }
  });
  assert.equal(activation.result.structuredContent.approved, true);

  const notification = await client.nextNotification({
    timeoutMs: 1500,
    optional: true
  });
  if (notification) {
    assert.equal(notification.method, "notifications/tools/list_changed");
  }

  const activatedTools = await client.request(child.stdin, 4, "tools/list");
  assert.ok(
    activatedTools.result.tools.some((tool) => tool.name === "temp_docker_search"),
    "activated broker tools/list should include the docker-catalog peer tool"
  );

  const peerCall = await client.request(child.stdin, 5, "tools/call", {
    name: "temp_docker_search",
    arguments: {
      query: "toolbox"
    }
  });
  assert.equal(peerCall.result.isError, false);
  assert.equal(peerCall.result.structuredContent.query, "toolbox");
  assert.equal(
    peerCall.result.structuredContent.source,
    "docker-gateway-peer-fixture"
  );
});

test("mimir-toolbox-mcp survives a bad docker-gateway executable and reports backend failure", async (t) => {
  await ensureWorkspacePackageLinks();
  const manifestDirectory = await createDockerCatalogManifestRoot();
  t.after(async () => {
    await rm(manifestDirectory, { recursive: true, force: true });
  });

  const child = spawnToolboxBroker({
    manifestDirectory,
    activeProfile: "temp-docker-catalog-toolbox",
    extraEnv: {
      MAB_TOOLBOX_ENABLE_DOCKER_GATEWAY_ADAPTER: "true",
      MAB_TOOLBOX_DOCKER_GATEWAY_EXECUTABLE: "__missing_docker_gateway_binary__"
    }
  });
  t.after(async () => {
    await stopChild(child);
  });

  const client = createRpcHarness(child.stdout);
  await initializeMcp(client, child.stdin);

  const brokerTools = await client.request(child.stdin, 21, "tools/list");
  assert.ok(
    !brokerTools.result.tools.some((tool) => tool.name === "temp_docker_search"),
    "failed docker gateway startup should keep the docker-catalog peer hidden"
  );

  const activeTools = await client.request(child.stdin, 22, "tools/call", {
    name: "list_active_tools",
    arguments: {}
  });
  assert.deepEqual(
    activeTools.result.structuredContent.brokerBackendStates,
    [
      {
        serverId: "temp-docker-catalog-peer",
        runtimeBindingKind: "docker-catalog",
        routable: false,
        health: {
          status: "error",
          reason: "spawn __missing_docker_gateway_binary__ ENOENT"
        },
        reason: "spawn __missing_docker_gateway_binary__ ENOENT"
      }
    ]
  );
});
