#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import process from "node:process";
import {
  toCliCommandName,
  type ActorContext,
  type CompiledToolboxClientOverlay,
  type CompiledToolboxPolicy,
  type CompiledToolboxToolDescriptor
} from "@mimir/contracts";
import {
  ActorAuthorizationError,
  buildMimirControlSurface,
  buildServiceContainer,
  dispatchRuntimeCommand,
  findAutoExpandIntentIdForCategories,
  loadEnvironment,
  SqliteToolboxSessionLeaseStore,
  TransportValidationError,
  validateTransportRequest
} from "@mimir/infrastructure";
import {
  activateToolboxBrokerSession,
  createToolboxBrokerSessionState,
  reconcileToolboxBrokerSessionState,
  touchToolboxBrokerSessionActivity
} from "./session-state.js";
import {
  buildBrokerToolDefinitions,
  getToolDefinition,
  isControlTool
} from "./tool-definitions.js";
import { LocalStdioToolboxBackendAdapter } from "./adapters/local-stdio-adapter.js";
import { DockerGatewayToolboxBackendAdapter } from "./adapters/docker-gateway-adapter.js";
import type {
  BrokerPeerToolDefinition,
  ToolboxBackendAdapter
} from "./adapters/toolbox-backend-adapter.js";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRecord = Record<string, unknown>;

interface HandledResponse {
  response: unknown;
  notifications?: unknown[];
}

interface VisibleToolSet {
  activeProfileId: string;
  definitions: Array<{
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  activeToolsResponse: {
    profileId: string;
    clientId: string;
    tools: CompiledToolboxToolDescriptor[];
    declaredTools: CompiledToolboxToolDescriptor[];
    activeTools: CompiledToolboxToolDescriptor[];
    suppressedTools: CompiledToolboxToolDescriptor[];
  };
  omittedTools: Array<{
    toolId: string;
    serverId: string;
    reason: string;
  }>;
  backendStates: Array<{
    serverId: string;
    runtimeBindingKind: string | null;
    routable: boolean;
    health?: {
      status: "ready" | "error";
      reason?: string;
    };
    reason?: string;
  }>;
}

class ContentLengthTransport {
  private buffer = Buffer.alloc(0);
  private readonly listeners: Array<(message: unknown) => void> = [];

  constructor(
    input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream
  ) {
    input.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      this.drain();
    });
  }

  onMessage(listener: (message: unknown) => void): void {
    this.listeners.push(listener);
  }

  send(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
    this.output.write(Buffer.concat([header, body]));
  }

  private drain(): void {
    while (true) {
      const separator = this.buffer.indexOf("\r\n\r\n");
      if (separator === -1) {
        return;
      }

      const headerText = this.buffer.subarray(0, separator).toString("utf8");
      const contentLength = parseContentLength(headerText);
      if (contentLength === null) {
        this.buffer = Buffer.alloc(0);
        this.sendParseError("MCP request is missing a valid Content-Length header.");
        return;
      }

      const totalLength = separator + 4 + contentLength;
      if (this.buffer.length < totalLength) {
        return;
      }

      const payload = this.buffer
        .subarray(separator + 4, totalLength)
        .toString("utf8");
      this.buffer = this.buffer.subarray(totalLength);

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload) as unknown;
      } catch {
        this.sendParseError("MCP request body is not valid JSON.");
        continue;
      }
      for (const listener of this.listeners) {
        void listener(parsed);
      }
    }
  }

  private sendParseError(message: string): void {
    this.send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message
      }
    });
  }
}

const env = loadEnvironment();
const manifestDirectory =
  process.env.MAB_TOOLBOX_MANIFEST_DIR?.trim() || "docker/mcp";
const initialProfileId =
  process.env.MAB_TOOLBOX_ACTIVE_PROFILE?.trim() || "bootstrap";
const initialClientId =
  process.env.MAB_TOOLBOX_CLIENT_ID?.trim() || "codex";
const leaseIssuer =
  process.env.MAB_TOOLBOX_LEASE_ISSUER?.trim() || "mimir-toolbox";
const leaseAudience =
  process.env.MAB_TOOLBOX_LEASE_AUDIENCE?.trim() || "mimir-core";
const leaseIssuerSecret =
  process.env.MAB_TOOLBOX_LEASE_ISSUER_SECRET?.trim() || undefined;
const leaseStore = process.env.MAB_SQLITE_PATH?.trim()
  ? new SqliteToolboxSessionLeaseStore(process.env.MAB_SQLITE_PATH.trim())
  : undefined;
