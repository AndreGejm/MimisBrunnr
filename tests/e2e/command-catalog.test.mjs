import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  CLI_RUNTIME_COMMAND_NAMES,
  RUNTIME_COMMAND_DEFINITIONS,
  RUNTIME_COMMAND_NAMES,
  RUNTIME_COMMAND_TOOLBOX_POLICIES,
  getRuntimeCommandDefinition,
  toCliCommandName,
  toRuntimeCommandName
} from "../../packages/contracts/dist/index.js";
import {
  TaskFamilyRouter,
  getCommandAuthorizationRoles
} from "../../packages/orchestration/dist/index.js";
import { getRuntimeHttpRouteDefinitions } from "../../apps/mimir-api/dist/server.js";
import { MCP_TOOL_DEFINITIONS } from "../../apps/mimir-mcp/dist/tool-definitions.js";
import {
  compileToolboxPolicyFromDirectory,
  dispatchRuntimeCommand,
  getSupportedRuntimeDispatchCommandNames,
  getSupportedTransportCommandNames
} from "../../packages/infrastructure/dist/index.js";
import {
  CLI_COMMAND_NAMES,
  SYSTEM_COMMAND_NAMES,
  getCliCommandSurfaceDefinitions
} from "../../apps/mimir-cli/dist/command-surface.js";
import { buildCommandSurfaceReport } from "../../scripts/lib/command-surface-report.mjs";

const expectedCommands = [
  ["execute_coding_task", "execute-coding-task", "coding", "coding", "operator"],
  ["list_agent_traces", "list-agent-traces", "coding", "coding", "operator"],
  ["show_tool_output", "show-tool-output", "coding", "coding", "operator"],
  ["list_ai_tools", "list-ai-tools", "coding", "coding", "operator"],
  ["check_ai_tools", "check-ai-tools", "coding", "coding", "operator"],
  ["tools_package_plan", "tools-package-plan", "coding", "coding", "operator"],
  ["search_context", "search-context", "mimisbrunnr", "mimisbrunnr_retrieval", "retrieval"],
  ["search_session_archives", "search-session-archives", "mimisbrunnr", "mimisbrunnr_retrieval", "retrieval"],
  ["assemble_agent_context", "assemble-agent-context", "mimisbrunnr", "mimisbrunnr_context_packet", "retrieval"],
  ["list_context_tree", "list-context-tree", "mimisbrunnr", "mimisbrunnr_retrieval", "retrieval"],
  ["read_context_node", "read-context-node", "mimisbrunnr", "mimisbrunnr_retrieval", "retrieval"],
  ["get_context_packet", "get-context-packet", "mimisbrunnr", "mimisbrunnr_context_packet", "retrieval"],
  ["fetch_decision_summary", "fetch-decision-summary", "mimisbrunnr", "mimisbrunnr_context_packet", "retrieval"],
  ["draft_note", "draft-note", "mimisbrunnr", "mimisbrunnr_memory_update", "writer"],
  ["list_review_queue", "list-review-queue", "mimisbrunnr", "mimisbrunnr_review", "operator"],
  ["read_review_note", "read-review-note", "mimisbrunnr", "mimisbrunnr_review", "operator"],
  ["accept_note", "accept-note", "mimisbrunnr", "mimisbrunnr_review", "operator"],
  ["reject_note", "reject-note", "mimisbrunnr", "mimisbrunnr_review", "operator"],
  ["create_refresh_draft", "create-refresh-draft", "mimisbrunnr", "mimisbrunnr_memory_update", "operator"],
  ["create_refresh_drafts", "create-refresh-drafts", "mimisbrunnr", "mimisbrunnr_memory_update", "operator"],
  ["validate_note", "validate-note", "mimisbrunnr", "mimisbrunnr_validation", "orchestrator"],
  ["promote_note", "promote-note", "mimisbrunnr", "mimisbrunnr_memory_update", "orchestrator"],
  ["import_resource", "import-resource", "mimisbrunnr", "mimisbrunnr_memory_update", "operator"],
  ["query_history", "query-history", "mimisbrunnr", "mimisbrunnr_history", "operator"],
  ["create_session_archive", "create-session-archive", "mimisbrunnr", "mimisbrunnr_memory_update", "operator"]
];
const expectedSystemCommands = [
  "version",
  "auth-issuers",
  "auth-status",
  "auth-issued-tokens",
  "auth-introspect-token",
  "check-mcp-profiles",
  "deactivate-toolbox",
  "describe-toolbox",
  "freshness-status",
  "issue-auth-token",
  "list-active-toolbox",
  "list-active-tools",
  "list-toolboxes",
  "request-toolbox-activation",
  "revoke-auth-token",
  "revoke-auth-tokens",
  "set-auth-issuer-state",
  "sync-mcp-profiles"
];
const expectedAuthorizationRoles = new Map([
  ["execute_coding_task", ["operator", "system"]],
  ["list_agent_traces", ["operator", "orchestrator", "system"]],
  ["show_tool_output", ["operator", "system"]],
  ["list_ai_tools", ["operator", "system"]],
  ["check_ai_tools", ["operator", "system"]],
  ["tools_package_plan", ["operator", "system"]],
  ["search_context", ["retrieval", "operator", "orchestrator", "system"]],
  ["search_session_archives", ["retrieval", "operator", "orchestrator", "system"]],
  ["assemble_agent_context", ["retrieval", "operator", "orchestrator", "system"]],
  ["list_context_tree", ["retrieval", "operator", "orchestrator", "system"]],
  ["read_context_node", ["retrieval", "operator", "orchestrator", "system"]],
  ["get_context_packet", ["retrieval", "operator", "orchestrator", "system"]],
  ["fetch_decision_summary", ["retrieval", "operator", "orchestrator", "system"]],
  ["draft_note", ["writer", "operator", "orchestrator", "system"]],
  ["list_review_queue", ["operator", "orchestrator", "system"]],
  ["read_review_note", ["operator", "orchestrator", "system"]],
  ["accept_note", ["operator", "orchestrator", "system"]],
  ["reject_note", ["operator", "orchestrator", "system"]],
  ["create_refresh_draft", ["operator", "orchestrator", "system"]],
  ["create_refresh_drafts", ["operator", "orchestrator", "system"]],
  ["validate_note", ["operator", "orchestrator", "system"]],
  ["promote_note", ["operator", "orchestrator", "system"]],
  ["import_resource", ["operator", "orchestrator", "system"]],
  ["query_history", ["operator", "orchestrator", "system"]],
  ["create_session_archive", ["operator", "system"]]
]);

