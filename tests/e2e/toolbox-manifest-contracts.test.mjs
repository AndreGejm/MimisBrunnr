import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildDockerMcpRuntimeApplyPlan,
  compileDockerMcpRuntimePlan,
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
      "  dockerRuntime:",
      "    applyMode: catalog",
      "    catalogServerId: github-read",
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
      "  dockerRuntime:",
      "    applyMode: descriptor-only",
      "    blockedReason: Docker read fixture is descriptor-only",
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
      "    summary: External docs, web search, and GitHub read for implementation research.",
      "    exampleTasks:",
      "      - Compare upstream docs with the current implementation",
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
    assert.equal(
      first.intents["docs-research"].summary,
      "External docs, web search, and GitHub read for implementation research."
    );
    assert.deepEqual(first.intents["docs-research"].exampleTasks, [
      "Compare upstream docs with the current implementation"
    ]);
    assert.equal(first.clients.codex.suppressedSemanticCapabilities[0], "github.search");
    assert.equal(first.clients.codex.handoffStrategy, "env-reconnect");
    assert.equal(first.clients.codex.handoffPresetRef, "codex.toolbox");
    assert.deepEqual(first.servers["github-read"].runtimeBinding, {
      kind: "docker-catalog",
      catalogServerId: "github-read"
    });
    assert.deepEqual(first.servers["docker-read"].runtimeBinding, {
      kind: "descriptor-only",
      blockedReason: "Docker read fixture is descriptor-only"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compileToolboxPolicyFromDirectory accepts explicit runtimeBinding docker-catalog manifests", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
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
        "  runtimeBinding:",
        "    kind: docker-catalog",
        "    catalogServerId: github-read",
        "  tools:",
        "    - toolId: github.search",
        "      displayName: Search GitHub",
        "      category: docs-search",
        "      trustClass: external-read",
        "      mutationLevel: read",
        "      semanticCapabilityId: github.search"
      ].join("\n")
    );

    const compiled = compileToolboxPolicyFromDirectory(root);
    assert.deepEqual(compiled.servers["github-read"].runtimeBinding, {
      kind: "docker-catalog",
      catalogServerId: "github-read"
    });
    assert.deepEqual(compiled.servers["github-read"].dockerRuntime, {
      applyMode: "catalog",
      catalogServerId: "github-read"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compileToolboxPolicyFromDirectory accepts local-stdio peer runtime bindings", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
    writeUtf8(
      root,
      "servers/voltagent-docs.yaml",
      [
        "server:",
        "  id: voltagent-docs",
        "  displayName: VoltAgent Docs",
        "  source: peer",
        "  kind: peer",
        "  trustClass: external-read",
        "  mutationLevel: read",
        "  runtimeBinding:",
        "    kind: local-stdio",
        "    command: npx",
        "    args:",
        "      - -y",
        "      - '@voltagent/docs-mcp'",
        "    configTarget: codex-mcp-json",
        "  tools:",
        "    - toolId: voltagent.docs.search",
        "      displayName: Search VoltAgent Docs",
        "      category: docs-search",
        "      trustClass: external-read",
        "      mutationLevel: read",
        "      semanticCapabilityId: voltagent.docs.search"
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
        "    - voltagent-docs",
        "  allowedCategories:",
        "    - repo-read",
        "    - docs-search",
        "  deniedCategories:",
        "    - docker-write"
      ].join("\n")
    );

    const compiled = compileToolboxPolicyFromDirectory(root);
    const runtimeBinding = JSON.parse(
      JSON.stringify(compiled.servers["voltagent-docs"].runtimeBinding)
    );
    assert.deepEqual(runtimeBinding, {
      kind: "local-stdio",
      command: "npx",
      args: ["-y", "@voltagent/docs-mcp"],
      configTarget: "codex-mcp-json"
    });
    assert.equal(compiled.servers["voltagent-docs"].dockerRuntime, undefined);
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
        "  dockerRuntime:",
        "    applyMode: catalog",
        "    catalogServerId: github-read-duplicate",
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

test("compileToolboxPolicyFromDirectory rejects duplicate tool IDs inherited through composite base profiles", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
    writeUtf8(
      root,
      "servers/github-read-alt.yaml",
      [
        "server:",
        "  id: github-read-alt",
        "  displayName: GitHub Read Alt",
        "  source: peer",
        "  kind: peer",
        "  trustClass: external-read",
        "  mutationLevel: read",
        "  dockerRuntime:",
        "    applyMode: catalog",
        "    catalogServerId: github-read-alt",
        "  tools:",
        "    - toolId: github.search",
        "      displayName: Search GitHub Alt Collision",
        "      category: docs-search",
        "      trustClass: external-read",
        "      mutationLevel: read",
        "      semanticCapabilityId: github.search.alt"
      ].join("\n")
    );
    writeUtf8(
      root,
      "profiles/docs-research-alt.yaml",
      [
        "profile:",
        "  id: docs-research-alt",
        "  displayName: Docs Research Alt",
        "  sessionMode: toolbox-activated",
        "  includeServers:",
        "    - mimir-control",
        "    - mimir-core",
        "    - github-read-alt",
        "  allowedCategories:",
        "    - repo-read",
        "    - docs-search",
        "  deniedCategories:",
        "    - docker-write"
      ].join("\n")
    );
    writeUtf8(
      root,
      "profiles/docs-research+alt.yaml",
      [
        "profile:",
        "  id: docs-research+alt",
        "  displayName: Docs Research Plus Alt",
        "  sessionMode: toolbox-activated",
        "  baseProfiles:",
        "    - docs-research",
        "    - docs-research-alt",
        "  compositeReason: repeated_workflow",
        "  includeServers:",
        "    - mimir-control",
        "    - mimir-core",
        "  allowedCategories:",
        "    - repo-read",
        "    - docs-search",
        "  deniedCategories:",
        "    - docker-write"
      ].join("\n")
    );

    assert.throws(
      () => compileToolboxPolicyFromDirectory(root),
      /Profile 'docs-research\+alt'.*duplicate toolId 'github\.search'/i
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
        "    summary: External docs, web search, and GitHub read for implementation research.",
        "    exampleTasks:",
        "      - Compare upstream docs with the current implementation",
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

test("compileToolboxPolicyFromDirectory rejects peer servers without dockerRuntime apply metadata", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
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

    assert.throws(
      () => compileToolboxPolicyFromDirectory(root),
      /must declare runtimeBinding or dockerRuntime apply metadata/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compileToolboxPolicyFromDirectory rejects peer servers with kind control", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
    writeUtf8(
      root,
      "servers/github-read.yaml",
      [
        "server:",
        "  id: github-read",
        "  displayName: GitHub Read",
        "  source: peer",
        "  kind: control",
        "  trustClass: external-read",
        "  mutationLevel: read",
        "  dockerRuntime:",
        "    applyMode: catalog",
        "    catalogServerId: github-read",
        "  tools:",
        "    - toolId: github.search",
        "      displayName: Search GitHub",
        "      category: docs-search",
        "      trustClass: external-read",
        "      mutationLevel: read",
        "      semanticCapabilityId: github.search"
      ].join("\n")
    );

    assert.throws(
      () => compileToolboxPolicyFromDirectory(root),
      /source: peer.*kind: peer|kind: control.*source: peer/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compileToolboxPolicyFromDirectory rejects owned servers with kind peer", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
    writeUtf8(
      root,
      "servers/mimir-control.yaml",
      [
        "server:",
        "  id: mimir-control",
        "  displayName: Mimir Control",
        "  source: owned",
        "  kind: peer",
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

    assert.throws(
      () => compileToolboxPolicyFromDirectory(root),
      /source: owned.*kind: peer|kind: peer.*source: owned/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compileToolboxPolicyFromDirectory rejects unsafeCatalogServerIds on catalog-mode servers", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
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
        "  dockerRuntime:",
        "    applyMode: catalog",
        "    catalogServerId: github",
        "    unsafeCatalogServerIds:",
        "      - github",
        "  tools:",
        "    - toolId: github.search",
        "      displayName: Search GitHub",
        "      category: docs-search",
        "      trustClass: external-read",
        "      mutationLevel: read",
        "      semanticCapabilityId: github.search"
      ].join("\n")
    );

    assert.throws(
      () => compileToolboxPolicyFromDirectory(root),
      /unsafeCatalogServerIds is only valid for descriptor-only mode/i
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compileToolboxPolicyFromDirectory preserves descriptor-only unsafeCatalogServerIds", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
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
        "  dockerRuntime:",
        "    applyMode: descriptor-only",
        "    blockedReason: live catalog server exposes write tools",
        "    unsafeCatalogServerIds:",
        "      - github",
        "  tools:",
        "    - toolId: github.search",
        "      displayName: Search GitHub",
        "      category: docs-search",
        "      trustClass: external-read",
        "      mutationLevel: read",
        "      semanticCapabilityId: github.search"
      ].join("\n")
    );

    const compiled = compileToolboxPolicyFromDirectory(root);

    assert.deepEqual(
      compiled.servers["github-read"].dockerRuntime?.unsafeCatalogServerIds,
      ["github"]
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
  assert.equal(compiled.profiles["core-dev+runtime-observe"].composite, true);
  assert.ok(compiled.intents["core-dev+docs-research"]);
  assert.ok(compiled.intents["core-dev+runtime-observe"]);
  assert.equal(
    compiled.intents["docs-research"].summary,
    "External docs, web search, and GitHub read for implementation research."
  );
  assert.ok(
    compiled.intents["docs-research"].exampleTasks.includes(
      "Compare upstream docs with the current implementation"
    )
  );
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

test("repo-knowledge-read category has external-read trust class and read mutation level", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.categories["repo-knowledge-read"],
    "repo-knowledge-read category must exist"
  );
  assert.equal(
    compiled.categories["repo-knowledge-read"].trustClass,
    "external-read",
    "repo-knowledge-read category must have trustClass external-read"
  );
  assert.equal(
    compiled.categories["repo-knowledge-read"].mutationLevel,
    "read",
    "repo-knowledge-read category must have mutationLevel read"
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
      tool.category,
      "container-registry-read",
      `dockerhub-read tool ${tool.toolId} must use container-registry-read`
    );
    assert.equal(
      tool.trustClass,
      "external-read",
      `dockerhub-read tool ${tool.toolId} must be external-read`
    );
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

test("deepwiki-read server exists as external-read peer with catalog mode and read-only repo knowledge tools", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(compiled.servers["deepwiki-read"], "deepwiki-read server must exist");

  const server = compiled.servers["deepwiki-read"];
  assert.equal(server.trustClass, "external-read", "deepwiki-read server must have trustClass external-read");
  assert.equal(server.mutationLevel, "read", "deepwiki-read server must have mutationLevel read");
  assert.equal(server.dockerRuntime?.applyMode, "catalog", "deepwiki-read must declare dockerRuntime catalog mode");
  assert.equal(server.dockerRuntime?.catalogServerId, "deepwiki", "deepwiki-read must map to catalogServerId deepwiki");

  const toolIds = server.tools.map((t) => t.toolId);
  for (const requiredToolId of ["read_wiki_structure", "read_wiki_contents", "ask_question"]) {
    assert.ok(
      toolIds.includes(requiredToolId),
      `deepwiki-read server must include ${requiredToolId}`
    );
  }

  for (const tool of server.tools) {
    assert.equal(tool.category, "repo-knowledge-read", `${tool.toolId} must use repo-knowledge-read`);
    assert.equal(tool.trustClass, "external-read", `${tool.toolId} must be external-read`);
    assert.equal(tool.mutationLevel, "read", `${tool.toolId} must be read-only`);
    assert.ok(
      tool.semanticCapabilityId.startsWith("repo.knowledge."),
      `${tool.toolId} semanticCapabilityId must be under repo.knowledge.*`
    );
  }
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

test("docs-research profile includes deepwiki-read server and allows repo-knowledge-read", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.profiles["docs-research"].includeServers.includes("deepwiki-read"),
    "docs-research profile must include deepwiki-read server"
  );
  assert.ok(
    compiled.profiles["docs-research"].allowedCategories.includes("repo-knowledge-read"),
    "docs-research profile must allow repo-knowledge-read category"
  );
  assert.ok(
    compiled.profiles["docs-research"].tools.some((t) => t.toolId === "read_wiki_structure"),
    "docs-research profile must expose read_wiki_structure"
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

test("full profile includes deepwiki-read server and allows repo-knowledge-read", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.profiles["full"].includeServers.includes("deepwiki-read"),
    "full profile must include deepwiki-read server"
  );
  assert.ok(
    compiled.profiles["full"].allowedCategories.includes("repo-knowledge-read"),
    "full profile must allow repo-knowledge-read category"
  );
  assert.ok(
    compiled.profiles["full"].tools.some((t) => t.semanticCapabilityId.startsWith("repo.knowledge.")),
    "full profile must expose at least one repo.knowledge.* tool"
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

test("core-dev+docs-research inherits deepwiki-read from docs-research base profile", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.profiles["core-dev+docs-research"].includeServers.includes("deepwiki-read"),
    "core-dev+docs-research profile must include deepwiki-read server inherited from docs-research"
  );
  assert.ok(
    compiled.profiles["core-dev+docs-research"].allowedCategories.includes("repo-knowledge-read"),
    "core-dev+docs-research must allow repo-knowledge-read via docs-research inheritance"
  );
  assert.ok(
    compiled.profiles["core-dev+docs-research"].tools.some((t) => t.toolId === "ask_question"),
    "core-dev+docs-research must expose ask_question"
  );
});

test("dockerhub-read and deepwiki-read are absent from non-research profiles", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  for (const profileId of [
    "bootstrap",
    "core-dev",
    "runtime-observe",
    "runtime-admin",
    "heavy-rag",
    "delivery-admin",
    "security-audit",
    "core-dev+security-audit"
  ]) {
    assert.ok(
      !compiled.profiles[profileId].includeServers.includes("dockerhub-read"),
      `${profileId} profile must NOT include dockerhub-read server`
    );
    assert.ok(
      !compiled.profiles[profileId].includeServers.includes("deepwiki-read"),
      `${profileId} profile must NOT include deepwiki-read server`
    );
    assert.ok(
      !compiled.profiles[profileId].allowedCategories.includes("container-registry-read"),
      `${profileId} profile must NOT allow container-registry-read category`
    );
    assert.ok(
      !compiled.profiles[profileId].allowedCategories.includes("repo-knowledge-read"),
      `${profileId} profile must NOT allow repo-knowledge-read category`
    );
  }
});

test("docs-research and full intents allow container-registry-read and repo-knowledge-read categories", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  for (const intentId of ["docs-research", "full"]) {
    const allowed = compiled.intents[intentId].allowedCategories;
    assert.ok(
      allowed.includes("container-registry-read"),
      `${intentId} intent must allow container-registry-read`
    );
    assert.ok(
      allowed.includes("repo-knowledge-read"),
      `${intentId} intent must allow repo-knowledge-read`
    );
  }
});

test("container-registry-read and repo-knowledge-read are absent from non-research intents", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  for (const intentId of [
    "core-dev",
    "runtime-observe",
    "runtime-admin",
    "heavy-rag",
    "delivery-admin",
    "security-audit"
  ]) {
    const allowed = compiled.intents[intentId].allowedCategories;
    assert.ok(
      !allowed.includes("container-registry-read"),
      `${intentId} intent must NOT allow container-registry-read`
    );
    assert.ok(
      !allowed.includes("repo-knowledge-read"),
      `${intentId} intent must NOT allow repo-knowledge-read`
    );
  }
});

test("checked-in peer server manifests declare runtime metadata", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  for (const server of Object.values(compiled.servers).filter((entry) => entry.source === "peer")) {
    assert.ok(
      server.dockerRuntime || server.runtimeBinding,
      `peer server ${server.id} must declare dockerRuntime or runtimeBinding metadata`
    );
  }
});

test("checked-in descriptor-only peer server manifests declare unsafe catalog server ids", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const expectedUnsafeIds = new Map([
    ["dockerhub-read", ["dockerhub"]],
    ["grafana-observe", ["grafana"]],
    ["docker-read", ["docker"]],
    ["docker-admin", ["docker"]],
    ["github-read", ["github"]],
    ["github-write", ["github"]],
    ["kubernetes-read", ["kubernetes"]]
  ]);

  for (const [serverId, unsafeCatalogServerIds] of expectedUnsafeIds) {
    const server = compiled.servers[serverId];
    assert.ok(server, `${serverId} server must exist`);
    assert.equal(server.dockerRuntime?.applyMode, "descriptor-only");
    assert.deepEqual(
      server.dockerRuntime?.unsafeCatalogServerIds,
      unsafeCatalogServerIds,
      `${serverId} must map unsafe live catalog server ids for governance drift diagnostics`
    );
  }
});

test("brave-search server manifest declares dockerRuntime catalog mode with catalogServerId brave", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  const server = compiled.servers["brave-search"];
  assert.ok(server, "brave-search server must exist");
  assert.equal(
    server.dockerRuntime?.applyMode,
    "catalog",
    "brave-search must declare dockerRuntime.applyMode: catalog in its server manifest"
  );
  assert.equal(
    server.dockerRuntime?.catalogServerId,
    "brave",
    "brave-search must declare dockerRuntime.catalogServerId: brave (the live Docker catalog server name)"
  );
});

test("dockerhub-read server manifest declares dockerRuntime descriptor-only with blockedReason", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  const server = compiled.servers["dockerhub-read"];
  assert.ok(server, "dockerhub-read server must exist");
  assert.equal(
    server.dockerRuntime?.applyMode,
    "descriptor-only",
    "dockerhub-read must declare dockerRuntime.applyMode: descriptor-only (live dockerhub catalog server exposes mutation tools)"
  );
  assert.ok(
    typeof server.dockerRuntime?.blockedReason === "string" && server.dockerRuntime.blockedReason.length > 0,
    "dockerhub-read must declare a non-empty dockerRuntime.blockedReason"
  );
  assert.equal(
    server.dockerRuntime?.catalogServerId,
    undefined,
    "dockerhub-read must not declare a catalogServerId - descriptor-only servers have no safe catalog target"
  );
});

test("grafana-observe server manifest declares dockerRuntime descriptor-only with blockedReason and read-only observe tools", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  const server = compiled.servers["grafana-observe"];
  assert.ok(server, "grafana-observe server must exist");
  assert.equal(server.trustClass, "ops-read", "grafana-observe server must have trustClass ops-read");
  assert.equal(server.mutationLevel, "read", "grafana-observe server must have mutationLevel read");
  assert.equal(
    server.dockerRuntime?.applyMode,
    "descriptor-only",
    "grafana-observe must declare dockerRuntime.applyMode: descriptor-only (live grafana catalog surface currently includes mutating/destructive tools)"
  );
  assert.ok(
    typeof server.dockerRuntime?.blockedReason === "string" && server.dockerRuntime.blockedReason.length > 0,
    "grafana-observe must declare a non-empty dockerRuntime.blockedReason"
  );
  assert.equal(
    server.dockerRuntime?.catalogServerId,
    undefined,
    "grafana-observe must not declare a catalogServerId - descriptor-only servers have no safe catalog target"
  );

  const expectedTools = new Map([
    ["grafana.logs.query", { category: "logs-read", semanticCapabilityId: "observe.logs.query" }],
    ["grafana.metrics.query", { category: "metrics-read", semanticCapabilityId: "observe.metrics.query" }],
    ["grafana.traces.query", { category: "traces-read", semanticCapabilityId: "observe.traces.query" }]
  ]);
  assert.equal(server.tools.length, expectedTools.size, "grafana-observe must expose only the curated read-only descriptor tools");

  for (const tool of server.tools) {
    const expected = expectedTools.get(tool.toolId);
    assert.ok(expected, `unexpected grafana-observe tool '${tool.toolId}' in descriptor manifest`);
    assert.equal(tool.category, expected.category, `${tool.toolId} category must remain read-only`);
    assert.equal(tool.trustClass, "ops-read", `${tool.toolId} trustClass must remain ops-read`);
    assert.equal(tool.mutationLevel, "read", `${tool.toolId} mutationLevel must remain read`);
    assert.equal(tool.semanticCapabilityId, expected.semanticCapabilityId, `${tool.toolId} semantic capability must remain stable`);
  }
});

test("runtime-observe profile keeps grafana-observe as descriptor-only read-only peer for intent/tool discovery", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  const profile = compiled.profiles["runtime-observe"];
  assert.ok(profile.includeServers.includes("grafana-observe"), "runtime-observe must continue including grafana-observe in profile descriptors");
  for (const category of ["logs-read", "metrics-read", "traces-read"]) {
    assert.ok(
      profile.allowedCategories.includes(category),
      `runtime-observe must allow ${category} for grafana-observe descriptor tools`
    );
  }

  const expectedTools = new Set([
    "grafana.logs.query",
    "grafana.metrics.query",
    "grafana.traces.query"
  ]);
  const profileGrafanaTools = profile.tools.filter((tool) => tool.toolId.startsWith("grafana."));
  assert.equal(
    profileGrafanaTools.length,
    expectedTools.size,
    "runtime-observe must expose exactly the curated read-only grafana descriptor tools"
  );
  for (const tool of profileGrafanaTools) {
    assert.ok(expectedTools.has(tool.toolId), `unexpected runtime-observe grafana tool '${tool.toolId}'`);
    assert.equal(tool.trustClass, "ops-read", `${tool.toolId} must remain ops-read`);
    assert.equal(tool.mutationLevel, "read", `${tool.toolId} must remain read-only`);
  }
});