const serviceContainer = buildServiceContainer(env);
const bootstrapControlSurface = buildScopedControlSurface(
  initialProfileId,
  initialClientId
);
let sessionState = createToolboxBrokerSessionState({
  policy: bootstrapControlSurface.policy,
  activeProfileId: initialProfileId,
  clientId: initialClientId
});
const backendAdapters = new Map<string, ToolboxBackendAdapter>();
const backendFailures = new Map<
  string,
  {
    status: "error";
    reason: string;
  }
>();
let activeBackendScopeKey = "";
let idleContractionTimer: NodeJS.Timeout | null = null;
let leaseContractionTimer: NodeJS.Timeout | null = null;
const dockerGatewayAdapterEnabled = isTruthyEnv(
  process.env.MAB_TOOLBOX_ENABLE_DOCKER_GATEWAY_ADAPTER
);
const defaultSessionActor = loadDefaultSessionActor();
const transport = new ContentLengthTransport(process.stdin, process.stdout);
let shuttingDown = false;

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));
process.stdin.once("end", () => shutdown(0));
process.stdin.once("close", () => shutdown(0));

transport.onMessage(async (message) => {
  if (!isJsonRpcRequest(message)) {
    return;
  }

  if (!("id" in message)) {
    if (message.method === "notifications/initialized") {
      return;
    }
    return;
  }

  try {
    const handled = await handleRequest(message);
    transport.send(handled.response);
    for (const notification of handled.notifications ?? []) {
      transport.send(notification);
    }
  } catch (error) {
    transport.send({
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
});

scheduleSessionContractionTimers();

async function handleRequest(request: JsonRpcRequest): Promise<HandledResponse> {
  switch (request.method) {
    case "initialize":
      return {
        response: {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: {
            protocolVersion:
              typeof request.params?.protocolVersion === "string"
                ? request.params.protocolVersion
                : "2024-11-05",
            capabilities: {
              tools: {
                listChanged: true
              }
            },
            serverInfo: {
              name: "mimir-toolbox-mcp",
              version: "0.2.0"
            }
          }
        }
      };
    case "tools/list":
      {
        const sessionContracted = reconcileSessionState();
        const visibleTools = await listVisibleTools();
      return {
        response: {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result: {
            tools: visibleTools.definitions.map((tool) => ({
              name: tool.name,
              title: tool.title,
              description: tool.description,
              inputSchema: tool.inputSchema
            }))
          }
        },
        notifications: sessionContracted
          ? [{ jsonrpc: "2.0", method: "notifications/tools/list_changed" }]
          : []
      };
      }
    case "tools/call": {
      const sessionContracted = reconcileSessionState();
      const visibleToolNamesBefore = await listVisibleToolNames();
      const result = await callTool(
        String(request.params?.name ?? ""),
        (request.params?.arguments as JsonRecord | undefined) ?? {}
      );
      const visibleToolNamesAfter = await listVisibleToolNames();
      return {
        response: {
          jsonrpc: "2.0",
          id: request.id ?? null,
          result
        },
        notifications:
          sessionContracted
          || JSON.stringify(visibleToolNamesBefore) !== JSON.stringify(visibleToolNamesAfter)
            ? [{ jsonrpc: "2.0", method: "notifications/tools/list_changed" }]
            : []
      };
    }
    default:
      return {
        response: {
          jsonrpc: "2.0",
          id: request.id ?? null,
          error: {
            code: -32601,
            message: `Method '${request.method}' is not supported.`
          }
        }
      };
  }
}

async function listVisibleTools() {
  const policy = getScopedControlSurface().policy;
  const client = policy.clients[sessionState.clientId];
  const activeProfileId = resolveSessionProfileId(policy);
  const activeToolsResponse = buildBrokerActiveToolsResponse(
    policy,
    client,
    sessionState.activeBands,
    activeProfileId
  );
  await reconcileBackendAdapters(policy, activeToolsResponse.activeTools);

  const staticDefinitions = new Map(
    buildBrokerToolDefinitions(activeToolsResponse.activeTools).map((tool) => [tool.name, tool])
  );
  const peerDefinitionsByServer = await buildPeerDefinitionsByServer(
    policy,
    activeToolsResponse.activeTools
  );
  const backendStates = buildBackendStates(
    policy,
    activeProfileId,
    activeToolsResponse.activeTools,
    peerDefinitionsByServer
  );
  const definitions: VisibleToolSet["definitions"] = [];
  const omittedTools: VisibleToolSet["omittedTools"] = [];

  for (const tool of activeToolsResponse.activeTools) {
    const staticDefinition = staticDefinitions.get(tool.toolId);
    if (staticDefinition) {
      definitions.push({
        name: staticDefinition.name,
        title: staticDefinition.title,
        description: staticDefinition.description,
        inputSchema: staticDefinition.inputSchema
      });
      continue;
    }

    const peerTool = peerDefinitionsByServer.get(tool.serverId)?.get(tool.toolId);
    if (peerTool) {
      definitions.push({
        name: peerTool.name,
        title: peerTool.title ?? tool.displayName,
        description: peerTool.description ?? `${tool.displayName} routed through broker adapter.`,
        inputSchema: peerTool.inputSchema ?? {
          type: "object",
          additionalProperties: true
        }
      });
      continue;
    }

    omittedTools.push({
      toolId: tool.toolId,
      serverId: tool.serverId,
      reason: buildNonRoutableReason(policy, tool)
    });
  }

  return {
    activeProfileId,
    definitions,
    activeToolsResponse,
    omittedTools,
    backendStates
  } satisfies VisibleToolSet;
}

async function listVisibleToolNames(): Promise<string[]> {
  return (await listVisibleTools()).definitions.map((tool) => tool.name);
}

async function callTool(name: string, args: JsonRecord): Promise<unknown> {
  const visibleTools = await listVisibleTools();
  const visibleToolDefinition = visibleTools.definitions.find((tool) => tool.name === name);
  if (!visibleToolDefinition) {
    if (
      !isControlTool(name)
      && (sessionState.activationCause === "idle_timeout"
        || sessionState.activationCause === "lease_expired")
      && sessionState.activeProfileId === "bootstrap"
    ) {
      return failure(
        "toolbox_session_contracted",
        `Tool '${name}' is no longer available because the broker session contracted after ${sessionState.activationCause === "idle_timeout" ? "idle timeout" : "lease expiry"}.`
      );
    }
    return failure("tool_not_found", `Tool '${name}' is not supported.`);
  }

  try {
    const result = isControlTool(name)
      ? await callControlTool(name, args)
      : await callRoutedTool(name, args, visibleTools.activeToolsResponse.activeTools);

    if (!isControlTool(name) && !didToolResultFail(result)) {
      sessionState = touchToolboxBrokerSessionActivity(sessionState);
    }

    if (isMcpToolResult(result)) {
      return {
        ...result,
        structuredContent:
          result.structuredContent &&
          typeof result.structuredContent === "object" &&
          !Array.isArray(result.structuredContent)
            ? {
                ...(result.structuredContent as Record<string, unknown>),
                sessionState: serializeSessionState()
              }
            : {
                result: result.structuredContent,
                sessionState: serializeSessionState()
              }
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ...toStructuredContent(result),
              sessionState: serializeSessionState()
            },
            null,
            2
          )
        }
      ],
      structuredContent: {
        ...toStructuredContent(result),
        sessionState: serializeSessionState()
      },
      isError: isToolError(result)
    };
  } catch (error) {
    const serviceError =
      error instanceof TransportValidationError
        ? error.toServiceError()
        : error instanceof ActorAuthorizationError
          ? error.toServiceError()
          : {
              code: "tool_failed",
              message: error instanceof Error ? error.message : String(error)
            };
    return failure(serviceError.code, serviceError.message);
  }
}

