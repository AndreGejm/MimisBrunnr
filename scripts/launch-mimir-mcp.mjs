#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

import {
  ensureBuiltEntrypoint,
  getBuiltMcpEntrypoint,
  getRepoRootFromScript
} from "./lib/default-access.mjs";

const repoRoot = getRepoRootFromScript(import.meta.url);
const entrypointPath = getBuiltMcpEntrypoint(repoRoot);

ensureBuiltEntrypoint(repoRoot, entrypointPath);

const child = spawnSync(process.execPath, [entrypointPath, ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdio: "inherit"
});

if (child.error) {
  throw child.error;
}

process.exit(child.status ?? 1);
