import process from "node:process";
import type { ToolboxRuntimeBindingManifest } from "@mimir/contracts";
import type {
  ToolboxBackendAdapter,
  ToolboxBackendHealth
} from "./toolbox-backend-adapter.js";
import { ProcessBackedToolboxBackendAdapter } from "./process-backed-adapter.js";

export class LocalStdioToolboxBackendAdapter implements ToolboxBackendAdapter {
  readonly serverId: string;
  private readonly delegate: ProcessBackedToolboxBackendAdapter;

  constructor(
    serverId: string,
    private readonly runtimeBinding: Extract<ToolboxRuntimeBindingManifest, { kind: "local-stdio" }>
  ) {
    this.serverId = serverId;
    this.delegate = new ProcessBackedToolboxBackendAdapter(serverId, {
      command: this.runtimeBinding.command,
      args: this.runtimeBinding.args ?? [],
      workingDirectory: this.runtimeBinding.workingDirectory || process.cwd(),
      env: this.runtimeBinding.env ?? {}
    });
  }

  async start(): Promise<void> {
    return this.delegate.start();
  }

  async stop(): Promise<void> {
    return this.delegate.stop();
  }

  listTools() {
    return this.delegate.listTools();
  }

  callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.delegate.callTool(name, args);
  }

  health(): ToolboxBackendHealth {
    return this.delegate.health();
  }
}
