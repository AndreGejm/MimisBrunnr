import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compileToolboxPolicyFromDirectory
} from "../../packages/infrastructure/dist/index.js";

function createFixtureRoot() {
  return mkdtempSync(path.join(tmpdir(), "mimir-toolbox-policy-"));
}

function writeUtf8(root, relativePath, contents) {
  const targetPath = path.join(root, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, contents, "utf8");
}

function seedBaseFixture(root) {
  writeUtf8(
    root,
    "categories.yaml",
    [
      "categories:",
      "  repo-read:",
      "    description: Read-only repository access",
      "    trustClass: local-read",
      "    mutationLevel: read",
      "  repo-write:",
      "    description: Repository mutation access",
      "    trustClass: local-readwrite",
      "    mutationLevel: write",
      "  docs-search:",
      "    description: External documentation lookup",
      "    trustClass: external-read",
      "    mutationLevel: read",
      "  docker-read:",
      "    description: Runtime inspection",
      "    trustClass: ops-read",
      "    mutationLevel: read",
      "  docker-write:",
      "    description: Runtime mutation",
      "    trustClass: ops-mutate",
      "    mutationLevel: admin"
    ].join("\n")
  );

  writeUtf8(
    root,
    "trust-classes.yaml",
    [
      "trustClasses:",
      "  local-read:",
      "    level: 10",
      "    description: Local read-only",
      "  local-readwrite:",
      "    level: 20",
      "    description: Local read/write",
      "  external-read:",
      "    level: 30",
      "    description: External read-only",
      "  ops-read:",
      "    level: 40",
      "    description: Operational read-only",
      "  ops-mutate:",
      "    level: 50",
      "    description: Operational mutation",
      "  operator-only:",
      "    level: 60",
      "    description: Operator-only"
    ].join("\n")
  );

  writeUtf8(
    root,
    "servers/mimir-control.yaml",
    [
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
      "      semanticCapabilityId: toolbox.discovery",
      "    - toolId: request_toolbox_activation",
      "      displayName: Request Toolbox Activation",
      "      category: repo-read",
      "      trustClass: local-read",
      "      mutationLevel: read",
      "      semanticCapabilityId: toolbox.activation"
    ].join("\n")
  );

  writeUtf8(
    root,
    "servers/mimir-core.yaml",
    [
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
      "      category: repo-read",
      "      trustClass: local-read",
      "      mutationLevel: read",
      "      semanticCapabilityId: mimir.context.search"
    ].join("\n")
  );

  writeUtf8(
    root,
    "servers/github-read.yaml",
    [
      "server:",
      "  id: github-read",
      "  displayName: GitHub Read",
      "  source: peer",
      "  kind: peer",
      "  trustClass: external-read",
      "  mutationLevel: read",
      "  tools:",
      "    - toolId: github.search",
      "      displayName: Search GitHub",
      "      category: docs-search",
      "      trustClass: external-read",
      "      mutationLevel: read",
      "      semanticCapabilityId: github.search"
    ].join("\n")
  );

  writeUtf8(
    root,
    "servers/docker-read.yaml",
    [
      "server:",
      "  id: docker-read",
      "  displayName: Docker Read",
      "  source: peer",
      "  kind: peer",
      "  trustClass: ops-read",
      "  mutationLevel: read",
      "  tools:",
      "    - toolId: docker.inspect",
      "      displayName: Inspect Docker Runtime",
      "      category: docker-read",
      "      trustClass: ops-read",
      "      mutationLevel: read",
      "      semanticCapabilityId: docker.inspect"
    ].join("\n")
  );

  writeUtf8(
    root,
    "profiles/bootstrap.yaml",
    [
      "profile:",
      "  id: bootstrap",
      "  displayName: Bootstrap",
      "  sessionMode: toolbox-bootstrap",
      "  includeServers:",
      "    - mimir-control",
      "    - mimir-core",
      "  allowedCategories:",
      "    - repo-read",
      "  deniedCategories:",
      "    - docker-write"
    ].join("\n")
  );

  writeUtf8(
    root,
    "profiles/core-dev.yaml",
    [
      "profile:",
      "  id: core-dev",
      "  displayName: Core Dev",
      "  sessionMode: toolbox-activated",
      "  includeServers:",
      "    - mimir-control",
      "    - mimir-core",
      "  allowedCategories:",
      "    - repo-read",
      "    - repo-write",
      "  deniedCategories:",
      "    - docker-write"
    ].join("\n")
  );

  writeUtf8(
    root,
    "profiles/docs-research.yaml",
    [
      "profile:",
      "  id: docs-research",
      "  displayName: Docs Research",
      "  sessionMode: toolbox-activated",
      "  includeServers:",
      "    - mimir-control",
      "    - mimir-core",
      "    - github-read",
      "  allowedCategories:",
      "    - repo-read",
      "    - docs-search",
      "  deniedCategories:",
      "    - docker-write"
    ].join("\n")
  );

  writeUtf8(
    root,
    "profiles/core-dev+docs-research.yaml",
    [
      "profile:",
      "  id: core-dev+docs-research",
      "  displayName: Core Dev Plus Docs",
      "  sessionMode: toolbox-activated",
      "  baseProfiles:",
      "    - core-dev",
      "    - docs-research",
      "  compositeReason: repeated_workflow",
      "  includeServers:",
      "    - mimir-control",
      "    - mimir-core",
      "    - github-read",
      "  allowedCategories:",
      "    - repo-read",
      "    - repo-write",
      "    - docs-search",
      "  deniedCategories:",
      "    - docker-write"
    ].join("\n")
  );

  writeUtf8(
    root,
    "intents.yaml",
    [
      "intents:",
      "  docs-research:",
      "    displayName: Docs Research",
      "    targetProfile: docs-research",
      "    trustClass: external-read",
      "    requiresApproval: false",
      "    activationMode: session-switch",
      "    allowedCategories:",
      "      - repo-read",
      "      - docs-search",
      "    deniedCategories:",
      "      - docker-write",
      "    fallbackProfile: core-dev"
    ].join("\n")
  );

  writeUtf8(
    root,
    "clients/codex.yaml",
    [
      "client:",
      "  id: codex",
      "  displayName: Codex",
      "  handoffStrategy: env-reconnect",
      "  handoffPresetRef: codex.toolbox",
      "  suppressSemanticCapabilities:",
      "    - github.search"
    ].join("\n")
  );
}

