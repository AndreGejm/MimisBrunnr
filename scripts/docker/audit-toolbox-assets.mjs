#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import {
  compileDockerMcpRuntimePlan,
  compileToolboxPolicyFromDirectory
} from "../../packages/infrastructure/dist/index.js";

function parseArgs(argv) {
  const options = {
    source: path.resolve("docker", "mcp"),
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--source") {
      options.source = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--json") {
      options.json = true;
    }
  }

  return options;
}

function buildValidReport(sourceDirectory) {
  const policy = compileToolboxPolicyFromDirectory(sourceDirectory);
  const runtimePlan = compileDockerMcpRuntimePlan(policy, {
    generatedAt: new Date().toISOString()
  });

  return {
    status: "valid",
    manifestDir: policy.sourceDirectory,
    manifestRevision: policy.manifestRevision,
    counts: {
      categories: Object.keys(policy.categories).length,
      trustClasses: Object.keys(policy.trustClasses).length,
      servers: Object.keys(policy.servers).length,
      profiles: Object.keys(policy.profiles).length,
      intents: Object.keys(policy.intents).length,
      clients: Object.keys(policy.clients).length,
      tools: Object.values(policy.servers).reduce((total, server) => total + server.tools.length, 0)
    },
    runtimePlan: {
      generatedAt: runtimePlan.generatedAt,
      serverCount: runtimePlan.servers.length,
      profileCount: runtimePlan.profiles.length
    },
    bootstrapProfilePresent: Object.hasOwn(policy.profiles, "bootstrap"),
    controlServerPresent: Object.hasOwn(policy.servers, "mimir-control"),
    sessionModes: [...new Set(Object.values(policy.profiles).map((profile) => profile.sessionMode))].sort(),
    errors: []
  };
}

function buildInvalidReport(sourceDirectory, error) {
  return {
    status: "invalid",
    manifestDir: path.resolve(sourceDirectory),
    manifestRevision: null,
    counts: {
      categories: 0,
      trustClasses: 0,
      servers: 0,
      profiles: 0,
      intents: 0,
      clients: 0,
      tools: 0
    },
    runtimePlan: {
      generatedAt: null,
      serverCount: 0,
      profileCount: 0
    },
    bootstrapProfilePresent: false,
    controlServerPresent: false,
    sessionModes: [],
    errors: [error instanceof Error ? error.message : String(error)]
  };
}

function renderSummary(report) {
  const lines = [
    "Docker MCP toolbox asset audit",
    `status: ${report.status}`,
    `manifestDir: ${report.manifestDir}`
  ];

  if (report.status === "valid") {
    lines.push(`manifestRevision: ${report.manifestRevision}`);
    lines.push(
      `counts: categories=${report.counts.categories}, trustClasses=${report.counts.trustClasses}, servers=${report.counts.servers}, profiles=${report.counts.profiles}, intents=${report.counts.intents}, clients=${report.counts.clients}, tools=${report.counts.tools}`
    );
    lines.push(
      `runtimePlan: profiles=${report.runtimePlan.profileCount}, servers=${report.runtimePlan.serverCount}`
    );
    lines.push(`bootstrapProfilePresent: ${report.bootstrapProfilePresent}`);
    lines.push(`controlServerPresent: ${report.controlServerPresent}`);
  } else {
    for (const error of report.errors) {
      lines.push(`error: ${error}`);
    }
  }

  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));
let report;

try {
  report = buildValidReport(options.source);
} catch (error) {
  report = buildInvalidReport(options.source, error);
}

if (options.json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`${renderSummary(report)}\n`);
}
