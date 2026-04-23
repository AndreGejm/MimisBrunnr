import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  CompiledToolboxClientOverlay,
  CompiledToolboxPolicy,
  CompiledToolboxProfile,
  CompiledToolboxToolDescriptor,
  ToolboxClientMaterializationDescriptor
} from "@mimir/contracts";

interface CodexMcpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface CodexClientMaterializationContent {
  mcpServers: Record<string, CodexMcpServerConfig>;
}

export interface CodexClientMaterializationPlan
  extends ToolboxClientMaterializationDescriptor {
  serverIds: string[];
  content: CodexClientMaterializationContent;
}

export function defaultCodexClientMaterializationPath(rootDirectory: string): string {
  return path.resolve(rootDirectory, ".mimir", "toolbox", "codex.mcp.json");
}

export function buildCodexClientMaterializationDescriptor(input: {
  policy: CompiledToolboxPolicy;
  profile: CompiledToolboxProfile;
  client: CompiledToolboxClientOverlay;
  activeTools: CompiledToolboxToolDescriptor[];
  rootDirectory: string;
  outputPath?: string;
}): ToolboxClientMaterializationDescriptor | undefined {
  const plan = buildCodexClientMaterializationPlan(input);
  if (!plan) {
    return undefined;
  }
  return {
    format: plan.format,
    path: plan.path
  };
}

export function buildCodexClientMaterializationPlan(input: {
  policy: CompiledToolboxPolicy;
  profile: CompiledToolboxProfile;
  client: CompiledToolboxClientOverlay;
  activeTools: CompiledToolboxToolDescriptor[];
  rootDirectory: string;
  outputPath?: string;
}): CodexClientMaterializationPlan | undefined {
  if (input.client.id !== "codex") {
    return undefined;
  }

  const localStdioServerIds = uniqueSorted(
    input.activeTools
      .map((tool) => tool.serverId)
      .filter((serverId, index, values) => values.indexOf(serverId) === index)
      .filter((serverId) => {
        const server = input.policy.servers[serverId];
        return (
          server?.runtimeBinding?.kind === "local-stdio" &&
          server.runtimeBinding.configTarget === "codex-mcp-json"
        );
      })
  );

  if (localStdioServerIds.length === 0) {
    return undefined;
  }

  const mcpServers = Object.fromEntries(
    localStdioServerIds.map((serverId) => {
      const server = input.policy.servers[serverId];
      const runtimeBinding = server.runtimeBinding;
      if (!runtimeBinding || runtimeBinding.kind !== "local-stdio") {
        throw new Error(
          `Server '${serverId}' is not a local-stdio peer and cannot be materialized for Codex.`
        );
      }

      const config: CodexMcpServerConfig = {
        command: runtimeBinding.command
      };
      if (runtimeBinding.args && runtimeBinding.args.length > 0) {
        config.args = [...runtimeBinding.args];
      }
      if (runtimeBinding.env && Object.keys(runtimeBinding.env).length > 0) {
        config.env = { ...runtimeBinding.env };
      }
      if (runtimeBinding.workingDirectory?.trim()) {
        config.cwd = runtimeBinding.workingDirectory;
      }

      return [serverId, config];
    })
  );

  return {
    format: "codex-mcp-json",
    path: path.resolve(
      input.outputPath
        ? input.outputPath
        : defaultCodexClientMaterializationPath(input.rootDirectory)
    ),
    serverIds: localStdioServerIds,
    content: {
      mcpServers
    }
  };
}

export function writeCodexClientMaterializationPlan(
  plan: CodexClientMaterializationPlan
): string {
  mkdirSync(path.dirname(plan.path), { recursive: true });
  const serialized = `${JSON.stringify(plan.content, null, 2)}\n`;
  writeFileSync(plan.path, serialized, "utf8");
  return serialized;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