test("compileToolboxPolicyFromDirectory returns deterministic normalized IR", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);

    const first = compileToolboxPolicyFromDirectory(root);
    const second = compileToolboxPolicyFromDirectory(root);

    assert.equal(first.manifestRevision, second.manifestRevision);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.profiles.bootstrap.sessionMode, "toolbox-bootstrap");
    assert.equal(first.profiles["core-dev+docs-research"].composite, true);
    assert.equal(first.clients.codex.suppressedSemanticCapabilities[0], "github.search");
    assert.equal(first.clients.codex.handoffStrategy, "env-reconnect");
    assert.equal(first.clients.codex.handoffPresetRef, "codex.toolbox");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compileToolboxPolicyFromDirectory rejects duplicate semantic capabilities inside one profile", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
    writeUtf8(
      root,
      "servers/github-read-duplicate.yaml",
      [
        "server:",
        "  id: github-read-duplicate",
        "  displayName: GitHub Read Duplicate",
        "  source: peer",
        "  kind: peer",
        "  trustClass: external-read",
        "  mutationLevel: read",
        "  tools:",
        "    - toolId: github.search.alt",
        "      displayName: Search GitHub Alt",
        "      category: docs-search",
        "      trustClass: external-read",
        "      mutationLevel: read",
        "      semanticCapabilityId: github.search"
      ].join("\n")
    );
    writeUtf8(
      root,
      "profiles/docs-research.yaml",
      [
        "profile:",
        "  id: docs-research",
        "  displayName: Docs Research",
        "  sessionMode: toolbox-activated",
        "  includeServers:",
        "    - mimir-control",
        "    - mimir-core",
        "    - github-read",
        "    - github-read-duplicate",
        "  allowedCategories:",
        "    - repo-read",
        "    - docs-search",
        "  deniedCategories:",
        "    - docker-write"
      ].join("\n")
    );

    assert.throws(
      () => compileToolboxPolicyFromDirectory(root),
      /duplicate semantic capability/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compileToolboxPolicyFromDirectory rejects overlays that widen trust boundaries", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
    writeUtf8(
      root,
      "clients/codex.yaml",
      [
        "client:",
        "  id: codex",
        "  displayName: Codex",
        "  additionalServerIds:",
        "    - docker-read"
      ].join("\n")
    );

    assert.throws(
      () => compileToolboxPolicyFromDirectory(root),
      /cannot widen trust boundaries/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compileToolboxPolicyFromDirectory rejects composites without an explicit repeated workflow reason", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
    writeUtf8(
      root,
      "profiles/core-dev+docs-research.yaml",
      [
        "profile:",
        "  id: core-dev+docs-research",
        "  displayName: Core Dev Plus Docs",
        "  sessionMode: toolbox-activated",
        "  baseProfiles:",
        "    - core-dev",
        "    - docs-research",
        "  includeServers:",
        "    - mimir-control",
        "    - mimir-core",
        "    - github-read",
        "  allowedCategories:",
        "    - repo-read",
        "    - repo-write",
        "    - docs-search",
        "  deniedCategories:",
        "    - docker-write"
      ].join("\n")
    );

    assert.throws(
      () => compileToolboxPolicyFromDirectory(root),
      /composite profiles require an explicit repeated workflow reason/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compileToolboxPolicyFromDirectory rejects unknown fallback profiles", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
    writeUtf8(
      root,
      "profiles/docs-research.yaml",
      [
        "profile:",
        "  id: docs-research",
        "  displayName: Docs Research",
        "  sessionMode: toolbox-activated",
        "  includeServers:",
        "    - mimir-control",
        "    - mimir-core",
        "    - github-read",
        "  allowedCategories:",
        "    - repo-read",
        "    - docs-search",
        "  deniedCategories:",
        "    - docker-write",
        "  fallbackProfile: missing-profile"
      ].join("\n")
    );

    assert.throws(
      () => compileToolboxPolicyFromDirectory(root),
      /unknown fallback profile/i
    );

    seedBaseFixture(root);
    writeUtf8(
      root,
      "intents.yaml",
      [
        "intents:",
        "  docs-research:",
        "    displayName: Docs Research",
        "    targetProfile: docs-research",
        "    trustClass: external-read",
        "    requiresApproval: false",
        "    activationMode: session-switch",
        "    allowedCategories:",
        "      - repo-read",
        "      - docs-search",
        "    deniedCategories:",
        "      - docker-write",
        "    fallbackProfile: missing-profile"
      ].join("\n")
    );

    assert.throws(
      () => compileToolboxPolicyFromDirectory(root),
      /unknown fallback profile/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime-observe profile exposes kubernetes-read server with k8s categories and read-only tools", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.profiles["runtime-observe"].includeServers.includes("kubernetes-read"),
    "runtime-observe profile must include kubernetes-read server"
  );

  const allowed = compiled.profiles["runtime-observe"].allowedCategories;
  assert.ok(allowed.includes("k8s-read"), "runtime-observe must allow k8s-read");
  assert.ok(allowed.includes("k8s-logs-read"), "runtime-observe must allow k8s-logs-read");
  assert.ok(allowed.includes("k8s-events-read"), "runtime-observe must allow k8s-events-read");

  const toolIds = compiled.profiles["runtime-observe"].tools.map((t) => t.toolId);
  assert.ok(toolIds.includes("kubernetes.context.inspect"), "runtime-observe must expose kubernetes.context.inspect");
  assert.ok(toolIds.includes("kubernetes.events.list"), "runtime-observe must expose kubernetes.events.list");
  assert.ok(toolIds.includes("kubernetes.logs.query"), "runtime-observe must expose kubernetes.logs.query");

  const k8sTools = compiled.profiles["runtime-observe"].tools.filter((t) =>
    t.toolId.startsWith("kubernetes.")
  );
  for (const tool of k8sTools) {
    assert.equal(tool.mutationLevel, "read", `kubernetes tool ${tool.toolId} must be read-only`);
  }
});

test("core-dev+runtime-observe profile exposes kubernetes-read server inherited from runtime-observe", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.profiles["core-dev+runtime-observe"].includeServers.includes("kubernetes-read"),
    "core-dev+runtime-observe profile must include kubernetes-read server"
  );
  assert.ok(
    compiled.profiles["core-dev+runtime-observe"].tools.some(
      (t) => t.toolId === "kubernetes.context.inspect"
    ),
    "core-dev+runtime-observe must expose kubernetes.context.inspect"
  );
  assert.ok(
    compiled.profiles["core-dev+runtime-observe"].tools.some(
      (t) => t.toolId === "kubernetes.logs.query"
    ),
    "core-dev+runtime-observe must expose kubernetes.logs.query"
  );
});

