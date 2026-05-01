#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const launcherPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "ai-tools.mjs");
const child = spawn(process.execPath, [launcherPath, ...process.argv.slice(2)], {
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