test("security-scan-read category has external-read trust class and read mutation level", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.categories["security-scan-read"],
    "security-scan-read category must exist"
  );
  assert.equal(
    compiled.categories["security-scan-read"].trustClass,
    "external-read",
    "security-scan-read category must have trustClass external-read"
  );
  assert.equal(
    compiled.categories["security-scan-read"].mutationLevel,
    "read",
    "security-scan-read category must have mutationLevel read"
  );
});

test("semgrep-audit server exists as external-read peer with catalog mode and read-only security tools", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(compiled.servers["semgrep-audit"], "semgrep-audit server must exist");

  const server = compiled.servers["semgrep-audit"];
  assert.equal(server.trustClass, "external-read", "semgrep-audit server must have trustClass external-read");
  assert.equal(server.mutationLevel, "read", "semgrep-audit server must have mutationLevel read");
  assert.equal(
    server.dockerRuntime?.applyMode,
    "catalog",
    "semgrep-audit must declare dockerRuntime.applyMode: catalog"
  );
  assert.equal(
    server.dockerRuntime?.catalogServerId,
    "semgrep",
    "semgrep-audit must declare dockerRuntime.catalogServerId: semgrep"
  );
  assert.ok(server.tools.length > 0, "semgrep-audit server must have at least one tool");

  for (const tool of server.tools) {
    assert.equal(
      tool.category,
      "security-scan-read",
      `semgrep-audit tool ${tool.toolId} must use security-scan-read`
    );
    assert.equal(
      tool.trustClass,
      "external-read",
      `semgrep-audit tool ${tool.toolId} must be external-read`
    );
    assert.equal(
      tool.mutationLevel,
      "read",
      `semgrep-audit tool ${tool.toolId} must be read-only`
    );
    assert.ok(
      tool.semanticCapabilityId.startsWith("security.semgrep."),
      `semgrep-audit tool ${tool.toolId} semanticCapabilityId must be under security.semgrep.* namespace`
    );
  }
});