test("runtime command catalog is the single routed-command source of truth", () => {
  assert.deepEqual(
    RUNTIME_COMMAND_DEFINITIONS.map((command) => [
      command.name,
      command.cliName,
      command.domain,
      command.family,
      command.defaultActorRole
    ]),
    expectedCommands
  );
  assert.deepEqual(RUNTIME_COMMAND_NAMES, expectedCommands.map(([name]) => name));
  assert.deepEqual(CLI_RUNTIME_COMMAND_NAMES, expectedCommands.map(([, cliName]) => cliName));

  for (const [name, cliName] of expectedCommands) {
    assert.equal(getRuntimeCommandDefinition(name)?.name, name);
    assert.equal(getRuntimeCommandDefinition(cliName)?.name, name);
    assert.equal(toRuntimeCommandName(name), name);
    assert.equal(toRuntimeCommandName(cliName), name);
    assert.equal(toCliCommandName(name), cliName);
    assert.equal(toCliCommandName(cliName), cliName);
  }
});

test("task family router derives routes from the shared command catalog", () => {
  const router = new TaskFamilyRouter();

  for (const [name, , domain, family] of expectedCommands) {
    assert.deepEqual(router.route(name), {
      command: name,
      domain,
      family
    });
  }
});
test("command authorization policy covers every runtime catalog command", () => {
  for (const [name, , , , defaultActorRole] of expectedCommands) {
    const allowedRoles = getCommandAuthorizationRoles(name);
    assert.deepEqual(allowedRoles, expectedAuthorizationRoles.get(name));
    assert.ok(allowedRoles.includes(defaultActorRole));
  }
});
test("toolbox policy metadata covers every runtime command with known categories and trust classes", () => {
  const policy = compileToolboxPolicyFromDirectory(path.resolve("docker", "mcp"));
  const validMutationLevels = new Set(["read", "write", "admin"]);

  assert.deepEqual(
    Object.keys(RUNTIME_COMMAND_TOOLBOX_POLICIES).sort(),
    [...RUNTIME_COMMAND_NAMES].sort()
  );

  for (const commandName of RUNTIME_COMMAND_NAMES) {
    const toolboxPolicy = RUNTIME_COMMAND_TOOLBOX_POLICIES[commandName];
    assert.ok(toolboxPolicy, `Expected toolbox policy metadata for '${commandName}'.`);
    assert.ok(
      policy.trustClasses[toolboxPolicy.minimumTrustClass],
      `Unknown trust class '${toolboxPolicy.minimumTrustClass}' for '${commandName}'.`
    );
    assert.ok(
      validMutationLevels.has(toolboxPolicy.mutationLevel),
      `Unknown mutation level '${toolboxPolicy.mutationLevel}' for '${commandName}'.`
    );

    for (const category of toolboxPolicy.allOfCategories) {
      assert.ok(policy.categories[category], `Unknown allOf category '${category}' for '${commandName}'.`);
    }

    for (const category of toolboxPolicy.anyOfCategories ?? []) {
      assert.ok(policy.categories[category], `Unknown anyOf category '${category}' for '${commandName}'.`);
    }
  }
});
test("HTTP and MCP adapter command surfaces stay aligned with the runtime catalog", () => {
  const expectedCliCommands = expectedCommands.map(([, cliName]) => cliName);
  const expectedRuntimeCommands = expectedCommands.map(([name]) => name);
  const expectedDefaultRolesByCliName = new Map(
    expectedCommands.map(([, cliName, , , defaultActorRole]) => [cliName, defaultActorRole])
  );
  const expectedDefaultRolesByRuntimeName = new Map(
    expectedCommands.map(([name, , , , defaultActorRole]) => [name, defaultActorRole])
  );

  const httpRoutes = getRuntimeHttpRouteDefinitions();
  assert.deepEqual(httpRoutes.map((route) => route.commandName), expectedCliCommands);
  for (const route of httpRoutes) {
    assert.equal(route.method, "POST");
    assert.equal(route.defaultActorRole, expectedDefaultRolesByCliName.get(route.commandName));
  }

  assert.deepEqual(MCP_TOOL_DEFINITIONS.map((tool) => tool.name), expectedRuntimeCommands);
  for (const tool of MCP_TOOL_DEFINITIONS) {
    assert.equal(tool.defaultActorRole, expectedDefaultRolesByRuntimeName.get(tool.name));
  }
});
test("CLI adapter exposes a deterministic system/runtime command surface", () => {
  assert.deepEqual(SYSTEM_COMMAND_NAMES, expectedSystemCommands);
  assert.deepEqual(CLI_COMMAND_NAMES, [
    ...expectedSystemCommands,
    ...expectedCommands.map(([, cliName]) => cliName)
  ]);

  const surface = getCliCommandSurfaceDefinitions();
  assert.deepEqual(
    surface.filter((command) => command.kind === "system").map((command) => command.name),
    expectedSystemCommands
  );
  assert.deepEqual(
    surface.filter((command) => command.kind === "runtime").map((command) => command.name),
    expectedCommands.map(([, cliName]) => cliName)
  );
  assert.deepEqual(
    surface
      .filter((command) => command.kind === "runtime")
      .map((command) => [command.name, command.defaultActorRole]),
    expectedCommands.map(([, cliName, , , defaultActorRole]) => [cliName, defaultActorRole])
  );
});
test("transport validators expose support for every runtime catalog command", () => {
  const expectedCliCommands = expectedCommands.map(([, cliName]) => cliName);

  assert.deepEqual(getSupportedTransportCommandNames(), expectedCliCommands);
});