async function callControlTool(name: string, args: JsonRecord): Promise<unknown> {
  const scopedControl = getScopedControlSurface();

  switch (name) {
    case "list_toolboxes":
      return scopedControl.listToolboxes();
    case "describe_toolbox":
      return scopedControl.describeToolbox(String(args.toolboxId ?? ""));
    case "request_toolbox_activation": {
      const requestedToolbox = optionalString(args.requestedToolbox);
      const requiredCategories = optionalStringArray(args.requiredCategories);
      const clientId = optionalString(args.clientId) ?? sessionState.clientId;
      const autoExpandIntentId =
        !requestedToolbox && requiredCategories?.length
          ? findAutoExpandIntentIdForCategories(
              scopedControl.policy,
              sessionState.activeBands,
              requiredCategories,
              optionalActorRole(args.actorRole)
            )
          : undefined;
      const result = await scopedControl.requestToolboxActivation({
        requestedToolbox: autoExpandIntentId ?? requestedToolbox,
        requiredCategories,
        actorRole: optionalActorRole(args.actorRole),
        taskSummary: optionalString(args.taskSummary),
        clientId,
        approval: optionalToolboxApproval(args.approval)
      });
      if (result.approved && result.approvedProfile) {
        sessionState = activateToolboxBrokerSession(sessionState, {
          policy: scopedControl.policy,
          profileId: result.approvedProfile,
          leaseToken: result.leaseToken ?? null,
          leaseExpiresAt: result.leaseExpiresAt ?? null,
          activationCause: autoExpandIntentId ? "policy_auto" : "explicit_request",
          toolboxId: result.approvedToolbox ?? result.requestedToolbox ?? null,
          clientId: result.clientId
        });
        scheduleSessionContractionTimers();
      }
      return result;
    }
    case "list_active_toolbox":
      return {
        ...(await buildBrokerActiveToolboxResponse(scopedControl.policy)),
        brokerSession: serializeSessionState()
      };
    case "list_active_tools": {
      const visibleTools = await listVisibleTools();
      return {
        ...visibleTools.activeToolsResponse,
        brokerVisibleTools: visibleTools.definitions.map((tool) => tool.name),
        brokerOmittedTools: visibleTools.omittedTools,
        brokerBackendStates: visibleTools.backendStates
      };
    }
    case "deactivate_toolbox": {
      const result = await scopedControl.deactivateToolbox(optionalString(args.leaseToken));
      sessionState = activateToolboxBrokerSession(sessionState, {
        policy: scopedControl.policy,
        profileId: result.downgradeTarget,
        activationCause: "deactivation",
        toolboxId: null,
        leaseToken: null,
        leaseExpiresAt: null
      });
      scheduleSessionContractionTimers();
      return result;
    }
    default:
      return failure("tool_not_found", `Tool '${name}' is not supported.`);
  }
}

