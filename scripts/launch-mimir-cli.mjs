#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import {
  ensureBuiltEntrypoint,
  getBuiltCliEntrypoint,
  getRepoRootFromScript
} from "./lib/default-access.mjs";

const repoRoot = getRepoRootFromScript(import.meta.url);
const entrypointPath = getBuiltCliEntrypoint(repoRoot);
const args = process.argv.slice(2);

if (args[0] === "doctor" || args[0] === "detect") {
  const doctorScript = path.join(repoRoot, "scripts", "doctor-default-access.mjs");
  const doctorArgs =
    args[0] === "detect"
      ? ["--json", ...args.slice(1)]
      : args.slice(1);
  const child = spawnSync(process.execPath, [doctorScript, ...doctorArgs], {
    cwd: repoRoot,
    stdio: "inherit"
  });

  if (child.error) {
    throw child.error;
  }

  process.exit(child.status ?? 1);
}

ensureBuiltEntrypoint(repoRoot, entrypointPath);

const child = spawnSync(process.execPath, [entrypointPath, ...args], {
  cwd: repoRoot,
  stdio: "inherit"
});

if (child.error) {
  throw child.error;
}

process.exit(child.status ?? 1);