test("security-audit profile includes semgrep-audit server and allows security-scan-read", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(compiled.profiles["security-audit"], "security-audit profile must exist");

  const profile = compiled.profiles["security-audit"];
  assert.ok(
    profile.includeServers.includes("mimir-control"),
    "security-audit profile must include mimir-control server"
  );
  assert.ok(
    profile.includeServers.includes("mimir-core"),
    "security-audit profile must include mimir-core server"
  );
  assert.ok(
    profile.includeServers.includes("semgrep-audit"),
    "security-audit profile must include semgrep-audit server"
  );
  assert.ok(
    profile.allowedCategories.includes("security-scan-read"),
    "security-audit profile must allow security-scan-read category"
  );
  assert.ok(
    profile.allowedCategories.includes("repo-read"),
    "security-audit profile must allow repo-read category"
  );
  assert.ok(
    !profile.allowedCategories.includes("repo-write"),
    "security-audit profile must not allow repo-write category"
  );
  assert.ok(
    !profile.allowedCategories.includes("internal-memory-write"),
    "security-audit profile must not allow internal-memory-write category"
  );
  assert.ok(
    profile.deniedCategories.includes("github-write"),
    "security-audit profile must deny github-write category"
  );
  assert.ok(
    profile.deniedCategories.includes("docker-write"),
    "security-audit profile must deny docker-write category"
  );
  assert.ok(
    profile.deniedCategories.includes("deployment"),
    "security-audit profile must deny deployment category"
  );
  assert.equal(
    profile.fallbackProfile,
    "core-dev",
    "security-audit profile must have fallbackProfile core-dev"
  );
});