async function callMimirCoreTool(name: string, args: JsonRecord): Promise<unknown> {
  const tool = getToolDefinition(name);
  const validatedArgs = validateTransportRequest(name, args);
  const request = {
    ...validatedArgs,
    actor: buildActorContext(name, tool?.defaultActorRole ?? "retrieval", validatedArgs.actor)
  };
  const commandName = toCliCommandName(name);
  if (!commandName) {
    return failure(
      "tool_not_found",
      `No runtime command is registered for MCP tool '${name}'.`
    );
  }

  return dispatchRuntimeCommand(commandName, request, serviceContainer);
}

async function callRoutedTool(
  name: string,
  args: JsonRecord,
  activeTools: CompiledToolboxToolDescriptor[]
): Promise<unknown> {
  const toolDescriptor = activeTools.find((tool) => tool.toolId === name);
  if (!toolDescriptor) {
    return failure("tool_not_found", `Tool '${name}' is not active in the current broker session.`);
  }

  if (getToolDefinition(name) && !isControlTool(name)) {
    return callMimirCoreTool(name, args);
  }

  const server = getScopedControlSurface().policy.servers[toolDescriptor.serverId];
  if (
    !server.runtimeBinding
    || !isRuntimeBindingRoutableInBroker(server.runtimeBinding)
  ) {
    return failure(
      "tool_not_routable",
      `Tool '${name}' is active in policy but the broker does not yet support runtime binding '${server.runtimeBinding?.kind ?? "none"}'.`
    );
  }

  const adapter = backendAdapters.get(server.id);
  if (!adapter || adapter.health().status !== "ready") {
    return failure(
      "tool_backend_unavailable",
      `Tool '${name}' is active in policy but backend '${server.id}' is not available.`
    );
  }

  return adapter.callTool(name, args);
}

function buildActorContext(
  toolName: string,
  defaultActorRole: ActorContext["actorRole"],
  actor: unknown
): ActorContext {
  const input = actor && typeof actor === "object" ? actor as Partial<ActorContext> : {};
  const now = new Date().toISOString();
  const resolvedProfileId = resolveSessionProfileId(getScopedControlSurface().policy);
  const toolboxSessionMode =
    resolvedProfileId === "bootstrap"
      ? "toolbox-bootstrap"
      : "toolbox-activated";
  const sessionPolicyToken =
    input.sessionPolicyToken
    ?? sessionState.leaseToken
    ?? process.env.MAB_TOOLBOX_SESSION_POLICY_TOKEN?.trim()
    ?? undefined;

  if (defaultSessionActor) {
    return {
      actorId: defaultSessionActor.actorId,
      actorRole: defaultSessionActor.actorRole,
      transport: "mcp",
      source: defaultSessionActor.source,
      requestId: input.requestId ?? randomUUID(),
      initiatedAt: input.initiatedAt ?? now,
      toolName: input.toolName ?? toolName,
      authToken: defaultSessionActor.authToken,
      sessionPolicyToken,
      toolboxSessionMode,
      toolboxClientId: input.toolboxClientId ?? sessionState.clientId,
      toolboxProfileId: input.toolboxProfileId ?? resolvedProfileId
    };
  }

  return {
    actorId: input.actorId ?? `${toolName}-toolbox-mcp`,
    actorRole: input.actorRole ?? defaultActorRole,
    transport: "mcp",
    source: input.source ?? "mimir-toolbox-mcp-session",
    requestId: input.requestId ?? randomUUID(),
    initiatedAt: input.initiatedAt ?? now,
    toolName: input.toolName ?? toolName,
    authToken: input.authToken,
    sessionPolicyToken,
    toolboxSessionMode,
    toolboxClientId: input.toolboxClientId ?? sessionState.clientId,
    toolboxProfileId: input.toolboxProfileId ?? resolvedProfileId
  };
}

