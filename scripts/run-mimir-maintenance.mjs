#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeRepoRoot = path.resolve(scriptDir, "..");
const defaultWindowsDataRoot = String.raw`F:\Dev\Mimisbrunnr`;
const defaultDataRoot =
  process.platform === "win32"
    ? defaultWindowsDataRoot
    : process.env.HOME
      ? path.join(process.env.HOME, ".mimir")
      : path.join(runtimeRepoRoot, ".mimir");

function parseBooleanFlag(args, index, name) {
  return args[index] === name ? [true, index + 1] : [false, index];
}

function readValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return [value, index + 2];
}

function readInteger(args, index, name, min, max) {
  const [rawValue, nextIndex] = readValue(args, index, name);
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return [value, nextIndex];
}

function readEnum(args, index, name, values) {
  const [value, nextIndex] = readValue(args, index, name);
  if (!values.includes(value)) {
    throw new Error(`${name} must be one of: ${values.join(", ")}.`);
  }
  return [value, nextIndex];
}

function parseArgs(args) {
  const options = {
    corpus: "all",
    maxNotes: 25,
    providerMode: "heuristic",
    reviewDepth: "fast",
    modelSampleNotes: 5,
    modelCommandTimeoutSeconds: 180,
    statusIntervalSeconds: 10,
    commandTimeoutSeconds: 300,
    applyModelSafeActions: false,
    detailed: false,
    dryRun: false,
    json: false
  };

  for (let index = 0; index < args.length;) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      index += 1;
    } else if (arg === "--corpus") {
      [options.corpus, index] = readEnum(args, index, "--corpus", ["all", "general_notes", "mimisbrunnr"]);
    } else if (arg === "--max-notes") {
      [options.maxNotes, index] = readInteger(args, index, "--max-notes", 1, 10000);
    } else if (arg === "--provider-mode") {
      [options.providerMode, index] = readEnum(args, index, "--provider-mode", ["heuristic", "model", "auto"]);
    } else if (arg === "--review-depth") {
      [options.reviewDepth, index] = readEnum(args, index, "--review-depth", ["fast", "balanced", "model"]);
    } else if (arg === "--model-sample-notes") {
      [options.modelSampleNotes, index] = readInteger(args, index, "--model-sample-notes", 1, 1000);
    } else if (arg === "--model-command-timeout-seconds") {
      [options.modelCommandTimeoutSeconds, index] = readInteger(args, index, "--model-command-timeout-seconds", 0, 86400);
    } else if (arg === "--status-interval-seconds") {
      [options.statusIntervalSeconds, index] = readInteger(args, index, "--status-interval-seconds", 1, 3600);
    } else if (arg === "--command-timeout-seconds") {
      [options.commandTimeoutSeconds, index] = readInteger(args, index, "--command-timeout-seconds", 0, 86400);
    } else if (arg === "--apply-model-safe-actions") {
      [options.applyModelSafeActions, index] = parseBooleanFlag(args, index, "--apply-model-safe-actions");
    } else if (arg === "--detailed") {
      [options.detailed, index] = parseBooleanFlag(args, index, "--detailed");
    } else if (arg === "--dry-run") {
      [options.dryRun, index] = parseBooleanFlag(args, index, "--dry-run");
    } else if (arg === "--json") {
      [options.json, index] = parseBooleanFlag(args, index, "--json");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/run-mimir-maintenance.mjs [options]

Runs governed mimisbrunnr maintenance through supported mimir commands.

Options:
  --corpus <all|general_notes|mimisbrunnr>
  --max-notes <number>
  --provider-mode <heuristic|model|auto>
  --review-depth <fast|balanced|model>
  --model-sample-notes <number>
  --model-command-timeout-seconds <number>
  --status-interval-seconds <number>
  --command-timeout-seconds <number>
  --apply-model-safe-actions
  --detailed
  --dry-run
  --json
`);
}

function status(options, message) {
  if (!options.json) {
    console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
  }
}

function maintenanceEnvironment(paths) {
  return {
    ...process.env,
    NODE_NO_WARNINGS: "1",
    MAB_DATA_ROOT: paths.dataRoot,
    MAB_VAULT_ROOT: paths.vaultRoot,
    MAB_STAGING_ROOT: paths.stagingRoot,
    MAB_SQLITE_PATH: paths.sqlitePath
  };
}

async function invokeMimir(command, payload, options, paths, timeoutSeconds = options.commandTimeoutSeconds) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mimir-maintenance-"));
  const inputPath = path.join(tempDir, "input.json");
  await writeFile(inputPath, JSON.stringify(payload), "utf8");

  const cliPath = path.join(runtimeRepoRoot, "scripts", "launch-mimir-cli.mjs");
  const child = spawn(process.execPath, [cliPath, command, "--input", inputPath], {
    cwd: runtimeRepoRoot,
    env: maintenanceEnvironment(paths),
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  let timeoutHandle;
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
    if (timeoutSeconds > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill();
        reject(new Error(`mimir command '${command}' timed out after ${timeoutSeconds} seconds.`));
      }, timeoutSeconds * 1000);
    }
  }).finally(async () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  if (exitCode !== 0) {
    throw new Error(`mimir command '${command}' failed with exit code ${exitCode}.\n${stdout}\n${stderr}`);
  }

  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`mimir command '${command}' did not return JSON.\n${stdout}\n${stderr}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const dataRoot = process.env.MAB_DATA_ROOT || defaultDataRoot;
  const paths = {
    dataRoot,
    vaultRoot: process.env.MAB_VAULT_ROOT || path.join(dataRoot, "vault", "canonical"),
    stagingRoot: process.env.MAB_STAGING_ROOT || path.join(dataRoot, "vault", "staging"),
    sqlitePath: process.env.MAB_SQLITE_PATH || path.join(dataRoot, "state", "mimisbrunnr.sqlite")
  };

  const corpora = options.corpus === "all" ? ["general_notes", "mimisbrunnr"] : [options.corpus];
  const corpusSummaries = [];

  status(options, "Loading mimir maintenance runner.");
  status(options, `mimisbrunnr data root: ${paths.dataRoot}`);
  status(options, `Memory vault: ${paths.vaultRoot}`);
  status(options, `Staging root: ${paths.stagingRoot}`);
  status(options, `Runtime repo: ${runtimeRepoRoot}`);
  status(options, `Target corpora: ${corpora.join(", ")}`);
  status(options, `Mode: ${options.dryRun ? "report only" : "report plus supported safe actions"}`);
  if (options.applyModelSafeActions || options.reviewDepth !== "fast" || options.providerMode !== "heuristic") {
    status(options, "Compatibility note: current maintenance uses supported CLI surfaces only; provider/model compatibility flags are informational in this checkout.");
  }

  for (const corpusId of corpora) {
    status(options, `[${corpusId}] Reading review queue.`);
    const queue = await invokeMimir("list-review-queue", { targetCorpus: corpusId }, options, paths);
    if (!queue.ok) {
      throw new Error(`list-review-queue failed for '${corpusId}': ${queue.error?.message ?? "unknown error"}`);
    }

    status(options, `[${corpusId}] Reading freshness status.`);
    const freshness = await invokeMimir(
      "freshness-status",
      { corpusId, limitPerCategory: options.maxNotes },
      options,
      paths
    );
    if (!freshness.ok) {
      throw new Error(`freshness-status failed for '${corpusId}': ${freshness.error?.message ?? "unknown error"}`);
    }

    const summary = {
      corpusId,
      reviewQueueCount: Array.isArray(queue.data?.items) ? queue.data.items.length : 0,
      freshness: freshness.freshness,
      refreshDrafts: null,
      items: options.detailed ? queue.data?.items ?? [] : []
    };
    corpusSummaries.push(summary);
    status(
      options,
      `[${corpusId}] Review queue: ${summary.reviewQueueCount}; expired: ${summary.freshness?.expiredCurrentStateNotes ?? 0}; expiring soon: ${summary.freshness?.expiringSoonCurrentStateNotes ?? 0}; future-dated: ${summary.freshness?.futureDatedCurrentStateNotes ?? 0}.`
    );
  }

  if (!options.dryRun && corpora.includes("mimisbrunnr")) {
    status(options, "[mimisbrunnr] Creating refresh drafts for stale current-state notes.");
    const refresh = await invokeMimir(
      "create-refresh-drafts",
      { corpusId: "mimisbrunnr", limitPerCategory: options.maxNotes, maxDrafts: options.maxNotes },
      options,
      paths,
      options.modelCommandTimeoutSeconds || options.commandTimeoutSeconds
    );
    const mimisbrunnrResult = corpusSummaries.find((summary) => summary.corpusId === "mimisbrunnr");
    if (refresh.ok) {
      mimisbrunnrResult.refreshDrafts = refresh.data;
      status(options, `[mimisbrunnr] Created ${Array.isArray(refresh.data?.drafts) ? refresh.data.drafts.length : 0} refresh drafts.`);
    } else if (refresh.error?.code === "validation_failed") {
      mimisbrunnrResult.refreshDrafts = { drafts: [], skipped: true, reason: refresh.error.message };
      status(options, `[mimisbrunnr] No refresh drafts created: ${refresh.error.message}`);
    } else {
      throw new Error(`create-refresh-drafts failed for 'mimisbrunnr': ${refresh.error?.message ?? "unknown error"}`);
    }
  }

  const summary = {
    ok: true,
    dataRoot: paths.dataRoot,
    vaultRoot: paths.vaultRoot,
    stagingRoot: paths.stagingRoot,
    sqlitePath: paths.sqlitePath,
    runtimeRepoRoot,
    applySafeActions: !options.dryRun,
    maxNotes: options.maxNotes,
    reviewDepth: options.reviewDepth,
    providerMode: options.providerMode,
    modelSampleNotes: options.modelSampleNotes,
    modelCommandTimeoutSeconds: options.modelCommandTimeoutSeconds,
    applyModelSafeActions: options.applyModelSafeActions,
    statusIntervalSeconds: options.statusIntervalSeconds,
    commandTimeoutSeconds: options.commandTimeoutSeconds,
    detailed: options.detailed,
    corpora,
    corpusSummaries
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("mimir maintenance complete");
  for (const result of corpusSummaries) {
    console.log(`[${result.corpusId}]`);
    console.log(`  review queue: ${result.reviewQueueCount}`);
    console.log(`  expired current-state: ${result.freshness?.expiredCurrentStateNotes ?? 0}`);
    console.log(`  expiring soon: ${result.freshness?.expiringSoonCurrentStateNotes ?? 0}`);
    console.log(`  future-dated current-state: ${result.freshness?.futureDatedCurrentStateNotes ?? 0}`);
    if (result.refreshDrafts) {
      console.log(result.refreshDrafts.skipped
        ? `  refresh drafts: skipped\n    ${result.refreshDrafts.reason}`
        : `  refresh drafts created: ${Array.isArray(result.refreshDrafts.drafts) ? result.refreshDrafts.drafts.length : 0}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