test("core-dev+security-audit composite profile includes semgrep-audit and allows security-scan-read", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.profiles["core-dev+security-audit"],
    "core-dev+security-audit composite profile must exist"
  );

  const profile = compiled.profiles["core-dev+security-audit"];
  assert.equal(profile.composite, true, "core-dev+security-audit must be a composite profile");
  assert.ok(
    profile.baseProfiles.includes("core-dev"),
    "core-dev+security-audit must list core-dev as a base profile"
  );
  assert.ok(
    profile.baseProfiles.includes("security-audit"),
    "core-dev+security-audit must list security-audit as a base profile"
  );
  assert.ok(
    profile.includeServers.includes("semgrep-audit"),
    "core-dev+security-audit must include semgrep-audit server"
  );
  assert.ok(
    profile.allowedCategories.includes("security-scan-read"),
    "core-dev+security-audit must allow security-scan-read category"
  );
  assert.ok(
    profile.deniedCategories.includes("docker-write"),
    "core-dev+security-audit must preserve core-dev denied category docker-write"
  );
});

test("full profile includes semgrep-audit server and allows security-scan-read", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(
    compiled.profiles["full"].includeServers.includes("semgrep-audit"),
    "full profile must include semgrep-audit server"
  );
  assert.ok(
    compiled.profiles["full"].allowedCategories.includes("security-scan-read"),
    "full profile must allow security-scan-read category"
  );
  assert.ok(
    compiled.profiles["full"].tools.some((t) => t.semanticCapabilityId.startsWith("security.semgrep.")),
    "full profile must expose at least one security.semgrep.* tool"
  );
});

