import { resolve } from "node:path";

function parseExampleServerArgs() {
  const rawArgs = process.env.MIMIR_EXAMPLE_SERVER_ARGS_JSON;

  if (!rawArgs) {
    return [];
  }

  const parsedArgs = JSON.parse(rawArgs);

  if (!Array.isArray(parsedArgs) || !parsedArgs.every((arg) => typeof arg === "string")) {
    throw new Error(
      "MIMIR_EXAMPLE_SERVER_ARGS_JSON must be a JSON string array."
    );
  }

  return parsedArgs;
}

export function getExampleMimirConfig() {
  const explicitCommand = process.env.MIMIR_EXAMPLE_SERVER_COMMAND;

  if (explicitCommand) {
    return {
      serverCommand: [explicitCommand],
      serverArgs: parseExampleServerArgs(),
      transport: "stdio"
    };
  }

  return {
    serverCommand: [process.execPath],
    serverArgs: [
      resolve(import.meta.dirname, "fixtures", "fake-mimir-mcp-server.mjs")
    ],
    transport: "stdio"
  };
}

export function getExampleMimirStdioOptions() {
  const cwd = process.env.MIMIR_EXAMPLE_SERVER_CWD;

  return cwd
    ? {
        cwd
      }
    : {};
}
