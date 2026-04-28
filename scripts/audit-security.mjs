#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const ALLOWED_AUDIT_ADVISORIES = [
  {
    githubAdvisoryId: "GHSA-w5hq-g745-h8pq",
    moduleName: "uuid",
    severity: "moderate",
    allowedPathPatterns: [
      /^packages__infrastructure>@voltagent\/core>uuid$/u,
      /^(packages\/infrastructure|vendor\/codex-claude-voltagent-client)>@voltagent\/core@2\.7\.\d+>uuid@9\.0\.1$/u,
      /^apps\/mimir-(api|cli|control-mcp|mcp|toolbox-mcp)>@mimir\/infrastructure@[^>]+>@voltagent\/core@2\.7\.\d+>uuid@9\.0\.1$/u
    ],
    rationale:
      "@voltagent/core 2.7.x depends on uuid ^9.0.1. uuid >=14 is the patched line, but a forced override would change the transitive dependency outside the upstream package contract. Remove this exception when VoltAgent publishes a compatible patched dependency."
  }
];

export function classifyAuditReport(report) {
  const advisories = Object.values(report?.advisories ?? {});
  const allowed = [];
  const blocking = [];

  for (const advisory of advisories) {
    const matchingRule = ALLOWED_AUDIT_ADVISORIES.find((rule) =>
      advisoryMatchesRule(advisory, rule)
    );
    if (matchingRule) {
      allowed.push({ advisory, rule: matchingRule });
    } else {
      blocking.push(advisory);
    }
  }

  return { allowed, blocking };
}

export function renderAuditDecision(decision) {
  const lines = [];

  for (const { advisory, rule } of decision.allowed) {
    lines.push(
      `Allowed advisory: ${advisory.github_advisory_id ?? advisory.id} (${advisory.module_name}, ${advisory.severity})`,
      `Reason: ${rule.rationale}`
    );
  }

  for (const advisory of decision.blocking) {
    lines.push(
      `Blocking advisory: ${advisory.github_advisory_id ?? advisory.id} (${advisory.module_name ?? "unknown"}, ${advisory.severity ?? "unknown"})`,
      `Title: ${advisory.title ?? "unknown"}`,
      `Paths: ${getAdvisoryPaths(advisory).join(", ") || "unknown"}`
    );
  }

  return lines.join("\n");
}

async function main() {
  const audit = runPnpmAudit();
  if (audit.error) {
    console.error(audit.error.message);
    process.exitCode = 1;
    return;
  }

  const report = parseAuditJson(audit.stdout);
  const decision = classifyAuditReport(report);
  const summary = renderAuditDecision(decision);
  if (summary) {
    console.log(summary);
  } else {
    console.log("No security advisories reported by pnpm audit.");
  }

  if (decision.blocking.length > 0) {
    process.exitCode = 1;
  }
}

function advisoryMatchesRule(advisory, rule) {
  if (advisory.github_advisory_id !== rule.githubAdvisoryId) {
    return false;
  }
  if (advisory.module_name !== rule.moduleName) {
    return false;
  }
  if (advisory.severity !== rule.severity) {
    return false;
  }

  const paths = getAdvisoryPaths(advisory);
  return paths.length > 0 && paths.every((path) =>
    rule.allowedPathPatterns.some((pattern) => pattern.test(normalizeAuditPath(path)))
  );
}

function getAdvisoryPaths(advisory) {
  return [...new Set((advisory.findings ?? []).flatMap((finding) => finding.paths ?? []))];
}

function runPnpmAudit() {
  const args = ["audit", "--audit-level", "moderate", "--json"];
  if (process.env.npm_execpath) {
    return spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
      encoding: "utf8"
    });
  }

  return spawnSync(process.platform === "win32" ? "corepack.cmd" : "corepack", ["pnpm", ...args], {
    encoding: "utf8"
  });
}

function parseAuditJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { advisories: {} };
  }
  return JSON.parse(trimmed);
}

function normalizeAuditPath(path) {
  return path.replace(/\\/gu, "/").replace(/\s*>\s*/gu, ">");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await main();
}
