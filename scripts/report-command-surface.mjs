#!/usr/bin/env node

import process from "node:process";
import {
  buildCommandSurfaceReport,
  formatCommandSurfaceReport
} from "./lib/command-surface-report.mjs";

const report = buildCommandSurfaceReport();

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`${formatCommandSurfaceReport(report)}\n`);
}

if (!report.ok) {
  process.exitCode = 1;
}