test("security-audit intent targets security-audit profile with external-read trust and no approval", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  assert.ok(compiled.intents["security-audit"], "security-audit intent must exist");

  const intent = compiled.intents["security-audit"];
  assert.equal(
    intent.targetProfile,
    "security-audit",
    "security-audit intent must target security-audit profile"
  );
  assert.equal(
    intent.trustClass,
    "external-read",
    "security-audit intent must have trustClass external-read"
  );
  assert.equal(
    intent.requiresApproval,
    false,
    "security-audit intent must not require approval"
  );
  assert.ok(
    intent.allowedCategories.includes("security-scan-read"),
    "security-audit intent must allow security-scan-read"
  );
  assert.ok(
    intent.deniedCategories.includes("github-write"),
    "security-audit intent must deny github-write"
  );
  assert.ok(
    intent.deniedCategories.includes("docker-write"),
    "security-audit intent must deny docker-write"
  );
  assert.ok(
    intent.deniedCategories.includes("deployment"),
    "security-audit intent must deny deployment"
  );
});

test("security-scan-read is absent from docs-research, runtime-observe, runtime-admin, heavy-rag, and delivery-admin profiles and intents", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  for (const profileId of [
    "docs-research",
    "runtime-observe",
    "runtime-admin",
    "heavy-rag",
    "delivery-admin"
  ]) {
    assert.ok(
      !compiled.profiles[profileId].allowedCategories.includes("security-scan-read"),
      `${profileId} profile must NOT allow security-scan-read category`
    );
    assert.ok(
      !compiled.profiles[profileId].includeServers.includes("semgrep-audit"),
      `${profileId} profile must NOT include semgrep-audit server`
    );
  }

  for (const intentId of [
    "docs-research",
    "runtime-observe",
    "runtime-admin",
    "heavy-rag",
    "delivery-admin"
  ]) {
    if (!compiled.intents[intentId]) continue;
    assert.ok(
      !compiled.intents[intentId].allowedCategories.includes("security-scan-read"),
      `${intentId} intent must NOT allow security-scan-read`
    );
  }
});