test("runtime dispatcher covers every cataloged runtime command", async () => {
  const expectedCliCommands = expectedCommands.map(([, cliName]) => cliName);
  assert.deepEqual(getSupportedRuntimeDispatchCommandNames(), expectedCliCommands);

  const responseFor = (commandName) => async (request) => ({
    command: commandName,
    request
  });
  const container = {
    authPolicy: {
      authorize() {}
    },
    orchestrator: {
      executeCodingTask: responseFor("execute-coding-task"),
      listAgentTraces: responseFor("list-agent-traces"),
      showToolOutput: responseFor("show-tool-output"),
      listAiTools: responseFor("list-ai-tools"),
      checkAiTools: responseFor("check-ai-tools"),
      getAiToolPackagePlan: responseFor("tools-package-plan"),
      searchContext: responseFor("search-context"),
      searchSessionArchives: responseFor("search-session-archives"),
      assembleAgentContext: responseFor("assemble-agent-context"),
      getContextPacket: responseFor("get-context-packet"),
      fetchDecisionSummary: responseFor("fetch-decision-summary"),
      draftNote: responseFor("draft-note"),
      createRefreshDraft: responseFor("create-refresh-draft"),
      createRefreshDraftBatch: responseFor("create-refresh-drafts"),
      validateNote: responseFor("validate-note"),
      promoteNote: responseFor("promote-note"),
      importResource: responseFor("import-resource"),
      queryHistory: responseFor("query-history"),
      createSessionArchive: responseFor("create-session-archive")
    },
    services: {
      contextNamespaceService: {
        listTree: responseFor("list-context-tree"),
        readNode: responseFor("read-context-node")
      },
      reviewCommandService: {
        listQueue: responseFor("list-review-queue"),
        readNote: responseFor("read-review-note"),
        acceptNote: responseFor("accept-note"),
        rejectNote: responseFor("reject-note")
      }
    }
  };

  for (const commandName of expectedCliCommands) {
    const request = { marker: commandName };
    const result = await dispatchRuntimeCommand(commandName, request, container);
    assert.deepEqual(result, {
      command: commandName,
      request
    });
  }
});

test("command surface inventory reports a fully aligned runtime surface", () => {
  const report = buildCommandSurfaceReport();

  assert.equal(report.ok, true);
  assert.deepEqual(report.systemCommands, expectedSystemCommands);
  assert.deepEqual(
    report.runtimeCommands.map((command) => command.cliName),
    expectedCommands.map(([, cliName]) => cliName)
  );
  assert.deepEqual(report.mismatches, []);
});