function getScopedControlSurface() {
  return buildScopedControlSurface(
    resolveSessionProfileId(bootstrapControlSurface.policy),
    sessionState.clientId
  );
}

function buildScopedControlSurface(activeProfileId: string, clientId: string) {
  return buildMimirControlSurface({
    manifestDirectory,
    activeProfileId,
    clientId,
    auditHistoryService: serviceContainer.services.auditHistoryService,
    leaseIssuer,
    leaseAudience,
    leaseIssuerSecret,
    leaseStore
  });
}

async function reconcileBackendAdapters(
  policy: ReturnType<typeof getScopedControlSurface>["policy"],
  activeTools: CompiledToolboxToolDescriptor[]
): Promise<void> {
  const activeRoutableServerIds = new Set(
    activeTools
      .map((tool) => tool.serverId)
      .filter((serverId) =>
        isRuntimeBindingRoutableInBroker(policy.servers[serverId]?.runtimeBinding)
      )
  );
  const activeScopeKey = [...activeRoutableServerIds].sort().join(",");
  if (activeScopeKey !== activeBackendScopeKey) {
    activeBackendScopeKey = activeScopeKey;
    backendFailures.clear();
  }

  for (const [serverId, adapter] of [...backendAdapters.entries()]) {
    if (!activeRoutableServerIds.has(serverId)) {
      await adapter.stop();
      backendAdapters.delete(serverId);
      backendFailures.delete(serverId);
    }
  }

  for (const serverId of activeRoutableServerIds) {
    if (backendAdapters.has(serverId) || backendFailures.has(serverId)) {
      continue;
    }
    const server = policy.servers[serverId];
    const runtimeBinding = server.runtimeBinding;
    if (!runtimeBinding || !isRuntimeBindingRoutableInBroker(runtimeBinding)) {
      continue;
    }

    let adapter: ToolboxBackendAdapter | null = null;
    try {
      adapter = createBackendAdapter(serverId, runtimeBinding);
      await adapter.start();
      backendAdapters.set(serverId, adapter);
      backendFailures.delete(serverId);
    } catch {
      const failureReason = adapter?.health().reason ?? "backend failed to start";
      backendFailures.set(serverId, {
        status: "error",
        reason: failureReason
      });
      await adapter?.stop();
    }
  }
}

async function buildPeerDefinitionsByServer(
  policy: ReturnType<typeof getScopedControlSurface>["policy"],
  activeTools: CompiledToolboxToolDescriptor[]
): Promise<Map<string, Map<string, BrokerPeerToolDefinition>>> {
  const definitionsByServer = new Map<string, Map<string, BrokerPeerToolDefinition>>();
  const localServerIds = unique(
    activeTools
      .map((tool) => tool.serverId)
      .filter((serverId) =>
        isRuntimeBindingRoutableInBroker(policy.servers[serverId]?.runtimeBinding)
      )
  );

  for (const serverId of localServerIds) {
    const adapter = backendAdapters.get(serverId);
    if (!adapter || adapter.health().status !== "ready") {
      continue;
    }

    try {
      const definitions = await adapter.listTools();
      definitionsByServer.set(
        serverId,
        new Map(definitions.map((tool) => [tool.name, tool]))
      );
    } catch {
      continue;
    }
  }

  return definitionsByServer;
}

function buildNonRoutableReason(
  policy: ReturnType<typeof getScopedControlSurface>["policy"],
  tool: CompiledToolboxToolDescriptor
): string {
  const server = policy.servers[tool.serverId];
  return buildNonRoutableReasonForServer(server.id, server.runtimeBinding);
}