test("runtime-admin profile exposes kubernetes-read server as read-only peer beside docker peers", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.profiles["runtime-admin"].includeServers.includes("kubernetes-read"),
    "runtime-admin profile must include kubernetes-read server"
  );
  assert.ok(
    compiled.profiles["runtime-admin"].allowedCategories.includes("k8s-read"),
    "runtime-admin must allow k8s-read category"
  );
  assert.ok(
    compiled.profiles["runtime-admin"].tools.some((t) => t.toolId === "kubernetes.events.list"),
    "runtime-admin must expose kubernetes.events.list"
  );
  assert.ok(
    compiled.profiles["runtime-admin"].tools.some((t) => t.toolId === "kubernetes.logs.query"),
    "runtime-admin must expose kubernetes.logs.query"
  );
  // Also retains existing docker peers
  assert.ok(
    compiled.profiles["runtime-admin"].includeServers.includes("docker-admin"),
    "runtime-admin must still include docker-admin"
  );
});

test("full profile exposes kubernetes-read server with k8s categories", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.profiles["full"].includeServers.includes("kubernetes-read"),
    "full profile must include kubernetes-read server"
  );
  assert.ok(
    compiled.profiles["full"].allowedCategories.includes("k8s-read"),
    "full profile must allow k8s-read category"
  );
  assert.ok(
    compiled.profiles["full"].tools.some((t) => t.toolId === "kubernetes.context.inspect"),
    "full profile must expose kubernetes.context.inspect"
  );
});

