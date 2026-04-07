#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const VALIDATE_ONLY_FLAG = "--validate-only";
const HELP_FLAG = "--help";
const args = new Set(process.argv.slice(2));

if (args.has(HELP_FLAG)) {
  printUsage();
  process.exit(0);
}

if (args.size > 1 || (args.size === 1 && !args.has(VALIDATE_ONLY_FLAG))) {
  console.error(
    `[brain-mcp-session] Unsupported arguments: ${process.argv.slice(2).join(" ")}`
  );
  printUsage();
  process.exit(2);
}

const { validateDockerMcpSessionStartup } = await importInfrastructure();

logConfigurationSummary();
const report = await validateDockerMcpSessionStartup(process.env);
printReport(report);

if (!report.ok) {
  console.error(
    "[brain-mcp-session] Startup validation failed. Refusing to launch MCP stdio session."
  );
  process.exit(1);
}

if (args.has(VALIDATE_ONLY_FLAG)) {
  console.error("[brain-mcp-session] Validation succeeded.");
  process.exit(0);
}

const child = spawn(
  process.execPath,
  [path.join(process.cwd(), "apps", "brain-mcp", "dist", "main.js")],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  }
);

process.once("SIGINT", () => {
  child.kill("SIGINT");
});
process.once("SIGTERM", () => {
  child.kill("SIGTERM");
});

child.once("error", (error) => {
  console.error(
    `[brain-mcp-session] Failed to launch MCP server process: ${error.message}`
  );
  process.exit(1);
});

child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`[brain-mcp-session] MCP server exited on signal ${signal}.`);
    process.exit(1);
  }

  process.exit(code ?? 0);
});

async function importInfrastructure() {
  return await import(
    pathToFileURL(
      path.join(process.cwd(), "packages", "infrastructure", "dist", "index.js")
    ).href
  );
}

function logConfigurationSummary() {
  console.error("[brain-mcp-session] Preparing Docker MCP session.");
  console.error(
    `[brain-mcp-session] canonical=${process.env.MAB_VAULT_ROOT ?? "<unset>"} staging=${process.env.MAB_STAGING_ROOT ?? "<unset>"} state=${process.env.MAB_SQLITE_PATH ?? "<unset>"}`
  );
  console.error(
    `[brain-mcp-session] qdrant=${process.env.MAB_QDRANT_URL ?? "<unset>"} collection=${process.env.MAB_QDRANT_COLLECTION ?? "<unset>"}`
  );
  console.error(
    `[brain-mcp-session] models=${process.env.MAB_PROVIDER_DOCKER_OLLAMA_BASE_URL ?? "<unset>"} actor=${process.env.MAB_MCP_DEFAULT_ACTOR_ID ?? "<unset>"}`
  );
}

function printReport(report) {
  for (const check of report.checks) {
    console.error(
      `[brain-mcp-session] ${check.status.toUpperCase()} ${check.name}: ${check.message}`
    );
  }
}

function printUsage() {
  console.error(
    "Usage: node docker/brain-mcp-session-entrypoint.mjs [--validate-only]"
  );
}