function buildBackendStates(
  policy: ReturnType<typeof getScopedControlSurface>["policy"],
  activeProfileId: string,
  activeTools: CompiledToolboxToolDescriptor[],
  peerDefinitionsByServer: Map<string, Map<string, BrokerPeerToolDefinition>>
): VisibleToolSet["backendStates"] {
  const activePeerServerIdSet = new Set(
    activeTools
      .map((tool) => tool.serverId)
      .filter((serverId) => policy.servers[serverId]?.kind === "peer")
  );
  const activePeerServerIds = [
    ...(policy.profiles[activeProfileId]?.includeServers ?? []).filter((serverId) =>
      activePeerServerIdSet.has(serverId)
    ),
    ...[...activePeerServerIdSet].filter(
      (serverId) => !(policy.profiles[activeProfileId]?.includeServers ?? []).includes(serverId)
    )
  ];

  return activePeerServerIds.map((serverId) => {
    const server = policy.servers[serverId];
    const runtimeBinding = server.runtimeBinding;
    if (!runtimeBinding) {
      return {
        serverId,
        runtimeBindingKind: null,
        routable: false,
        reason: "server has no runtime binding"
      };
    }

    if (isRuntimeBindingRoutableInBroker(runtimeBinding)) {
      const adapter = backendAdapters.get(serverId);
      const health = adapter?.health();
      const failureHealth = backendFailures.get(serverId);
      const hasDefinitions = peerDefinitionsByServer.has(serverId);
      if (health?.status === "ready" && hasDefinitions) {
        return {
          serverId,
          runtimeBindingKind: runtimeBinding.kind,
          routable: true,
          health
        };
      }

      return {
        serverId,
        runtimeBindingKind: runtimeBinding.kind,
        routable: false,
        health: health?.status === "ready" ? undefined : (health ?? failureHealth),
        reason:
          health?.reason
          ?? failureHealth?.reason
          ?? (hasDefinitions
            ? `${runtimeBinding.kind} backend is unavailable`
            : `${runtimeBinding.kind} backend tool discovery failed`)
      };
    }

    return {
      serverId,
      runtimeBindingKind: runtimeBinding.kind,
      routable: false,
      reason: buildNonRoutableReasonForServer(serverId, runtimeBinding)
    };
  }).sort(compareBackendStates);
}

function buildNonRoutableReasonForServer(
  serverId: string,
  runtimeBinding:
    | ReturnType<typeof getScopedControlSurface>["policy"]["servers"][string]["runtimeBinding"]
    | undefined
): string {
  if (!runtimeBinding) {
    return "server has no runtime binding";
  }
  if (runtimeBinding.kind === "descriptor-only") {
    return runtimeBinding.blockedReason;
  }
  if (runtimeBinding.kind === "docker-catalog") {
    if (!dockerGatewayAdapterEnabled) {
      return "docker-backed peer routing is not implemented in the dynamic broker yet";
    }
    const adapter = backendAdapters.get(serverId);
    const failure = backendFailures.get(serverId);
    if (!adapter) {
      return failure?.reason ?? "docker gateway backend failed to start";
    }
    return adapter.health().reason ?? "docker gateway backend is unavailable";
  }
  const adapter = backendAdapters.get(serverId);
  const failure = backendFailures.get(serverId);
  if (!adapter) {
    return failure?.reason ?? "local stdio backend failed to start";
  }
  return adapter.health().reason ?? "local stdio backend is unavailable";
}

function createBackendAdapter(
  serverId: string,
  runtimeBinding: NonNullable<
    ReturnType<typeof getScopedControlSurface>["policy"]["servers"][string]["runtimeBinding"]
  >
): ToolboxBackendAdapter {
  switch (runtimeBinding.kind) {
    case "local-stdio":
      return new LocalStdioToolboxBackendAdapter(serverId, runtimeBinding);
    case "docker-catalog":
      return new DockerGatewayToolboxBackendAdapter(serverId, runtimeBinding);
    default:
      throw new Error(
        `No broker adapter exists for runtime binding '${runtimeBinding.kind}'.`
      );
  }
}

function isRuntimeBindingRoutableInBroker(
  runtimeBinding:
    | ReturnType<typeof getScopedControlSurface>["policy"]["servers"][string]["runtimeBinding"]
    | undefined
): boolean {
  if (!runtimeBinding) {
    return false;
  }
  if (runtimeBinding.kind === "local-stdio") {
    return true;
  }
  if (runtimeBinding.kind === "docker-catalog") {
    return dockerGatewayAdapterEnabled;
  }
  return false;
}

function isTruthyEnv(value: string | undefined): boolean {
  return typeof value === "string" && /^(1|true|yes|on)$/i.test(value.trim());
}

function compareBackendStates(
  left: VisibleToolSet["backendStates"][number],
  right: VisibleToolSet["backendStates"][number]
): number {
  const priority = (state: VisibleToolSet["backendStates"][number]) => {
    if (state.routable) {
      return 0;
    }
    switch (state.runtimeBindingKind) {
      case "docker-catalog":
        return 1;
      case "descriptor-only":
        return 2;
      case "local-stdio":
        return 3;
      default:
        return 4;
    }
  };

  return (
    priority(left) - priority(right)
    || left.serverId.localeCompare(right.serverId)
  );
}