test("runtime-observe, runtime-admin, and full intents include k8s categories in allowedCategories", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  for (const intentId of ["runtime-observe", "runtime-admin", "full"]) {
    const allowed = compiled.intents[intentId].allowedCategories;
    assert.ok(allowed.includes("k8s-read"), `${intentId} intent must allow k8s-read`);
    assert.ok(allowed.includes("k8s-logs-read"), `${intentId} intent must allow k8s-logs-read`);
    assert.ok(allowed.includes("k8s-events-read"), `${intentId} intent must allow k8s-events-read`);
  }
});

test("checked-in docker/mcp manifests compile into the bootstrap and activated profile graph", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.equal(compiled.profiles.bootstrap.sessionMode, "toolbox-bootstrap");
  assert.equal(compiled.profiles["docs-research"].sessionMode, "toolbox-activated");
  assert.equal(compiled.profiles["core-dev+docs-research"].composite, true);
  assert.ok(compiled.clients.codex);
  assert.ok(compiled.clients.claude);
  assert.ok(compiled.clients.antigravity);
  assert.equal(compiled.clients.codex.handoffStrategy, "env-reconnect");
  assert.equal(compiled.clients.claude.handoffStrategy, "env-reconnect");
  assert.equal(compiled.clients.antigravity.handoffStrategy, "manual-env-reconnect");

  assert.ok(compiled.categories["k8s-read"], "k8s-read category must exist");
  assert.ok(compiled.categories["k8s-logs-read"], "k8s-logs-read category must exist");
  assert.ok(compiled.categories["k8s-events-read"], "k8s-events-read category must exist");
  assert.ok(compiled.servers["kubernetes-read"], "kubernetes-read server must exist");
  assert.ok(
    compiled.servers["kubernetes-read"].tools.some((t) => t.toolId === "kubernetes.logs.query"),
    "kubernetes-read server must contain toolId kubernetes.logs.query"
  );

  assert.ok(
    compiled.categories["container-registry-read"],
    "container-registry-read category must exist"
  );
  assert.ok(compiled.servers["dockerhub-read"], "dockerhub-read server must exist");
});

test("container-registry-read category has external-read trust class and read mutation level", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.categories["container-registry-read"],
    "container-registry-read category must exist"
  );
  assert.equal(
    compiled.categories["container-registry-read"].trustClass,
    "external-read",
    "container-registry-read category must have trustClass external-read"
  );
  assert.equal(
    compiled.categories["container-registry-read"].mutationLevel,
    "read",
    "container-registry-read category must have mutationLevel read"
  );
});

