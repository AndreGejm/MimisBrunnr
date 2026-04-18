#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import {
  applyDockerMcpRuntimePlan,
  compileDockerMcpRuntimePlan,
  buildDockerMcpRuntimeApplyPlan,
  compileToolboxPolicyFromDirectory
} from "../../packages/infrastructure/dist/index.js";

function parseArgs(argv) {
  const options = {
    source: path.resolve("docker", "mcp"),
    json: false,
    dryRun: true,
    inlineJson: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--source") {
      const nextValue = argv[index + 1];
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("--source requires a directory path.");
      }
      options.source = path.resolve(nextValue);
      index += 1;
      continue;
    }
    if (value === "--json") {
      options.json = true;
      const nextValue = argv[index + 1];
      if (nextValue && !nextValue.startsWith("--") && options.inlineJson === undefined) {
        options.inlineJson = nextValue;
        index += 1;
      }
      continue;
    }
    if (value === "--apply") {
      options.dryRun = false;
      continue;
    }
    if (value === "--pretty" || value === "--no-pretty") {
      continue;
    }
    if (options.inlineJson === undefined && !value.startsWith("--")) {
      options.inlineJson = value;
      continue;
    }
    if (value.startsWith("--")) {
      throw new Error(`Unknown flag '${value}'.`);
    }
    throw new Error(`Unexpected argument '${value}'.`);
  }

  return options;
}

function renderSummary(plan, dryRun) {
  const header = dryRun
    ? "Docker MCP toolbox sync dry-run"
    : "Docker MCP toolbox sync apply";
  const lines = [
    header,
    `manifestRevision: ${plan.manifestRevision}`,
    `profiles: ${plan.profiles.length}`,
    `servers: ${plan.servers.length}`
  ];

  for (const profile of plan.profiles) {
    lines.push(
      `- ${profile.id} -> ${profile.dockerProfileName} (${profile.serverIds.length} servers, ${profile.toolIds.length} tools)`
    );
  }

  if (!dryRun) {
    lines.push("Apply mode probes `docker mcp profile` support and only shells out when the command is available.");
  }

  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));
const payload = parseInlineJson(options.inlineJson);
const policy = compileToolboxPolicyFromDirectory(options.source);
const generatedAt =
  payload.generatedAt?.trim()
  || process.env.MIMIR_DOCKER_RUNTIME_GENERATED_AT?.trim()
  || "1970-01-01T00:00:00.000Z";
const manifestDirectory =
  payload.manifestDirectory?.trim()
  ? path.resolve(payload.manifestDirectory)
  : options.source;
const dockerExecutable =
  process.env.MIMIR_DOCKER_EXECUTABLE?.trim()
  || "docker";
const dockerExecutableArgs = parseJsonArrayEnv(
  process.env.MIMIR_DOCKER_EXECUTABLE_ARGS_JSON
);
const plan = compileDockerMcpRuntimePlan(policy, {
  generatedAt
});
const applyPlan = buildDockerMcpRuntimeApplyPlan(plan);

if (options.json) {
  if (options.dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          dryRun: true,
          manifestDirectory,
          plan,
          apply: {
            status: "dry-run",
            attempted: false,
            commands: applyPlan.commands
          }
        },
        null,
        2
      )}\n`
    );
  } else {
    const execution = applyDockerMcpRuntimePlan(plan, {
      executable: dockerExecutable,
      executableArgs: dockerExecutableArgs
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: execution.status === "applied",
          dryRun: false,
          manifestDirectory,
          plan,
          apply: execution
        },
        null,
        2
      )}\n`
    );
    process.exitCode = execution.status === "applied" ? 0 : 1;
  }
} else {
  if (options.dryRun) {
    process.stdout.write(`${renderSummary(plan, true)}\n`);
  } else {
    const execution = applyDockerMcpRuntimePlan(plan, {
      executable: dockerExecutable,
      executableArgs: dockerExecutableArgs
    });
    process.stdout.write(`${renderSummary(plan, false)}\n`);
    if (execution.status !== "applied") {
      if (execution.status === "failed") {
        const failedCommand = execution.failedCommand?.argv.join(" ");
        process.stdout.write(
          [
            `apply-status: failed`,
            execution.failureMessage ? `failure-message: ${execution.failureMessage}` : null,
            failedCommand ? `failed-command: ${failedCommand}` : null
          ]
            .filter(Boolean)
            .join("\n")
        );
        process.stdout.write("\n");
      }
      process.stdout.write(
        [
          `compatibility: ${execution.compatibility.supported ? "supported" : "unsupported"}`,
          ...execution.compatibility.nextSteps.map((step) => `next: ${step}`)
        ].join("\n")
      );
      process.stdout.write("\n");
      process.exitCode = 1;
    }
  }
}

function parseJsonArrayEnv(value) {
  if (!value || !value.trim()) {
    return [];
  }

  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error("MIMIR_DOCKER_EXECUTABLE_ARGS_JSON must be a JSON array of strings.");
  }

  return parsed;
}

function parseInlineJson(value) {
  if (!value) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Inline JSON payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Inline JSON payload must be an object.");
  }

  return parsed;
}