function serializeSessionState() {
  return {
    sessionId: sessionState.sessionId,
    clientId: sessionState.clientId,
    runtimeMode: sessionState.runtimeMode,
    activeProfileId: sessionState.activeProfileId,
    activeBands: [...sessionState.activeBands],
    activeToolboxId: sessionState.activeToolboxId,
    activationCause: sessionState.activationCause,
    leaseExpiresAt: sessionState.leaseExpiresAt,
    activatedAt: sessionState.activatedAt,
    lastToolActivityAt: sessionState.lastToolActivityAt
  };
}

async function buildBrokerActiveToolboxResponse(
  policy: CompiledToolboxPolicy
) {
  const activeProfileId = resolveSessionProfileId(policy);
  const scopedControl = buildScopedControlSurface(activeProfileId, sessionState.clientId);
  const response = await scopedControl.listActiveToolbox();
  return {
    ...response,
    workflow: {
      ...response.workflow,
      toolboxId: sessionState.activeToolboxId ?? response.workflow.toolboxId
    }
  };
}

function reconcileSessionState(): boolean {
  const reconciled = reconcileToolboxBrokerSessionState(sessionState, {
    policy: getScopedControlSurface().policy
  });
  if (!reconciled.contracted) {
    return false;
  }
  sessionState = reconciled.state;
  scheduleSessionContractionTimers();
  return true;
}

function scheduleSessionContractionTimers(): void {
  clearSessionContractionTimers();

  const policy = getScopedControlSurface().policy;
  const activeBands = sessionState.activeBands
    .map((bandId) => policy.bands[bandId])
    .filter(Boolean);
  const activeProfileId = resolveSessionProfileId(policy);
  if (activeProfileId === "bootstrap" || activeBands.length === 0) {
    return;
  }
  const now = Date.now();

  if (sessionState.leaseExpiresAt) {
    const leaseDelayMs = new Date(sessionState.leaseExpiresAt).getTime() - now;
    leaseContractionTimer = setTimeout(() => {
      void contractSessionAndNotify();
    }, Math.max(0, leaseDelayMs));
  }

  const idleTimeoutSeconds = activeBands
    .filter((band) => band.contraction.taskAware && typeof band.contraction.idleTimeoutSeconds === "number")
    .map((band) => band.contraction.idleTimeoutSeconds as number)
    .sort((left, right) => left - right)[0];
  if (!idleTimeoutSeconds) {
    return;
  }

  const activityAt = new Date(sessionState.lastToolActivityAt ?? sessionState.activatedAt).getTime();
  const idleDelayMs = activityAt + idleTimeoutSeconds * 1000 - now;
  idleContractionTimer = setTimeout(() => {
    void contractSessionAndNotify();
  }, Math.max(0, idleDelayMs));
}

function clearSessionContractionTimers(): void {
  if (idleContractionTimer) {
    clearTimeout(idleContractionTimer);
    idleContractionTimer = null;
  }
  if (leaseContractionTimer) {
    clearTimeout(leaseContractionTimer);
    leaseContractionTimer = null;
  }
}

async function contractSessionAndNotify(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  const before = await listVisibleToolNames();
  const contracted = reconcileSessionState();
  if (!contracted) {
    return;
  }
  const after = await listVisibleToolNames();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    transport.send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  }
}

function failure(code: string, message: string) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, error: { code, message } }, null, 2)
      }
    ],
    structuredContent: {
      ok: false,
      error: { code, message }
    },
    isError: true
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function optionalActorRole(value: unknown) {
  const normalized = optionalString(value);
  if (!normalized) {
    return undefined;
  }
  if (["retrieval", "writer", "orchestrator", "system", "operator"].includes(normalized)) {
    return normalized as
      | "retrieval"
      | "writer"
      | "orchestrator"
      | "system"
      | "operator";
  }
  throw new Error("actorRole must be one of retrieval, writer, orchestrator, system, operator.");
}

function optionalToolboxApproval(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const approval = value as Record<string, unknown>;
  const grantedBy = optionalString(approval.grantedBy);
  if (!grantedBy) {
    return undefined;
  }

  return {
    grantedBy,
    grantedAt: optionalString(approval.grantedAt),
    reason: optionalString(approval.reason),
    toolboxId: optionalString(approval.toolboxId)
  };
}