test("dockerhub-read server exists as external-read peer with read-only container registry tools", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(compiled.servers["dockerhub-read"], "dockerhub-read server must exist");

  const server = compiled.servers["dockerhub-read"];
  assert.equal(server.trustClass, "external-read", "dockerhub-read server must have trustClass external-read");
  assert.equal(server.mutationLevel, "read", "dockerhub-read server must have mutationLevel read");
  assert.ok(server.tools.length > 0, "dockerhub-read server must have at least one tool");

  for (const tool of server.tools) {
    assert.equal(
      tool.mutationLevel,
      "read",
      `dockerhub-read tool ${tool.toolId} must be read-only`
    );
    assert.ok(
      tool.semanticCapabilityId.startsWith("container.registry."),
      `dockerhub-read tool ${tool.toolId} semanticCapabilityId must be under container.registry.* namespace`
    );
  }

  const toolIds = server.tools.map((t) => t.toolId);
  assert.ok(
    toolIds.includes("dockerhub.image.search"),
    "dockerhub-read server must include dockerhub.image.search tool"
  );
  assert.ok(
    toolIds.includes("dockerhub.image.tags.list"),
    "dockerhub-read server must include dockerhub.image.tags.list tool"
  );
  assert.ok(
    toolIds.includes("dockerhub.image.inspect"),
    "dockerhub-read server must include dockerhub.image.inspect tool"
  );
});

test("docs-research profile includes dockerhub-read server and allows container-registry-read", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.profiles["docs-research"].includeServers.includes("dockerhub-read"),
    "docs-research profile must include dockerhub-read server"
  );
  assert.ok(
    compiled.profiles["docs-research"].allowedCategories.includes("container-registry-read"),
    "docs-research profile must allow container-registry-read category"
  );
  assert.ok(
    compiled.profiles["docs-research"].tools.some((t) => t.toolId === "dockerhub.image.search"),
    "docs-research profile must expose dockerhub.image.search"
  );
});

test("full profile includes dockerhub-read server and allows container-registry-read", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.profiles["full"].includeServers.includes("dockerhub-read"),
    "full profile must include dockerhub-read server"
  );
  assert.ok(
    compiled.profiles["full"].allowedCategories.includes("container-registry-read"),
    "full profile must allow container-registry-read category"
  );
  assert.ok(
    compiled.profiles["full"].tools.some((t) => t.toolId === "dockerhub.image.search"),
    "full profile must expose dockerhub.image.search"
  );
});

test("core-dev+docs-research inherits dockerhub-read from docs-research base profile", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.profiles["core-dev+docs-research"].includeServers.includes("dockerhub-read"),
    "core-dev+docs-research profile must include dockerhub-read server inherited from docs-research"
  );
  assert.ok(
    compiled.profiles["core-dev+docs-research"].tools.some(
      (t) => t.toolId === "dockerhub.image.search"
    ),
    "core-dev+docs-research must expose dockerhub.image.search via docs-research inheritance"
  );
  assert.ok(
    compiled.profiles["core-dev+docs-research"].allowedCategories.includes("container-registry-read"),
    "core-dev+docs-research must allow container-registry-read via docs-research inheritance"
  );
});

test("dockerhub-read is absent from bootstrap, core-dev, runtime-observe, runtime-admin, heavy-rag, and delivery-admin profiles", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  for (const profileId of [
    "bootstrap",
    "core-dev",
    "runtime-observe",
    "runtime-admin",
    "heavy-rag",
    "delivery-admin"
  ]) {
    assert.ok(
      !compiled.profiles[profileId].includeServers.includes("dockerhub-read"),
      `${profileId} profile must NOT include dockerhub-read server`
    );
    assert.ok(
      !compiled.profiles[profileId].allowedCategories.includes("container-registry-read"),
      `${profileId} profile must NOT allow container-registry-read category`
    );
  }
});

test("docs-research and full intents allow container-registry-read category", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  for (const intentId of ["docs-research", "full"]) {
    const allowed = compiled.intents[intentId].allowedCategories;
    assert.ok(
      allowed.includes("container-registry-read"),
      `${intentId} intent must allow container-registry-read`
    );
  }
});

test("container-registry-read is absent from runtime-observe, runtime-admin, core-dev, heavy-rag, and delivery-admin intents", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  for (const intentId of [
    "core-dev",
    "runtime-observe",
    "runtime-admin",
    "heavy-rag",
    "delivery-admin"
  ]) {
    const allowed = compiled.intents[intentId].allowedCategories;
    assert.ok(
      !allowed.includes("container-registry-read"),
      `${intentId} intent must NOT allow container-registry-read`
    );
  }
});
