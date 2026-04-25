import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getExampleMimirConfig,
  getExampleMimirStdioOptions
} from "../../examples/example-mimir-stdio.js";

const originalEnv = {
  ...process.env
};

afterEach(() => {
  process.env = {
    ...originalEnv
  };
});

describe("example Mimir stdio config", () => {
  it("defaults to a repo-local executable stdio server fallback", () => {
    delete process.env.MIMIR_EXAMPLE_SERVER_COMMAND;
    delete process.env.MIMIR_EXAMPLE_SERVER_ARGS_JSON;
    delete process.env.MIMIR_EXAMPLE_SERVER_CWD;

    const config = getExampleMimirConfig();
    const options = getExampleMimirStdioOptions();

    expect(config.serverCommand).toEqual([process.execPath]);
    expect(config.serverArgs).toHaveLength(1);
    expect(existsSync(config.serverArgs[0])).toBe(true);
    expect(config.serverArgs[0]).toBe(
      resolve(
        import.meta.dirname,
        "..",
        "..",
        "examples",
        "fixtures",
        "fake-mimir-mcp-server.mjs"
      )
    );
    expect(config.transport).toBe("stdio");
    expect(options).toEqual({});
  });

  it("honors an explicit example server override when provided", () => {
    process.env.MIMIR_EXAMPLE_SERVER_COMMAND = "node";
    process.env.MIMIR_EXAMPLE_SERVER_ARGS_JSON =
      '["C:/custom/mimir-mcp.js","--flag"]';
    process.env.MIMIR_EXAMPLE_SERVER_CWD = "C:/custom";

    const config = getExampleMimirConfig();
    const options = getExampleMimirStdioOptions();

    expect(config.serverCommand).toEqual(["node"]);
    expect(config.serverArgs).toEqual(["C:/custom/mimir-mcp.js", "--flag"]);
    expect(options).toEqual({
      cwd: "C:/custom"
    });
  });
});