function buildBrokerActiveToolsResponse(
  policy: CompiledToolboxPolicy,
  client: CompiledToolboxClientOverlay,
  activeBandIds: string[],
  activeProfileId: string
): VisibleToolSet["activeToolsResponse"] {
  const activeBands = activeBandIds
    .map((bandId) => policy.bands[bandId])
    .filter(Boolean);
  const declaredTools = dedupeToolsById(
    activeBands.flatMap((band) => band.tools).map((tool) => ({
      ...tool,
      availabilityState: "declared" as const,
      suppressionReasons: undefined
    }))
  );
  const activeTools: CompiledToolboxToolDescriptor[] = [];
  const suppressedTools: CompiledToolboxToolDescriptor[] = [];

  for (const tool of declaredTools) {
    const suppressionReasons = collectSuppressionReasons(tool, client);
    if (suppressionReasons.length === 0) {
      activeTools.push({
        ...tool,
        availabilityState: "active"
      });
    } else {
      suppressedTools.push({
        ...tool,
        availabilityState: "suppressed",
        suppressionReasons
      });
    }
  }

  return {
    profileId: activeProfileId,
    clientId: client.id,
    tools: activeTools,
    declaredTools,
    activeTools,
    suppressedTools
  };
}

function collectSuppressionReasons(
  tool: CompiledToolboxToolDescriptor,
  client: CompiledToolboxClientOverlay
): string[] {
  const reasons: string[] = [];
  if (client.suppressServerIds.includes(tool.serverId)) {
    reasons.push(`suppressed-server:${tool.serverId}`);
  }
  if (client.suppressToolIds.includes(tool.toolId)) {
    reasons.push(`suppressed-tool:${tool.toolId}`);
  }
  if (client.suppressCategories.includes(tool.category)) {
    reasons.push(`suppressed-category:${tool.category}`);
  }
  if (client.suppressedSemanticCapabilities.includes(tool.semanticCapabilityId)) {
    reasons.push(`suppressed-semantic-capability:${tool.semanticCapabilityId}`);
  }
  return reasons;
}

function dedupeToolsById(
  tools: CompiledToolboxToolDescriptor[]
): CompiledToolboxToolDescriptor[] {
  const byId = new Map<string, CompiledToolboxToolDescriptor>();
  for (const tool of tools.slice().sort((left, right) => left.toolId.localeCompare(right.toolId))) {
    if (!byId.has(tool.toolId)) {
      byId.set(tool.toolId, tool);
    }
  }
  return [...byId.values()];
}

function resolveSessionProfileId(
  policy: CompiledToolboxPolicy
): string {
  return (
    policy.profiles[sessionState.activeProfileId]?.id
    ?? resolveActiveProfileIdForSessionBands(policy, sessionState.activeBands)
    ?? sessionState.activeProfileId
  );
}

function resolveActiveProfileIdForSessionBands(
  policy: CompiledToolboxPolicy,
  activeBandIds: string[]
): string | undefined {
  const normalizedBands = unique(activeBandIds).sort();
  return Object.values(policy.profiles).find((profile) =>
    profile.includeBands.length === normalizedBands.length
    && profile.includeBands.every((bandId, index) => bandId === normalizedBands[index])
  )?.id;
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return Boolean(
    value &&
      typeof value === "object" &&
      "jsonrpc" in value &&
      "method" in value
  );
}

function parseContentLength(headers: string): number | null {
  const match = headers.match(/^Content-Length:\s*(\d+)$/im);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function toStructuredContent(result: unknown): Record<string, unknown> {
  return result && typeof result === "object" && !Array.isArray(result)
    ? { ...(result as Record<string, unknown>) }
    : { result };
}

function isToolError(result: unknown): boolean {
  if (!result || typeof result !== "object") {
    return true;
  }

  return "ok" in result && result.ok === false;
}

function didToolResultFail(result: unknown): boolean {
  if (isMcpToolResult(result)) {
    return result.isError;
  }
  return isToolError(result);
}

function isMcpToolResult(
  value: unknown
): value is {
  content: unknown[];
  structuredContent?: unknown;
  isError: boolean;
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      "content" in value &&
      "isError" in value
  );
}

function loadDefaultSessionActor():
  | Pick<ActorContext, "actorId" | "actorRole" | "authToken" | "source">
  | undefined {
  const actorId = process.env.MAB_MCP_DEFAULT_ACTOR_ID?.trim();
  const actorRole = process.env.MAB_MCP_DEFAULT_ACTOR_ROLE?.trim() as
    | ActorContext["actorRole"]
    | undefined;
  const authToken = process.env.MAB_MCP_DEFAULT_ACTOR_AUTH_TOKEN?.trim();
  const source =
    process.env.MAB_MCP_DEFAULT_SOURCE?.trim() || "mimir-toolbox-mcp-session";

  if (!actorId || !actorRole || !authToken) {
    return undefined;
  }

  return {
    actorId,
    actorRole,
    authToken,
    source
  };
}

function shutdown(exitCode: number): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearSessionContractionTimers();
  for (const adapter of backendAdapters.values()) {
    void adapter.stop();
  }
  leaseStore?.close();
  serviceContainer.dispose();
  process.exit(exitCode);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