test("compileDockerMcpRuntimePlan omits local-stdio peers from Docker apply blocking", () => {
  const root = createFixtureRoot();
  try {
    seedBaseFixture(root);
    writeUtf8(
      root,
      "servers/voltagent-docs.yaml",
      [
        "server:",
        "  id: voltagent-docs",
        "  displayName: VoltAgent Docs",
        "  source: peer",
        "  kind: peer",
        "  trustClass: external-read",
        "  mutationLevel: read",
        "  runtimeBinding:",
        "    kind: local-stdio",
        "    command: npx",
        "    args:",
        "      - -y",
        "      - \"@voltagent/docs-mcp\"",
        "    configTarget: codex-mcp-json",
        "  tools:",
        "    - toolId: search_voltagent_docs",
        "      displayName: Search VoltAgent Docs",
        "      category: docs-search",
        "      trustClass: external-read",
        "      mutationLevel: read",
        "      semanticCapabilityId: docs.voltagent.search"
      ].join("\n")
    );
    writeUtf8(
      root,
      "profiles/voltagent-dev.yaml",
      [
        "profile:",
        "  id: voltagent-dev",
        "  displayName: VoltAgent Dev",
        "  sessionMode: toolbox-activated",
        "  includeServers:",
        "    - mimir-control",
        "    - mimir-core",
        "    - github-read",
        "    - voltagent-docs",
        "  allowedCategories:",
        "    - repo-read",
        "    - docs-search",
        "  deniedCategories:",
        "    - docker-write"
      ].join("\n")
    );

    const compiled = compileToolboxPolicyFromDirectory(root);
    const plan = compileDockerMcpRuntimePlan(compiled, {
      generatedAt: "2026-04-23T12:00:00.000Z"
    });
    const applyPlan = buildDockerMcpRuntimeApplyPlan(plan);
    const voltagentCommand = applyPlan.commands.find(
      (command) => command.profileId === "voltagent-dev"
    );

    assert.ok(voltagentCommand, "voltagent-dev profile must compile into the Docker sync plan");
    assert.deepEqual(
      [...voltagentCommand.serverRefs].sort(),
      [
        "catalog://mcp/docker-mcp-catalog/github-read",
        "file://./docker/mcp/servers/mimir-control.yaml",
        "file://./docker/mcp/servers/mimir-core.yaml"
      ].sort(),
      "Docker sync must only emit owned and catalog-backed peers for mixed profiles"
    );
    assert.ok(
      !voltagentCommand.blockedServers?.some((server) => server.id === "voltagent-docs"),
      "local-stdio peers must not be treated as Docker sync blockers"
    );
    assert.ok(
      !applyPlan.blockedServers?.some((server) => server.id === "voltagent-docs"),
      "plan-level blocked servers must exclude client-materialized peers"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checked-in VoltAgent toolbox manifests declare local-stdio Codex materialization", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  const server = compiled.servers["voltagent-docs"];
  assert.ok(server, "voltagent-docs server must exist");
  assert.equal(server.source, "peer");
  assert.equal(server.kind, "peer");
  assert.equal(server.runtimeBinding?.kind, "local-stdio");
  assert.equal(server.runtimeBinding?.configTarget, "codex-mcp-json");
  assert.equal(server.runtimeBinding?.command, "npx");
  assert.deepEqual(server.runtimeBinding?.args, ["-y", "@voltagent/docs-mcp"]);

  const profile = compiled.profiles["core-dev+voltagent-docs"];
  assert.ok(profile, "core-dev+voltagent-docs profile must exist");
  assert.ok(profile.baseProfiles.includes("core-dev+docs-research"));
  assert.ok(profile.includeServers.includes("voltagent-docs"));
  assert.ok(profile.allowedCategories.includes("docs-search"));
  assert.ok(profile.allowedCategories.includes("repo-write"));
  assert.equal(profile.fallbackProfile, "core-dev+docs-research");

  const intent = compiled.intents["core-dev+voltagent-docs"];
  assert.ok(intent, "core-dev+voltagent-docs intent must exist");
  assert.equal(intent.targetProfile, "core-dev+voltagent-docs");
  assert.equal(intent.requiresApproval, false);
  assert.ok(intent.allowedCategories.includes("docs-search"));
  assert.ok(intent.allowedCategories.includes("repo-write"));
  assert.match(
    intent.summary,
    /optional development-only.*docs convenience/i,
    "VoltAgent toolbox intent must stay explicitly optional and docs-scoped"
  );
  assert.deepEqual(intent.exampleTasks, [
    "Check upstream VoltAgent docs while patching the current repository",
    "Confirm VoltAgent API behavior without routing Codex or Claude skills through Mimir"
  ]);
});

test("checked-in VoltAgent toolbox keeps the legacy profile id as a compatibility alias", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  const legacyProfile = compiled.profiles["core-dev+voltagent-dev"];
  assert.ok(legacyProfile, "core-dev+voltagent-dev legacy alias profile must exist");
  assert.equal(legacyProfile.fallbackProfile, "core-dev+docs-research");
  assert.ok(legacyProfile.includeServers.includes("voltagent-docs"));

  const legacyIntent = compiled.intents["core-dev+voltagent-dev"];
  assert.ok(legacyIntent, "core-dev+voltagent-dev legacy alias intent must exist");
  assert.equal(
    legacyIntent.targetProfile,
    "core-dev+voltagent-docs",
    "legacy alias requests should resolve onto the canonical profile id"
  );
  assert.match(legacyIntent.summary, /legacy alias/i);
});

test("checked-in VoltAgent toolbox manifests stay docs-only and exclude workspace skill surfaces", () => {
  const compiled = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));

  const toolIds = Object.values(compiled.servers).flatMap((server) =>
    server.tools.map((tool) => tool.toolId)
  );
  assert.ok(
    toolIds.every((toolId) => !toolId.startsWith("workspace_")),
    "Mimir toolbox manifests must not expose VoltAgent workspace skill tools"
  );

  const localStdioCommands = Object.values(compiled.servers)
    .filter((server) => server.runtimeBinding?.kind === "local-stdio")
    .map((server) =>
      [server.runtimeBinding?.command, ...(server.runtimeBinding?.args ?? [])].join(" ")
    );
  assert.ok(
    localStdioCommands.every((commandLine) => !commandLine.includes("@voltagent/skills")),
    "local-stdio peers must not mount VoltAgent workspace skills through Mimir manifests"
  );
});
