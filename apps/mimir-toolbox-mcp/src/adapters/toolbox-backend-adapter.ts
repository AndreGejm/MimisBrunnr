export interface BrokerPeerToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  serverId: string;
}

export interface ToolboxBackendHealth {
  status: "ready" | "error";
  reason?: string;
}

export interface ToolboxBackendAdapter {
  readonly serverId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  listTools(): Promise<BrokerPeerToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  health(): ToolboxBackendHealth;
}
