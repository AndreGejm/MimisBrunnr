import { RUNTIME_COMMAND_DEFINITIONS } from "../../packages/contracts/dist/index.js";
import {
  getSupportedRuntimeDispatchCommandNames,
  getSupportedTransportCommandNames
} from "../../packages/infrastructure/dist/index.js";
import { getRuntimeHttpRouteDefinitions } from "../../apps/mimir-api/dist/server.js";
import {
  CLI_COMMAND_NAMES,
  SYSTEM_COMMAND_NAMES,
  getCliCommandSurfaceDefinitions
} from "../../apps/mimir-cli/dist/command-surface.js";
import { MCP_TOOL_DEFINITIONS } from "../../apps/mimir-mcp/dist/tool-definitions.js";

function compareOrderedSurface(label, expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual)
    ? []
    : [{
        label,
        expected,
        actual
      }];
}

export function buildCommandSurfaceReport() {
  const runtimeCommands = RUNTIME_COMMAND_DEFINITIONS.map((command) => ({
    runtimeName: command.name,
    cliName: command.cliName,
    domain: command.domain,
    family: command.family,
    defaultActorRole: command.defaultActorRole
  }));
  const expectedRuntimeCliNames = runtimeCommands.map((command) => command.cliName);
  const expectedRuntimeNames = runtimeCommands.map((command) => command.runtimeName);
  const cliSurface = getCliCommandSurfaceDefinitions();
  const cliRuntimeSurface = cliSurface.filter((command) => command.kind === "runtime");
  const cliSystemSurface = cliSurface.filter((command) => command.kind === "system");
  const httpRoutes = getRuntimeHttpRouteDefinitions();
  const httpRoutesByCommand = new Map(
    httpRoutes.map((route) => [route.commandName, route])
  );
  const mcpToolsByCommand = new Map(
    MCP_TOOL_DEFINITIONS.map((tool) => [tool.name, tool])
  );
  const transportCommandNames = getSupportedTransportCommandNames();
  const runtimeDispatchCommandNames = getSupportedRuntimeDispatchCommandNames();
  const mismatches = [
    ...compareOrderedSurface(
      "cli.runtime.commands",
      expectedRuntimeCliNames,
      cliRuntimeSurface.map((command) => command.name)
    ),
    ...compareOrderedSurface(
      "cli.system.commands",
      [...SYSTEM_COMMAND_NAMES],
      cliSystemSurface.map((command) => command.name)
    ),
    ...compareOrderedSurface(
      "transport.validators",
      expectedRuntimeCliNames,
      transportCommandNames
    ),
    ...compareOrderedSurface(
      "transport.dispatcher",
      expectedRuntimeCliNames,
      runtimeDispatchCommandNames
    ),
    ...compareOrderedSurface(
      "http.routes",
      expectedRuntimeCliNames,
      httpRoutes.map((route) => route.commandName)
    ),
    ...compareOrderedSurface(
      "mcp.tools",
      expectedRuntimeNames,
      MCP_TOOL_DEFINITIONS.map((tool) => tool.name)
    )
  ];

  return {
    ok: mismatches.length === 0,
    summary: {
      runtimeCommandCount: runtimeCommands.length,
      systemCommandCount: SYSTEM_COMMAND_NAMES.length,
      cliCommandCount: CLI_COMMAND_NAMES.length,
      mismatchCount: mismatches.length
    },
    systemCommands: [...SYSTEM_COMMAND_NAMES],
    runtimeCommands: runtimeCommands.map((command) => {
      const httpRoute = httpRoutesByCommand.get(command.cliName);
      const mcpTool = mcpToolsByCommand.get(command.runtimeName);
      return {
        ...command,
        cliExposed: cliRuntimeSurface.some((item) => item.name === command.cliName),
        transportValidated: transportCommandNames.includes(command.cliName),
        runtimeDispatched: runtimeDispatchCommandNames.includes(command.cliName),
        httpPath: httpRoute?.path ?? null,
        httpMethod: httpRoute?.method ?? null,
        mcpExposed: Boolean(mcpTool),
        mcpTitle: mcpTool?.title ?? null
      };
    }),
    mismatches
  };
}

export function formatCommandSurfaceReport(report) {
  const lines = [
    "Runtime command surface inventory",
    `- runtime commands: ${report.summary.runtimeCommandCount}`,
    `- system commands: ${report.summary.systemCommandCount}`,
    `- total CLI commands: ${report.summary.cliCommandCount}`,
    `- mismatches: ${report.summary.mismatchCount}`
  ];

  for (const command of report.runtimeCommands) {
    lines.push(
      `* ${command.cliName} -> http=${command.httpMethod ?? "n/a"} ${command.httpPath ?? "n/a"}, ` +
      `mcp=${command.mcpExposed ? command.runtimeName : "missing"}, ` +
      `validated=${command.transportValidated}, dispatched=${command.runtimeDispatched}, cli=${command.cliExposed}`
    );
  }

  if (report.mismatches.length > 0) {
    lines.push("Mismatches:");
    for (const mismatch of report.mismatches) {
      lines.push(
        `- ${mismatch.label}: expected=${JSON.stringify(mismatch.expected)} actual=${JSON.stringify(mismatch.actual)}`
      );
    }
  }

  return lines.join("\n");
}
